import Foundation
import UIKit

/// Starts every native collector exactly once, from whichever hook runs first
/// (the AppDelegate subscriber, or module creation in apps without ExpoAppDelegate).
enum ObservabilityRuntime {
  private static var started = false

  static func start() {
    guard !started else { return }
    started = true
    StartupTracker.shared.start()
    FrameTracker.shared.start()
    CrashReporter.shared.start()
    DeviceState.shared.start()
  }

  static var isDebugBuild: Bool {
    #if DEBUG
      return true
    #else
      return false
    #endif
  }

  static func installationId() -> String {
    let key = "mobile-observability.installationId"
    if let existing = UserDefaults.standard.string(forKey: key) { return existing }
    let created = UUID().uuidString.lowercased()
    UserDefaults.standard.set(created, forKey: key)
    return created
  }

  static func appInfo() -> [String: Any] {
    let info = Bundle.main.infoDictionary ?? [:]
    var result: [String: Any] = [
      "platform": "ios",
      "version": (info["CFBundleShortVersionString"] as? String) ?? "0.0.0",
      "build": (info["CFBundleVersion"] as? String) ?? "0",
      "bundleId": Bundle.main.bundleIdentifier ?? "",
      "osVersion": UIDevice.current.systemVersion,
      "manufacturer": "Apple",
      "model": modelIdentifier(),
      "locale": Locale.current.identifier,
      "isDebugBuild": isDebugBuild,
    ]
    #if targetEnvironment(simulator)
      result["isEmulator"] = true
    #else
      result["isEmulator"] = false
    #endif
    return result
  }

  private static func modelIdentifier() -> String {
    if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
      return simulated
    }
    var size = 0
    sysctlbyname("hw.machine", nil, &size, nil, 0)
    var machine = [CChar](repeating: 0, count: max(size, 1))
    sysctlbyname("hw.machine", &machine, &size, nil, 0)
    return String(cString: machine)
  }
}
