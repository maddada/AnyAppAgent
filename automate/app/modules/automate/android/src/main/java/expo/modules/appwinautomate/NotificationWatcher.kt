package expo.modules.appwinautomate

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * M3: notifications from other apps. Android binds this service once the person allows
 * notification access (the card opens that page). It reports a notification only when an
 * automation that is on watches its app (or any app), never this app's own, ongoing or group
 * summary ones, and starts the headless runner with { event: { kind: "notification", ... } }.
 * The message itself goes only to the script; the run log names the app, never the text.
 */
class NotificationWatcher : NotificationListenerService() {
  private val recent = HashMap<String, Long>()

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      handle(sbn)
    } catch (e: Exception) {
      Log.w(Automate.TAG, "Could not read a notification", e)
    }
  }

  private fun handle(sbn: StatusBarNotification) {
    val c = applicationContext
    if (Automate.isStopped(c)) return
    val watch = watched(c) ?: return
    if (sbn.packageName == c.packageName) return
    val n = sbn.notification
    if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val app = try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString()
    } catch (e: Exception) {
      sbn.packageName
    }
    if (watch.isNotEmpty() && watch.none { app.lowercase().contains(it) || sbn.packageName.lowercase() == it }) return
    // The same notification updated again within a few seconds is one event.
    val now = System.currentTimeMillis()
    val key = sbn.key
    synchronized(recent) {
      val last = recent[key]
      if (last != null && now - last < 5_000) return
      recent[key] = now
      if (recent.size > 200) recent.entries.removeAll { now - it.value > 60_000 }
    }
    val extras = n.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.take(200)
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.take(1000)
    val event = JSONObject()
      .put("kind", "notification")
      .put("app", app)
      .put("package", sbn.packageName)
      .put("title", title ?: JSONObject.NULL)
      .put("text", text ?: JSONObject.NULL)
    Log.i(Automate.TAG, "Notification event from $app")
    AutomateTaskService.start(c, JSONObject().put("event", event).toString(), "a notification from $app")
  }

  companion object {
    private const val PREFS = "appwin_automate_notifications"

    /** null: no automation watches notifications. Empty: any app. Else lowercase app names or packages. */
    fun watched(c: Context): List<String>? {
      val raw = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("apps", null) ?: return null
      return try {
        val a = JSONArray(raw)
        (0 until a.length()).map { a.getString(it).lowercase() }
      } catch (e: Exception) {
        null
      }
    }

    fun update(c: Context, on: Boolean, apps: List<String>) {
      val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      if (on) p.putString("apps", JSONArray(apps).toString()) else p.remove("apps")
      p.apply()
    }

    fun hasAccess(c: Context): Boolean =
      androidx.core.app.NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.packageName)

    fun component(c: Context) = ComponentName(c, NotificationWatcher::class.java)
  }
}
