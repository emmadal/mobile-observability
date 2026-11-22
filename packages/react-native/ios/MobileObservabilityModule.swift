import ExpoModulesCore

public class MobileObservabilityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MobileObservability")

    Events("onWarmLaunch")

    OnCreate {
      ObservabilityRuntime.start()
    }

    OnStartObserving("onWarmLaunch") {
      StartupTracker.shared.onWarmLaunch = { [weak self] durationMs in
        self?.sendEvent("onWarmLaunch", ["durationMs": durationMs])
      }
    }

    OnStopObserving("onWarmLaunch") {
      StartupTracker.shared.onWarmLaunch = nil
    }

    Function("getLaunchInfo") { () -> [String: Any] in
      let tracker = StartupTracker.shared
      var info: [String: Any] = [
        "processStartTime": tracker.processStartMs,
        "prewarmed": tracker.prewarmed,
      ]
      if let cold = tracker.coldLaunchMs { info["coldLaunchMs"] = cold }
      return info
    }

    Function("getAppInfo") { () -> [String: Any] in
      ObservabilityRuntime.appInfo()
    }

    Function("getInstallationId") { () -> String in
      ObservabilityRuntime.installationId()
    }

    Function("getDeviceState") { () -> [String: Any] in
      DeviceState.shared.snapshot()
    }

    Function("getFrameStats") { () -> [String: Any] in
      FrameTracker.shared.snapshot()
    }

    Function("stopFrameTracking") {
      DispatchQueue.main.async { FrameTracker.shared.stop() }
    }

    Function("setCrashContext") { (json: String) in
      CrashReporter.shared.setContext(json)
    }

    Function("persistJsFatal") { (json: String) in
      CrashReporter.shared.persistJsFatal(json)
    }

    Function("getPendingReports") { () -> [String] in
      CrashReporter.shared.pendingReports()
    }

    Function("deletePendingReports") { (ids: [String]) in
      CrashReporter.shared.deletePending(ids)
    }

    Function("storageGet") { (key: String) -> String? in
      KeyValueStore.get(key)
    }

    AsyncFunction("storageSet") { (key: String, value: String?) in
      KeyValueStore.set(key, value)
    }

    Function("triggerTestCrash") { (kind: String) in
      CrashReporter.shared.triggerTestCrash(kind)
    }
  }
}
