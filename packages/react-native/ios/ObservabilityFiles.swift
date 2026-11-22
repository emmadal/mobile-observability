import Foundation

/// File locations used by the native layer. Everything lives under
/// Application Support so it survives restarts but is not user-visible.
enum ObservabilityFiles {
  static let root: URL = {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let url = base.appendingPathComponent("mobile-observability", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }()

  static let pendingReports: URL = directory("pending")
  static let keyValue: URL = directory("kv")
  static let signalCrash = root.appendingPathComponent("signal-crash.json")
  static let binaryImages = root.appendingPathComponent("binary-images.json")
  static let crashContext = root.appendingPathComponent("crash-context.json")
  static let previousCrashContext = root.appendingPathComponent("previous-crash-context.json")

  private static func directory(_ name: String) -> URL {
    let url = root.appendingPathComponent(name, isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  static func writeAtomically(_ data: Data, to url: URL) {
    try? data.write(to: url, options: [.atomic])
  }

  static func readJSON(_ url: URL) -> Any? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
  }
}

/// Small file-backed key/value store used by the JS layer for its event queue.
enum KeyValueStore {
  private static let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))

  private static func url(for key: String) -> URL? {
    guard !key.isEmpty, key.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
    return ObservabilityFiles.keyValue.appendingPathComponent(key)
  }

  static func get(_ key: String) -> String? {
    guard let url = url(for: key), let data = try? Data(contentsOf: url) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func set(_ key: String, _ value: String?) {
    guard let url = url(for: key) else { return }
    if let value = value {
      ObservabilityFiles.writeAtomically(Data(value.utf8), to: url)
    } else {
      try? FileManager.default.removeItem(at: url)
    }
  }
}
