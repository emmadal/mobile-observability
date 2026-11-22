package expo.modules.mobileobservability

/** A stack frame in the shape the JS layer expects. */
data class NativeFrame(
  val function: String,
  val file: String?,
  val line: Int?,
  val module: String?,
  val inApp: Boolean,
) {
  fun toMap(): Map<String, Any> = buildMap {
    put("function", function)
    file?.let { put("file", it) }
    line?.takeIf { it >= 0 }?.let { put("line", it) }
    module?.let { put("module", it) }
    put("native", true)
    put("inApp", inApp)
  }
}

object NativeFrames {
  private const val MAX_FRAMES = 100
  private val traceLine = Regex("""^\s*at ([\w$.<>\-]+)\.([\w$<>\-]+)\(([^:)]*)(?::(\d+))?\)""")

  fun fromThrowable(throwable: Throwable, appPackage: String): List<NativeFrame> =
    throwable.stackTrace.take(MAX_FRAMES).map { element ->
      NativeFrame(
        function = "${element.className}.${element.methodName}",
        file = element.fileName,
        line = element.lineNumber,
        module = element.className.substringBeforeLast('.', ""),
        inApp = element.className.startsWith(appPackage),
      )
    }

  /** Extracts the "main" thread's frames from an ANR trace (ApplicationExitInfo.traceInputStream). */
  fun mainThreadFromAnrTrace(trace: String, appPackage: String): List<NativeFrame> {
    val lines = trace.lineSequence().toList()
    val start = lines.indexOfFirst { it.startsWith("\"main\"") }
    if (start < 0) return emptyList()
    val frames = mutableListOf<NativeFrame>()
    for (line in lines.drop(start + 1)) {
      if (line.isBlank() || line.startsWith("\"")) break
      val match = traceLine.find(line) ?: continue
      val (className, method, file, lineNumber) = match.destructured
      frames += NativeFrame(
        function = "$className.$method",
        file = file.takeIf { it.isNotEmpty() && it != "Native method" },
        line = lineNumber.toIntOrNull(),
        module = className.substringBeforeLast('.', ""),
        inApp = className.startsWith(appPackage),
      )
      if (frames.size >= MAX_FRAMES) break
    }
    return frames
  }
}
