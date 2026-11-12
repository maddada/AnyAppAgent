package expo.modules.anyappupdates

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.anyapp.updates.Ota
import com.anyapp.updates.ReadyPopup
import com.facebook.react.ReactHost
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler
import java.lang.ref.WeakReference

/**
 * Quick updates for React Native apps (Kiwimake docs/FAST-LANE.md): picks the JavaScript bundle
 * the app starts with (a checked quick update, or the APK's own: com.anyapp.updates.Ota), reloads
 * it in place when the person taps Reload, and goes back to the last good bundle when a new one
 * fails at start. Expo finds this class by itself (autolinking): do not remove it.
 */
class AnyappUpdatesPackage : Package {
  private var host: WeakReference<ReactHost>? = null
  private val main = Handler(Looper.getMainLooper())

  override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> {
    val app = context.applicationContext
    return listOf(object : ReactNativeHostHandler {
      override fun getJSBundleFile(useDeveloperSupport: Boolean): String? =
        if (useDeveloperSupport) null else Ota.bundleForLaunch(app)

      override fun onDidCreateReactHost(context: Context, reactNativeHost: ReactHost) {
        host = WeakReference(reactNativeHost)
        ReadyPopup.reloadInPlace = { activity -> reload(activity, "anyapp quick update") }
      }

      override fun onDidCreateReactInstance(useDeveloperSupport: Boolean, reactContext: ReactContext) {
        if (!useDeveloperSupport) Ota.onInstanceCreated(app)
      }

      override fun onReactInstanceException(useDeveloperSupport: Boolean, exception: Exception) {
        if (useDeveloperSupport) return
        if (Ota.onFatal(app, exception)) {
          // The new bundle failed at start: start the app again with the last good one. A restart,
          // not a reload: after a fatal error React Native has already torn its screens down.
          restart(app)
        }
      }
    })
  }

  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        ReadyPopup.install(application)
      }
    })

  /** Opens the app again in a fresh process (the activity start survives the old process). */
  private fun restart(ctx: Context) {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    main.post {
      try {
        if (intent != null) ctx.startActivity(intent)
      } catch (e: Exception) {
        Log.w("AnyAppOta", "could not open the app again", e)
      }
      main.postDelayed({ android.os.Process.killProcess(android.os.Process.myPid()) }, 400)
    }
  }

  private fun reload(activity: Activity?, reason: String): Boolean {
    val h = host?.get() ?: return false
    main.post {
      try {
        if (activity != null && h.lifecycleState != LifecycleState.RESUMED) h.onHostResume(activity)
        h.reload(reason)
      } catch (e: Exception) {
        Log.w("AnyAppOta", "reload failed", e)
      }
    }
    return true
  }
}
