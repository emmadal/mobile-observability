package expo.modules.mobileobservability

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Starts native collection in Application.onCreate, before the JS bundle runs. */
class MobileObservabilityPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          ObservabilityRuntime.start(application)
        }
      },
    )
}
