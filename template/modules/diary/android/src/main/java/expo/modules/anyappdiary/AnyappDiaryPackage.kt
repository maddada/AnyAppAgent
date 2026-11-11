package expo.modules.anyappdiary

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Installs the crash catcher when the app process starts, before any screen or JavaScript runs. */
class AnyappDiaryPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        CrashCatcher.install(application)
      }
    })
}
