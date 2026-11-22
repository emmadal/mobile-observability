import Foundation
import MachO
import MetricKit

/// Captures native crashes (fatal signals, uncaught NSExceptions, MetricKit
/// crash and hang diagnostics) and JS fatals. Reports are stored as JSON files
/// and handed to the JS layer on the next launch.
final class CrashReporter {
  static let shared = CrashReporter()

  private var started = false
  private var jsFatalRecorded = false
  /// Crashes of the previous process already captured by our own handlers.
  /// MetricKit reports the same crashes later, so that many are skipped.
  private var crashesToSkipFromMetricKit = 0
  private var previousExceptionHandler: (@convention(c) (NSException) -> Void)?
  private var metricKitSubscriber: AnyObject?
  private var currentContextJSON = Data("null".utf8)
  private let ioQueue = DispatchQueue(label: "mobile-observability.crash-io")

  func start() {
    guard !started else { return }
    started = true

    rotateCrashContext()
    if convertPreviousSignalCrash() {
      crashesToSkipFromMetricKit += 1
    }
    writeBinaryImages()
    mobs_install_signal_handlers(ObservabilityFiles.signalCrash.path)
    installExceptionHandler()
    if #available(iOS 14.0, *) {
      let subscriber = MetricKitSubscriber(reporter: self)
      MXMetricManager.shared.add(subscriber)
      metricKitSubscriber = subscriber
    }
  }

  // MARK: Context

  func setContext(_ json: String) {
    let data = Data(json.utf8)
    currentContextJSON = data
    data.withUnsafeBytes { buffer in
      if let base = buffer.baseAddress?.assumingMemoryBound(to: CChar.self) {
        mobs_set_crash_context(base, buffer.count)
      }
    }
    ioQueue.async { ObservabilityFiles.writeAtomically(data, to: ObservabilityFiles.crashContext) }
  }

  /// Keeps the context of the previous process so late MetricKit reports can be attributed.
  private func rotateCrashContext() {
    let manager = FileManager.default
    try? manager.removeItem(at: ObservabilityFiles.previousCrashContext)
    try? manager.moveItem(at: ObservabilityFiles.crashContext, to: ObservabilityFiles.previousCrashContext)
  }

  private func previousContext() -> Any {
    ObservabilityFiles.readJSON(ObservabilityFiles.previousCrashContext) ?? NSNull()
  }

  private func currentContext() -> Any {
    (try? JSONSerialization.jsonObject(with: currentContextJSON, options: [.fragmentsAllowed])) ?? NSNull()
  }

  // MARK: JS fatals

  /// Synchronously persists a fatal JS error before React Native terminates the app.
  func persistJsFatal(_ json: String) {
    jsFatalRecorded = true
    guard var report = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else { return }
    report["id"] = report["id"] ?? UUID().uuidString
    report["kind"] = "js_fatal"
    savePending(report)
  }

  // MARK: Pending reports

  func pendingReports() -> [String] {
    let manager = FileManager.default
    let files = (try? manager.contentsOfDirectory(at: ObservabilityFiles.pendingReports, includingPropertiesForKeys: nil)) ?? []
    return files.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { url in
      guard let data = try? Data(contentsOf: url),
            (try? JSONSerialization.jsonObject(with: data)) != nil,
            let text = String(data: data, encoding: .utf8)
      else {
        try? manager.removeItem(at: url)  // partial write: discard
        return nil
      }
      return text
    }
  }

  func deletePending(_ ids: [String]) {
    for id in ids where Self.isSafeId(id) {
      try? FileManager.default.removeItem(at: Self.pendingURL(id))
    }
  }

  private func savePending(_ report: [String: Any]) {
    guard let id = report["id"] as? String, Self.isSafeId(id),
          let data = try? JSONSerialization.data(withJSONObject: report)
    else { return }
    ObservabilityFiles.writeAtomically(data, to: Self.pendingURL(id))
  }

  private static func pendingURL(_ id: String) -> URL {
    ObservabilityFiles.pendingReports.appendingPathComponent("\(id).json")
  }

  private static func isSafeId(_ id: String) -> Bool {
    !id.isEmpty && id.count <= 64 && id.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }
  }

  private static func newReport(kind: String, type: String, message: String, fatal: Bool, timestamp: Double, frames: [[String: Any]], rawStack: String?, context: Any) -> [String: Any] {
    var report: [String: Any] = [
      "id": UUID().uuidString,
      "kind": kind,
      "type": type,
      "message": message,
      "fatal": fatal,
      "timestamp": timestamp,
      "frames": frames,
      "context": context,
    ]
    if let rawStack = rawStack { report["rawStack"] = rawStack }
    return report
  }

  // MARK: Signals

  /// Converts the raw record written by the signal handler in the previous process.
  @discardableResult
  private func convertPreviousSignalCrash() -> Bool {
    let url = ObservabilityFiles.signalCrash
    defer { try? FileManager.default.removeItem(at: url) }
    guard let record = ObservabilityFiles.readJSON(url) as? [String: Any] else { return false }

    let images = BinaryImages.load(from: ObservabilityFiles.binaryImages)
    let addresses = (record["frames"] as? [String]) ?? []
    let frames = addresses.map { images.frame(forHexAddress: $0) }
    let signal = (record["signal"] as? String) ?? "SIGNAL"
    let fault = (record["faultAddress"] as? String) ?? "0x0"
    let timestamp = (record["timestamp"] as? Double) ?? StartupTracker.nowMs()
    savePending(Self.newReport(
      kind: "signal", type: signal, message: "\(signal) at \(fault)", fatal: true,
      timestamp: timestamp, frames: frames, rawStack: addresses.joined(separator: "\n"),
      context: record["context"] ?? NSNull()))
    return true
  }

  private func writeBinaryImages() {
    let data = BinaryImages.snapshotJSON()
    ObservabilityFiles.writeAtomically(data, to: ObservabilityFiles.binaryImages)
  }

  // MARK: NSException

  private func installExceptionHandler() {
    previousExceptionHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler { exception in
      CrashReporter.shared.handle(exception)
      CrashReporter.shared.previousExceptionHandler?(exception)
    }
  }

  private func handle(_ exception: NSException) {
    // React Native turns a fatal JS error into RCTFatalException; the JS layer
    // already persisted the original error with its JS stack.
    if jsFatalRecorded && exception.name.rawValue.hasPrefix("RCTFatalException") {
      mobs_mark_crash_recorded()
      return
    }
    let symbols = exception.callStackSymbols
    savePending(Self.newReport(
      kind: "exception", type: exception.name.rawValue, message: exception.reason ?? "",
      fatal: true, timestamp: StartupTracker.nowMs(),
      frames: symbols.compactMap(BinaryImages.frame(fromSymbolLine:)),
      rawStack: symbols.joined(separator: "\n"), context: currentContext()))
    mobs_mark_crash_recorded()
  }

  // MARK: MetricKit

  @available(iOS 14.0, *)
  fileprivate func handle(_ payloads: [MXDiagnosticPayload]) {
    for payload in payloads {
      for crash in payload.crashDiagnostics ?? [] {
        if crashesToSkipFromMetricKit > 0 {
          crashesToSkipFromMetricKit -= 1
          continue
        }
        savePending(MetricKitConverter.crashReport(crash, context: previousContext()))
      }
      for hang in payload.hangDiagnostics ?? [] {
        savePending(MetricKitConverter.hangReport(hang, context: previousContext()))
      }
    }
  }

  // MARK: Test helpers

  func triggerTestCrash(_ kind: String) {
    switch kind {
    case "exception":
      DispatchQueue.main.async {
        NSException(name: NSExceptionName("MobsTestException"), reason: "Test native exception", userInfo: nil).raise()
      }
    default:
      DispatchQueue.main.async { mobs_trigger_crash(SIGSEGV) }
    }
  }
}

