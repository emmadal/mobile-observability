package expo.modules.mobileobservability

import android.app.Application
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MobileObservabilityModule : Module() {
  private val context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MobileObservability")

    Events("onWarmLaunch")

    OnCreate {
      (context as? Application)?.let(ObservabilityRuntime::start)
    }

    OnStartObserving("onWarmLaunch") {
      StartupTracker.onWarmLaunch = { durationMs -> sendEvent("onWarmLaunch", mapOf("durationMs" to durationMs)) }
    }

    OnStopObserving("onWarmLaunch") {
      StartupTracker.onWarmLaunch = null
    }

    Function("getLaunchInfo") {
      buildMap<String, Any> {
        put("processStartTime", StartupTracker.processStartMs)
        put("prewarmed", StartupTracker.startedInBackground)
        StartupTracker.coldLaunchMs?.let { put("coldLaunchMs", it) }
      }
    }

    Function("getAppInfo") { ObservabilityRuntime.appInfo(context) }

    Function("getInstallationId") { ObservabilityRuntime.installationId(context) }

    Function("getDeviceState") { ObservabilityRuntime.deviceState.snapshot() }

    Function("getFrameStats") { FrameTracker.snapshot() }

    Function("stopFrameTracking") { FrameTracker.stop() }

    Function("setCrashContext") { json: String -> ObservabilityRuntime.crashReporter.setContext(json) }

    Function("persistJsFatal") { json: String -> ObservabilityRuntime.crashReporter.persistJsFatal(json) }

    Function("getPendingReports") { ObservabilityRuntime.crashReporter.pendingReports() }

    Function("deletePendingReports") { ids: List<String> -> ObservabilityRuntime.crashReporter.deletePending(ids) }

    Function("storageGet") { key: String -> ObservabilityRuntime.keyValueStore.get(key) }

    AsyncFunction("storageSet") { key: String, value: String? -> ObservabilityRuntime.keyValueStore.set(key, value) }

    Function("triggerTestCrash") { kind: String -> ObservabilityRuntime.crashReporter.triggerTestCrash(kind) }
  }
}
