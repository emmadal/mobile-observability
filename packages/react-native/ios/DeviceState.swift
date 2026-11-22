import Foundation
import Network
import UIKit

/// Device and network conditions attached to time-to-interactive events.
final class DeviceState {
  static let shared = DeviceState()

  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "mobile-observability.network")
  private var path: NWPath?
  private var started = false

  func start() {
    guard !started else { return }
    started = true
    monitor.pathUpdateHandler = { [weak self] path in self?.path = path }
    monitor.start(queue: queue)
    DispatchQueue.main.async { UIDevice.current.isBatteryMonitoringEnabled = true }
  }

  func snapshot() -> [String: Any] {
    var result: [String: Any] = [
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
      "thermalState": Self.thermalState(ProcessInfo.processInfo.thermalState),
    ]
    let device = UIDevice.current
    if device.batteryLevel >= 0 {
      result["batteryLevel"] = Double(device.batteryLevel)
    }
    if device.batteryState != .unknown {
      result["batteryCharging"] = device.batteryState == .charging || device.batteryState == .full
    }
    if let path = path {
      result["networkConnected"] = path.status == .satisfied
      result["networkType"] = Self.networkType(path)
      if path.status == .satisfied {
        result["networkExpensive"] = path.isExpensive
        result["networkConstrained"] = path.isConstrained
      }
    } else {
      result["networkType"] = "unknown"
    }
    return result
  }

  private static func thermalState(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }

  private static func networkType(_ path: NWPath) -> String {
    guard path.status == .satisfied else { return "none" }
    if path.usesInterfaceType(.wifi) { return "wifi" }
    if path.usesInterfaceType(.cellular) { return "cellular" }
    if path.usesInterfaceType(.wiredEthernet) { return "ethernet" }
    return "other"
  }
}
