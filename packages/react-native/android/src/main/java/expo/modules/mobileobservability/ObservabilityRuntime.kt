package expo.modules.mobileobservability

import android.app.Application
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import java.util.Locale
import java.util.UUID

/** Starts every native collector once, from the Application lifecycle or module creation. */
object ObservabilityRuntime {
  @Volatile private var started = false
  lateinit var files: ObservabilityFiles
    private set
  lateinit var crashReporter: CrashReporter
    private set
  lateinit var keyValueStore: KeyValueStore
    private set
  lateinit var deviceState: DeviceState
    private set

  @Synchronized
  fun start(application: Application) {
    if (started) return
    started = true
    files = ObservabilityFiles(application)
    keyValueStore = KeyValueStore(files)
    deviceState = DeviceState(application)
    crashReporter = CrashReporter(application, files)
    StartupTracker.start(application)
    FrameTracker.start()
    crashReporter.start()
  }

  fun installationId(context: Context): String {
    val preferences = context.getSharedPreferences("mobile-observability", Context.MODE_PRIVATE)
    preferences.getString("installationId", null)?.let { return it }
    val created = UUID.randomUUID().toString()
    preferences.edit().putString("installationId", created).apply()
    return created
  }

  fun appInfo(context: Context): Map<String, Any> {
    val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
    val build = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      packageInfo.longVersionCode.toString()
    } else {
      @Suppress("DEPRECATION")
      packageInfo.versionCode.toString()
    }
    return mapOf(
      "platform" to "android",
      "version" to (packageInfo.versionName ?: "0.0.0"),
      "build" to build,
      "bundleId" to context.packageName,
      "osVersion" to Build.VERSION.RELEASE,
      "manufacturer" to Build.MANUFACTURER,
      "model" to Build.MODEL,
      "locale" to Locale.getDefault().toLanguageTag(),
      "isEmulator" to isEmulator(),
      "isDebugBuild" to ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0),
    )
  }

  private fun isEmulator(): Boolean =
    Build.FINGERPRINT.startsWith("generic") ||
      Build.FINGERPRINT.contains("emulator") ||
      Build.MODEL.contains("sdk_gphone") ||
      Build.MODEL.contains("Emulator") ||
      Build.HARDWARE == "ranchu" ||
      Build.HARDWARE == "goldfish"
}
