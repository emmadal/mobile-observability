import Foundation
import QuartzCore

/// Counts slow (>= 17 ms) and frozen (>= 700 ms) frames from launch until the
/// JS layer reads the stats at time to interactive.
final class FrameTracker: NSObject {
  static let shared = FrameTracker()

  private static let targetFrameSeconds = 1.0 / 60.0
  private static let slowFrameSeconds = 0.017
  private static let frozenFrameSeconds = 0.7
  private static let maxTrackingSeconds = 60.0

  private var link: CADisplayLink?
  private var lastTimestamp: CFTimeInterval = 0
  private var startedAt: CFTimeInterval = 0
  private(set) var slowFrames = 0
  private(set) var frozenFrames = 0
  private(set) var totalDelaySeconds = 0.0

  func start() {
    guard link == nil else { return }
    startedAt = CACurrentMediaTime()
    let displayLink = CADisplayLink(target: self, selector: #selector(onFrame(_:)))
    displayLink.add(to: .main, forMode: .common)
    link = displayLink
  }

  func stop() {
    link?.invalidate()
    link = nil
  }

  @objc private func onFrame(_ displayLink: CADisplayLink) {
    let timestamp = displayLink.timestamp
    defer { lastTimestamp = timestamp }
    if timestamp - startedAt > Self.maxTrackingSeconds {
      stop()
      return
    }
    guard lastTimestamp > 0 else { return }
    let duration = timestamp - lastTimestamp
    if duration >= Self.slowFrameSeconds {
      slowFrames += 1
      totalDelaySeconds += duration - Self.targetFrameSeconds
    }
    if duration >= Self.frozenFrameSeconds {
      frozenFrames += 1
    }
  }

  func snapshot() -> [String: Any] {
    [
      "slowFrames": slowFrames,
      "frozenFrames": frozenFrames,
      "totalDelayMs": totalDelaySeconds * 1000,
    ]
  }
}