@available(iOS 14.0, *)
private final class MetricKitSubscriber: NSObject, MXMetricManagerSubscriber {
  private weak var reporter: CrashReporter?

  init(reporter: CrashReporter) {
    self.reporter = reporter
  }

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    reporter?.handle(payloads)
  }

  func didReceive(_ payloads: [MXMetricPayload]) {}
}

/// Converts MetricKit diagnostics into pending reports.
@available(iOS 14.0, *)
enum MetricKitConverter {
  static func crashReport(_ crash: MXCrashDiagnostic, context: Any) -> [String: Any] {
    let signal = crash.signal.map { "signal \($0)" } ?? "crash"
    let type = crash.exceptionType.map { "EXC \($0)" } ?? signal
    var message = crash.terminationReason ?? "Crash reported by MetricKit (\(signal))"
    if #available(iOS 17.0, *), let reason = crash.exceptionReason {
      message = "\(reason.exceptionName): \(reason.composedMessage)"
    }
    let json = crash.callStackTree.jsonRepresentation()
    var report = baseReport(kind: "native_crash", type: type, message: message, fatal: true, json: json, context: context)
    report["frames"] = frames(fromCallStackTree: json)
    return report
  }

  static func hangReport(_ hang: MXHangDiagnostic, context: Any) -> [String: Any] {
    let seconds = hang.hangDuration.converted(to: .seconds).value
    let message = String(format: "App hang of %.2f s", seconds)
    let json = hang.callStackTree.jsonRepresentation()
    var report = baseReport(kind: "hang", type: "Hang", message: message, fatal: false, json: json, context: context)
    report["frames"] = frames(fromCallStackTree: json)
    return report
  }

  private static func baseReport(kind: String, type: String, message: String, fatal: Bool, json: Data, context: Any) -> [String: Any] {
    [
      "id": UUID().uuidString,
      "kind": kind,
      "type": type,
      "message": message,
      "fatal": fatal,
      "timestamp": StartupTracker.nowMs(),
      "rawStack": String(data: json, encoding: .utf8) ?? "",
      "context": context,
    ]
  }

  /// Flattens the attributed thread of a call stack tree, following the first sub-frame.
  static func frames(fromCallStackTree json: Data) -> [[String: Any]] {
    guard let tree = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any],
          let stacks = tree["callStacks"] as? [[String: Any]]
    else { return [] }
    let stack = stacks.first { ($0["threadAttributed"] as? Bool) == true } ?? stacks.first
    var frames: [[String: Any]] = []
    var current = (stack?["callStackRootFrames"] as? [[String: Any]])?.first
    let executable = BinaryImages.executableName
    while let frame = current, frames.count < 100 {
      let binary = (frame["binaryName"] as? String) ?? "?"
      let offset = (frame["offsetIntoBinaryTextSegment"] as? NSNumber)?.uint64Value ?? 0
      let address = (frame["address"] as? NSNumber)?.uint64Value ?? 0
      frames.append([
        "module": binary,
        "function": "\(binary) + 0x\(String(offset, radix: 16))",
        "address": "0x\(String(address, radix: 16))",
        "native": true,
        "inApp": binary == executable,
      ])
      current = (frame["subFrames"] as? [[String: Any]])?.first
    }
    return frames
  }
}

