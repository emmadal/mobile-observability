package expo.modules.mobileobservability

import android.content.Context
import java.io.File

/** File locations used by the native layer, under the app's private files directory. */
class ObservabilityFiles(context: Context) {
  val root = File(context.filesDir, "mobile-observability").apply { mkdirs() }
  val pendingReports = File(root, "pending").apply { mkdirs() }
  val keyValue = File(root, "kv").apply { mkdirs() }
  val crashContext = File(root, "crash-context.json")
  val previousCrashContext = File(root, "previous-crash-context.json")
  val process = File(root, "process.json")
  val previousProcess = File(root, "previous-process.json")

  /** Writes through a temp file and rename so readers never see a partial file. */
  fun writeAtomically(file: File, text: String) {
    val temp = File(file.parentFile, "${file.name}.tmp")
    temp.writeText(text)
    if (!temp.renameTo(file)) {
      file.writeText(text)
      temp.delete()
    }
  }

  fun rotate(current: File, previous: File) {
    previous.delete()
    if (current.exists()) current.renameTo(previous)
  }
}

/** File-backed key/value store used by the JS layer for its event queue. */
class KeyValueStore(private val files: ObservabilityFiles) {
  private val allowed = Regex("^[A-Za-z0-9._-]{1,128}$")

  private fun file(key: String): File? = if (allowed.matches(key)) File(files.keyValue, key) else null

  fun get(key: String): String? = file(key)?.takeIf { it.exists() }?.readText()

  fun set(key: String, value: String?) {
    val target = file(key) ?: return
    if (value == null) target.delete() else files.writeAtomically(target, value)
  }
}
