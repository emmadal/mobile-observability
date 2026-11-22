package expo.modules.mobileobservability

import android.os.Handler
import android.os.Looper
import android.view.Choreographer

/** Counts slow (>= 17 ms) and frozen (>= 700 ms) frames from launch until time to interactive. */
object FrameTracker : Choreographer.FrameCallback {
  private const val TARGET_FRAME_NANOS = 16_666_667L
  private const val SLOW_FRAME_NANOS = 17_000_000L
  private const val FROZEN_FRAME_NANOS = 700_000_000L
  private const val MAX_TRACKING_NANOS = 60_000_000_000L

  @Volatile private var running = false
  private var startNanos = 0L
  private var lastFrameNanos = 0L
  @Volatile var slowFrames = 0
    private set
  @Volatile var frozenFrames = 0
    private set
  @Volatile private var totalDelayNanos = 0L

  fun start() {
    Handler(Looper.getMainLooper()).post {
      if (running) return@post
      running = true
      startNanos = System.nanoTime()
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  fun stop() {
    Handler(Looper.getMainLooper()).post {
      running = false
      Choreographer.getInstance().removeFrameCallback(this)
    }
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!running) return
    if (frameTimeNanos - startNanos > MAX_TRACKING_NANOS) {
      running = false
      return
    }
    if (lastFrameNanos > 0) {
      val duration = frameTimeNanos - lastFrameNanos
      if (duration >= SLOW_FRAME_NANOS) {
        slowFrames += 1
        totalDelayNanos += duration - TARGET_FRAME_NANOS
      }
      if (duration >= FROZEN_FRAME_NANOS) frozenFrames += 1
    }
    lastFrameNanos = frameTimeNanos
    Choreographer.getInstance().postFrameCallback(this)
  }

  fun snapshot(): Map<String, Any> = mapOf(
    "slowFrames" to slowFrames,
    "frozenFrames" to frozenFrames,
    "totalDelayMs" to totalDelayNanos / 1_000_000.0,
  )
}
