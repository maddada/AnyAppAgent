package expo.modules.appwinautomate

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import org.json.JSONObject

/**
 * The native core of Appwin Automate: wake-ups for automations (exact alarms that start the
 * headless runner), Stop all, and Do Not Disturb with a timed restore. All state is in
 * SharedPreferences so it works with the app closed and after a reboot.
 */
object Automate {
  const val TAG = "AppwinAutomate"
  private const val PREFS = "appwin_automate"
  private const val TRIGGERS = "appwin_automate_triggers"
  const val ACTION_TRIGGER = "expo.modules.appwinautomate.TRIGGER"
  const val ACTION_DND_RESTORE = "expo.modules.appwinautomate.DND_RESTORE"
  const val EXTRA_ID = "id"

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private fun triggers(c: Context) = c.getSharedPreferences(TRIGGERS, Context.MODE_PRIVATE)
  private fun alarms(c: Context) = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  // ---------- wake-ups

  fun canExact(c: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms(c).canScheduleExactAlarms()

  /** Stores and arms a wake-up. True when exact. */
  fun arm(c: Context, id: String, at: Long, payload: String): Boolean {
    triggers(c).edit().putString(id, JSONObject().put("at", at).put("payload", payload).toString()).apply()
    return armAlarm(c, triggerIntent(c, id), at)
  }

  private fun armAlarm(c: Context, pi: PendingIntent, at: Long): Boolean {
    val am = alarms(c)
    return if (canExact(c)) {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      true
    } else {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      false
    }
  }

  fun disarm(c: Context, id: String) {
    alarms(c).cancel(triggerIntent(c, id))
    triggers(c).edit().remove(id).apply()
  }

  fun disarmAll(c: Context) {
    for (id in triggers(c).all.keys.toList()) disarm(c, id)
  }

  fun armed(c: Context): List<Map<String, Any>> =
    triggers(c).all.mapNotNull { (id, v) ->
      try {
        val o = JSONObject(v as String)
        mapOf("id" to id, "at" to o.getLong("at").toDouble(), "payload" to o.getString("payload"))
      } catch (e: Exception) {
        null
      }
    }.sortedBy { it["at"] as Double }

  /** The payload of a wake-up that fired, removed from the store (the runtime plans the next one). */
  fun take(c: Context, id: String): String? {
    val raw = triggers(c).getString(id, null) ?: return null
    triggers(c).edit().remove(id).apply()
    return try {
      JSONObject(raw).getString("payload")
    } catch (e: Exception) {
      null
    }
  }

  /** After a reboot: re-arm what is still ahead. The runtime then plans everything again. */
  fun rearmAll(c: Context) {
    val now = System.currentTimeMillis()
    for ((id, v) in triggers(c).all) {
      try {
        val at = JSONObject(v as String).getLong("at")
        if (at > now) armAlarm(c, triggerIntent(c, id), at)
      } catch (e: Exception) {
        Log.w(TAG, "Bad stored trigger $id", e)
      }
    }
  }

  private fun triggerIntent(c: Context, id: String): PendingIntent {
    val intent = Intent(c, TriggerReceiver::class.java)
      .setAction(ACTION_TRIGGER)
      .setData(Uri.parse("appwin-automate://trigger/" + Uri.encode(id)))
      .putExtra(EXTRA_ID, id)
    return PendingIntent.getBroadcast(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  // ---------- Stop all

  fun isStopped(c: Context) = prefs(c).getBoolean("stopped", false)

  /** Nothing runs any more: wake-ups cancelled, Do Not Disturb this app turned on off, speech stopped, open questions answered "no". */
  fun stopAll(c: Context) {
    prefs(c).edit().putBoolean("stopped", true).apply()
    disarmAll(c)
    dndOff(c)
    Speaker.stop()
    Notices.denyAllQuestions(c)
    Log.i(TAG, "Stop all")
  }

  fun resume(c: Context) {
    prefs(c).edit().putBoolean("stopped", false).apply()
  }

  // ---------- Do Not Disturb

  private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)

  fun dndAccess(c: Context) = nm(c).isNotificationPolicyAccessGranted

  fun dndIsOn(c: Context) = nm(c).currentInterruptionFilter > NotificationManager.INTERRUPTION_FILTER_ALL

  /** Priority only (alarms still sound). minutes > 0: turns itself off then. Returns the end time or 0. */
  fun dndOn(c: Context, minutes: Int): Long {
    val nm = nm(c)
    val p = prefs(c)
    if (!p.getBoolean("dnd_ours", false)) {
      p.edit().putInt("dnd_before", nm.currentInterruptionFilter).apply()
    }
    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
    val until = if (minutes > 0) System.currentTimeMillis() + minutes * 60_000L else 0L
    p.edit().putBoolean("dnd_ours", true).putLong("dnd_until", until).apply()
    val pi = dndRestoreIntent(c)
    if (until > 0) armAlarm(c, pi, until) else alarms(c).cancel(pi)
    return until
  }

  /** Turns Do Not Disturb off if this app turned it on (back to what it was). */
  fun dndOff(c: Context): Boolean {
    val p = prefs(c)
    if (!p.getBoolean("dnd_ours", false)) return false
    alarms(c).cancel(dndRestoreIntent(c))
    val before = p.getInt("dnd_before", NotificationManager.INTERRUPTION_FILTER_ALL)
    p.edit().putBoolean("dnd_ours", false).remove("dnd_until").apply()
    return try {
      if (dndAccess(c)) nm(c).setInterruptionFilter(
        if (before == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) NotificationManager.INTERRUPTION_FILTER_ALL else before
      )
      true
    } catch (e: Exception) {
      Log.w(TAG, "Could not end Do Not Disturb", e)
      false
    }
  }

  private fun dndRestoreIntent(c: Context): PendingIntent {
    val intent = Intent(c, TriggerReceiver::class.java).setAction(ACTION_DND_RESTORE)
    return PendingIntent.getBroadcast(c, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** After a reboot: an expired timed Do Not Disturb ends now, a running one is re-armed. */
  fun rearmDnd(c: Context) {
    val p = prefs(c)
    if (!p.getBoolean("dnd_ours", false)) return
    val until = p.getLong("dnd_until", 0L)
    if (until <= 0) return
    if (until <= System.currentTimeMillis()) dndOff(c) else armAlarm(c, dndRestoreIntent(c), until)
  }
}
