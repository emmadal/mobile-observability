package expo.modules.mobileobservability

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Captures uncaught JVM exceptions immediately, and native crashes, ANRs and
 * foreground low-memory kills on the next launch via ApplicationExitInfo.
 */
class CrashReporter(private val context: Context, private val files: ObservabilityFiles) {
  @Volatile private var jsFatalRecorded = false
  @Volatile private var contextJson: String = "null"
  private val io = Executors.newSingleThreadExecutor()
  private val preferences = context.getSharedPreferences("mobile-observability", Context.MODE_PRIVATE)

  fun start() {
    files.rotate(files.crashContext, files.previousCrashContext)
    files.rotate(files.process, files.previousProcess)
    files.writeAtomically(
      files.process,
      JSONObject().put("pid", Process.myPid()).put("startedAt", System.currentTimeMillis()).toString(),
    )
    installUncaughtExceptionHandler()
    io.execute { collectExitReasons() }
  }

  fun setContext(json: String) {
    contextJson = json
    io.execute { files.writeAtomically(files.crashContext, json) }
  }

  fun persistJsFatal(json: String) {
    jsFatalRecorded = true
    val report = runCatching { JSONObject(json) }.getOrNull() ?: return
    if (!report.has("id")) report.put("id", UUID.randomUUID().toString())
    report.put("kind", "js_fatal")
    savePending(report)
  }

  fun pendingReports(): List<String> =
    (files.pendingReports.listFiles() ?: emptyArray())
      .sortedBy { it.name }
      .mapNotNull { file ->
        val text = runCatching { file.readText() }.getOrNull()
        if (text == null || runCatching { JSONObject(text) }.isFailure) {
          file.delete() // partial write: discard
          null
        } else {
          text
        }
      }

  fun deletePending(ids: List<String>) {
    ids.filter(::isSafeId).forEach { java.io.File(files.pendingReports, "$it.json").delete() }
  }

  fun triggerTestCrash(kind: String) {
    when (kind) {
      "exception" -> Handler(Looper.getMainLooper()).post {
        throw IllegalStateException("Test native exception")
      }
      // SIGSEGV delivered to the process: recorded by the OS as a native crash.
      else -> Process.sendSignal(Process.myPid(), 11)
    }
  }

  private fun installUncaughtExceptionHandler() {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        record(throwable, thread)
      } catch (error: Throwable) {
        Log.w(TAG, "Failed to record crash", error)
      } finally {
        previous?.uncaughtException(thread, throwable)
      }
    }
  }

  private fun record(throwable: Throwable, thread: Thread) {
    // React Native rethrows a fatal JS error as JavascriptException; the JS layer
    // already persisted the original error with its JS stack.
    if (jsFatalRecorded && throwable.javaClass.name.endsWith("JavascriptException")) return
    val frames = NativeFrames.fromThrowable(throwable, context.packageName)
    savePending(
      newReport(
        kind = "exception",
        type = throwable.javaClass.name,
        message = throwable.message ?: "",
        fatal = true,
        timestamp = System.currentTimeMillis(),
        frames = frames,
        rawStack = "Thread: ${thread.name}\n${Log.getStackTraceString(throwable)}",
        context = contextJson,
      ),
    )
  }

  private fun collectExitReasons() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return
    val lastHandled = preferences.getLong(KEY_LAST_EXIT, -1L)
    if (lastHandled < 0) {
      // First run with the SDK: older exits predate it.
      preferences.edit().putLong(KEY_LAST_EXIT, System.currentTimeMillis()).apply()
      return
    }
    val exits = runCatching { manager.getHistoricalProcessExitReasons(context.packageName, 0, 10) }
      .getOrDefault(emptyList())
      .filter { it.timestamp > lastHandled }
    if (exits.isEmpty()) return

    val previousPid = readJson(files.previousProcess)?.optInt("pid", -1) ?: -1
    val previousContext = runCatching { files.previousCrashContext.readText() }.getOrNull() ?: "null"
    for (exit in exits) {
      val report = exitReport(exit) ?: continue
      val attributed = if (exit.pid == previousPid) previousContext else "null"
      report.put("context", parseJsonOrNull(attributed))
      savePending(report)
    }
    preferences.edit().putLong(KEY_LAST_EXIT, exits.maxOf { it.timestamp }).apply()
  }

  private fun exitReport(exit: ApplicationExitInfo): JSONObject? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    val foreground = exit.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    return when (exit.reason) {
      ApplicationExitInfo.REASON_CRASH_NATIVE -> newReport(
        kind = "native_crash", type = "NativeCrash",
        message = exit.description ?: "Native crash (signal ${exit.status})",
        fatal = true, timestamp = exit.timestamp.toDouble(), frames = emptyList(), rawStack = null,
        context = "null",
      )
      ApplicationExitInfo.REASON_ANR -> {
        val trace = runCatching { exit.traceInputStream?.bufferedReader()?.use { it.readText() } }.getOrNull()
        newReport(
          kind = "anr", type = "ApplicationNotResponding",
          message = exit.description ?: "Application Not Responding",
          fatal = true, timestamp = exit.timestamp.toDouble(),
          frames = trace?.let { NativeFrames.mainThreadFromAnrTrace(it, context.packageName) } ?: emptyList(),
          rawStack = trace?.take(MAX_RAW_STACK), context = "null",
        )
      }
      ApplicationExitInfo.REASON_LOW_MEMORY -> if (foreground) {
        newReport(
          kind = "oom", type = "LowMemoryKill",
          message = exit.description ?: "Killed by the system due to low memory",
          fatal = true, timestamp = exit.timestamp.toDouble(), frames = emptyList(), rawStack = null,
          context = "null",
        )
      } else {
        null
      }
      else -> null
    }
  }

  private fun newReport(
    kind: String,
    type: String,
    message: String,
    fatal: Boolean,
    timestamp: Double,
    frames: List<NativeFrame>,
    rawStack: String?,
    context: String,
  ): JSONObject = JSONObject().apply {
    put("id", UUID.randomUUID().toString())
    put("kind", kind)
    put("type", type)
    put("message", message)
    put("fatal", fatal)
    put("timestamp", timestamp)
    put("frames", JSONArray(frames.map { JSONObject(it.toMap()) }))
    rawStack?.let { put("rawStack", it) }
    put("context", parseJsonOrNull(context))
  }

  private fun savePending(report: JSONObject) {
    val id = report.optString("id")
    if (!isSafeId(id)) return
    files.writeAtomically(java.io.File(files.pendingReports, "$id.json"), report.toString())
  }

  private fun readJson(file: java.io.File): JSONObject? =
    runCatching { JSONObject(file.readText()) }.getOrNull()

  private fun parseJsonOrNull(text: String): Any =
    runCatching { JSONObject(text) }.getOrNull() ?: JSONObject.NULL

  private fun isSafeId(id: String): Boolean =
    id.isNotEmpty() && id.length <= 64 && id.all { it.isLetterOrDigit() || it == '-' }

  companion object {
    private const val TAG = "MobileObservability"
    private const val KEY_LAST_EXIT = "lastHandledExitTimestamp"
    private const val MAX_RAW_STACK = 32 * 1024
  }
}
