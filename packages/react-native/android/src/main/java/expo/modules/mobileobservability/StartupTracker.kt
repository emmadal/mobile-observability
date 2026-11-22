package expo.modules.mobileobservability

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.view.ViewTreeObserver

/**
 * Measures cold launch (process start until the first frame of the first
 * activity) and warm launch (return to foreground with a live process until
 * the next frame).
 */
object StartupTracker : Application.ActivityLifecycleCallbacks {
  @Volatile var processStartMs = 0.0
    private set
  @Volatile var coldLaunchMs: Double? = null
    private set
  /** The process was started for something other than a user launch (push, broadcast). */
  @Volatile var startedInBackground = false
    private set

  var onWarmLaunch: ((Double) -> Unit)? = null
    set(value) {
      field = value
      if (value != null) {
        val pending = pendingWarmLaunches.toList()
        pendingWarmLaunches.clear()
        pending.forEach(value)
      }
    }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val pendingWarmLaunches = mutableListOf<Double>()
  private var started = false
  private var startedActivities = 0
  private var createdActivities = 0
  private var wentToBackground = false
  private var warmStartMs: Double? = null

  fun start(application: Application) {
    if (started) return
    started = true
    processStartMs = nowMs() - (SystemClock.uptimeMillis() - processStartUptime())
    startedInBackground = !isForegroundImportance()
    application.registerActivityLifecycleCallbacks(this)
  }

  private fun processStartUptime(): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      Process.getStartRequestedUptimeMillis()
    } else {
      Process.getStartUptimeMillis()
    }

  private fun isForegroundImportance(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  fun nowMs(): Double = System.currentTimeMillis().toDouble()

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
    createdActivities += 1
    if (createdActivities == 1 && coldLaunchMs == null) {
      onNextDraw(activity) {
        if (!startedInBackground) coldLaunchMs = (nowMs() - processStartMs).coerceAtLeast(0.0)
      }
    } else if (wentToBackground && warmStartMs == null) {
      warmStartMs = nowMs()
    }
  }

  override fun onActivityStarted(activity: Activity) {
    startedActivities += 1
    if (startedActivities == 1 && wentToBackground) {
      wentToBackground = false
      val start = warmStartMs ?: nowMs()
      warmStartMs = null
      onNextDraw(activity) { emitWarmLaunch((nowMs() - start).coerceAtLeast(0.0)) }
    }
  }

  override fun onActivityStopped(activity: Activity) {
    startedActivities = (startedActivities - 1).coerceAtLeast(0)
    if (startedActivities == 0 && !activity.isChangingConfigurations) wentToBackground = true
  }

  private fun emitWarmLaunch(durationMs: Double) {
    val callback = onWarmLaunch
    if (callback != null) callback(durationMs) else pendingWarmLaunches.add(durationMs)
  }

  /** Runs [block] right after the next frame of [activity] is drawn. */
  private fun onNextDraw(activity: Activity, block: () -> Unit) {
    val decorView = activity.window?.decorView ?: return
    var fired = false
    val listener = object : ViewTreeObserver.OnDrawListener {
      override fun onDraw() {
        if (fired) return
        fired = true
        mainHandler.postAtFrontOfQueue { block() }
        // Listeners cannot be removed from inside onDraw.
        mainHandler.post { decorView.viewTreeObserver.removeOnDrawListener(this) }
      }
    }
    decorView.viewTreeObserver.addOnDrawListener(listener)
  }

  override fun onActivityResumed(activity: Activity) {}
  override fun onActivityPaused(activity: Activity) {}
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
  override fun onActivityDestroyed(activity: Activity) {}
}
