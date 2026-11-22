package expo.modules.mobileobservability

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeFramesTest {
  private val trace = """
    ----- pid 1234 at 2026-11-22 10:00:00 -----
    Cmd line: com.example.app

    "main" prio=5 tid=1 Sleeping
      | group="main" sCount=1 ucsCount=0 flags=1 obj=0x72e8 self=0xb400
      at java.lang.Thread.sleep(Native method)
      at java.lang.Thread.sleep(Thread.java:450)
      at com.example.app.CheckoutActivity.onCreate(CheckoutActivity.kt:42)
      at android.app.Activity.performCreate(Activity.java:8000)

    "Signal Catcher" daemon prio=10 tid=2 Runnable
      at dalvik.system.Other.run(Other.java:1)
  """.trimIndent()

  @Test
  fun parsesOnlyTheMainThread() {
    val frames = NativeFrames.mainThreadFromAnrTrace(trace, "com.example.app")
    assertEquals(4, frames.size)
    assertEquals("java.lang.Thread.sleep", frames[0].function)
    assertEquals(null, frames[0].file)
    assertEquals("CheckoutActivity.kt", frames[2].file)
    assertEquals(42, frames[2].line)
    assertTrue(frames[2].inApp)
  }

  @Test
  fun returnsEmptyWhenNoMainThread() {
    assertEquals(0, NativeFrames.mainThreadFromAnrTrace("nothing here", "com.example.app").size)
  }

  @Test
  fun convertsThrowableFrames() {
    val error = IllegalStateException("boom")
    error.stackTrace = arrayOf(StackTraceElement("com.example.app.Cart", "total", "Cart.kt", 7))
    val frames = NativeFrames.fromThrowable(error, "com.example.app")
    assertEquals("com.example.app.Cart.total", frames[0].function)
    assertEquals(7, frames[0].line)
    assertTrue(frames[0].inApp)
  }
}