/// Loaded binary images, used to turn raw addresses into "image + offset".
struct BinaryImages {
  struct Image {
    let name: String
    let base: UInt64
  }

  let images: [Image]

  static var executableName: String {
    (Bundle.main.executableURL?.lastPathComponent) ?? ""
  }

  static func snapshotJSON() -> Data {
    var list: [[String: Any]] = []
    for index in 0..<_dyld_image_count() {
      guard let header = _dyld_get_image_header(index), let cName = _dyld_get_image_name(index) else { continue }
      let path = String(cString: cName)
      list.append(["name": (path as NSString).lastPathComponent, "base": UInt64(UInt(bitPattern: header))])
    }
    return (try? JSONSerialization.data(withJSONObject: ["executable": executableName, "images": list])) ?? Data()
  }

  static func load(from url: URL) -> BinaryImages {
    guard let root = ObservabilityFiles.readJSON(url) as? [String: Any],
          let raw = root["images"] as? [[String: Any]]
    else { return BinaryImages(images: []) }
    let images = raw.compactMap { entry -> Image? in
      guard let name = entry["name"] as? String, let base = (entry["base"] as? NSNumber)?.uint64Value else { return nil }
      return Image(name: name, base: base)
    }.sorted { $0.base < $1.base }
    return BinaryImages(images: images)
  }

  func frame(forHexAddress hex: String) -> [String: Any] {
    let address = UInt64(hex.dropFirst(2), radix: 16) ?? 0
    guard let image = images.last(where: { $0.base <= address }) else {
      return ["address": hex, "native": true, "inApp": false]
    }
    let offset = address - image.base
    return [
      "module": image.name,
      "function": "\(image.name) + 0x\(String(offset, radix: 16))",
      "address": hex,
      "native": true,
      "inApp": image.name == Self.executableName,
    ]
  }

  /// Parses a line of `callStackSymbols`, e.g.
  /// `3   MyApp   0x0000000102d5c2a4 $s5MyApp3fooyyF + 52`.
  static func frame(fromSymbolLine line: String) -> [String: Any]? {
    let parts = line.split(separator: " ", omittingEmptySubsequences: true)
    guard parts.count >= 4, parts[2].hasPrefix("0x") else { return nil }
    let module = String(parts[1])
    let symbol = parts[3...].joined(separator: " ")
    let function = symbol.components(separatedBy: " + ").first ?? symbol
    return [
      "module": module,
      "function": function,
      "address": String(parts[2]),
      "native": true,
      "inApp": module == executableName,
    ]
  }
}
