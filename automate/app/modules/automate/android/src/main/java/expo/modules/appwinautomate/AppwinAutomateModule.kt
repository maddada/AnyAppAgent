package expo.modules.appwinautomate

import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JavaScript API: modules/automate/index.ts. Only the runtime (src/automate) uses it. */
class AppwinAutomateModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AppwinAutomate")

    AsyncFunction("arm") { id: String, at: Double, payload: String ->
      Automate.arm(context, id, at.toLong(), payload)
    }
    AsyncFunction("disarm") { id: String -> Automate.disarm(context, id) }
    AsyncFunction("disarmAll") { Automate.disarmAll(context) }
    AsyncFunction("armed") { Automate.armed(context) }
    Function("canExact") { Automate.canExact(context) }

    Function("dndAccess") { Automate.dndAccess(context) }
    Function("dndIsOn") { Automate.dndIsOn(context) }
    AsyncFunction("openDndSettings") {
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("dndOn") { minutes: Int -> Automate.dndOn(context, minutes).toDouble() }
    AsyncFunction("dndOff") { Automate.dndOff(context) }

    AsyncFunction("speak") { text: String, language: String?, promise: Promise ->
      Speaker.speak(context, text, language) { problem ->
        if (problem == null) promise.resolve(null) else promise.reject("ERR_SPEAK", problem, null)
      }
    }
    AsyncFunction("notify") { title: String, body: String?, tag: String ->
      Notices.show(context, title, body, tag)
    }
    Function("canNotify") { Notices.canNotify(context) }

    AsyncFunction("ask") { title: String, text: String, timeoutMs: Double, promise: Promise ->
      Notices.ask(context, title, text, timeoutMs.toLong(), promise)
    }

    Function("isStopped") { Automate.isStopped(context) }
    AsyncFunction("stopAll") { Automate.stopAll(context) }
    AsyncFunction("resume") { Automate.resume(context) }

    AsyncFunction("listen") { kinds: List<String>, apps: List<String>, appWatches: String, places: String ->
      NotificationWatcher.update(context, "notification" in kinds, apps)
      ListenerService.setAppWatches(context, appWatches)
      Places.update(context, places)
      ListenerService.update(context, kinds.filter { it != "notification" }.toSet())
    }
    Function("usageAccess") { ListenerService.usageAccess(context) }
    AsyncFunction("openUsageAccess") {
      context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    Function("screenOn") { ScreenService.isOn(context) }
    AsyncFunction("openScreenSettings") {
      context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("screenRead") { ScreenService.read(context) }
    AsyncFunction("screenTap") { text: String -> ScreenService.tap(context, text) }
    Function("shizukuState") { ShizukuPower.state(context) }
    AsyncFunction("shizukuRequest") { ShizukuPower.request() }
    AsyncFunction("shizukuAct") { action: String, arg: String? -> ShizukuPower.act(context, action, arg) }
    Function("notificationAccess") { NotificationWatcher.hasAccess(context) }
    AsyncFunction("openNotificationAccess") {
      val intent = if (android.os.Build.VERSION.SDK_INT >= 30) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
          .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, NotificationWatcher.component(context).flattenToString())
      } else {
        Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
      }
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("openAppInfo") {
      context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }
    Function("hasPermission") { name: String ->
      context.checkSelfPermission(name) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }
  }
}
