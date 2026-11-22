import Foundation
import QuartzCore
import UIKit

/// Measures cold launch (process start until the first native frame) and warm
/// launch (foreground with a live process until the next frame).
final class StartupTracker: NSObject {
  static let shared = StartupTracker()

  private(set) var processStartMs: Double = 0
  private(set) var coldLaunchMs: Double?
  /// iOS may prewarm the process long before the user taps the icon; such
  /// samples would be inflated, so the cold launch is discarded.
  private(set) var prewarmed = false

  var onWarmLaunch: ((Double) -> Void)? {
    didSet { flushPendingWarmLaunches() }
  }

  private var started = false
  private var firstFrameLink: CADisplayLink?
  private var warmLink: CADisplayLink?
  private var warmStartMs: Double?
  private var didEnterBackground = false
  private var pendingWarmLaunches: [Double] = []

  func start() {
    guard !started else { return }
    started = true
    processStartMs = Self.processStartTimeMs()
    prewarmed = ProcessInfo.processInfo.environment["ActivePrewarm"] == "1"

    let link = CADisplayLink(target: self, selector: #selector(onFirstFrame(_:)))
    link.add(to: .main, forMode: .common)
    firstFrameLink = link

    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(onDidEnterBackground),
      name: UIApplication.didEnterBackgroundNotification, object: nil)
    center.addObserver(
      self, selector: #selector(onWillEnterForeground),
      name: UIApplication.willEnterForegroundNotification, object: nil)
    center.addObserver(
      self, selector: #selector(onDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  @objc private func onFirstFrame(_ link: CADisplayLink) {
    link.invalidate()
    firstFrameLink = nil
    if !prewarmed {
      coldLaunchMs = max(0, Self.nowMs() - processStartMs)
    }
  }

  @objc private func onDidEnterBackground() {
    didEnterBackground = true
  }

  @objc private func onWillEnterForeground() {
    guard didEnterBackground else { return }
    warmStartMs = Self.nowMs()
  }

  @objc private func onDidBecomeActive() {
    guard warmStartMs != nil, warmLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(onWarmFrame(_:)))
    link.add(to: .main, forMode: .common)
    warmLink = link
  }

  @objc private func onWarmFrame(_ link: CADisplayLink) {
    link.invalidate()
    warmLink = nil
    guard let start = warmStartMs else { return }
    warmStartMs = nil
    let duration = max(0, Self.nowMs() - start)
    if let callback = onWarmLaunch {
      callback(duration)
    } else {
      pendingWarmLaunches.append(duration)
    }
  }

  private func flushPendingWarmLaunches() {
    guard let callback = onWarmLaunch else { return }
    let pending = pendingWarmLaunches
    pendingWarmLaunches.removeAll()
    pending.forEach(callback)
  }

  static func nowMs() -> Double {
    Date().timeIntervalSince1970 * 1000
  }

  static func processStartTimeMs() -> Double {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return nowMs() }
    let start = info.kp_proc.p_un.__p_starttime
    return Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
  }
}
