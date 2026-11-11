package expo.modules.anyappalarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/** Receives the AlarmManager broadcast when an alarm is due, even if the app is closed. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(AlarmScheduler.EXTRA_ID) ?: return
    val alarm = AlarmStore.get(context, id)
    if (alarm == null) {
      Log.w(AlarmScheduler.TAG, "Alarm $id fired but was cancelled")
      AlarmDiary.note(context, "An alarm went off after it was cancelled, so it stayed silent")
      return
    }
    Log.i(AlarmScheduler.TAG, "Alarm fired: $id (${alarm.title})")
    AlarmDiary.note(context, "${alarm.title} alarm rang")

    val next = alarm.nextOccurrence(System.currentTimeMillis())
    if (next != null) AlarmScheduler.schedule(context, next) else AlarmStore.remove(context, id)

    fire(context, alarm)
  }

  companion object {
    /** Shows the notification and, when the alarm has a sound or spoken text, plays it. */
    fun fire(context: Context, alarm: AlarmData) {
      if (!alarm.needsPlayback) {
        AlarmNotifications.post(context, alarm, quiet = false)
        return
      }
      AlarmNotifications.post(context, alarm, quiet = true)
      try {
        ContextCompat.startForegroundService(context, AlarmService.intent(context, alarm))
      } catch (e: Exception) {
        // Exact alarms are allowed to start foreground services from the background, so this
        // should not happen; fall back to a notification with sound.
        Log.e(AlarmScheduler.TAG, "Could not start alarm playback", e)
        AlarmDiary.note(context, "${alarm.title} alarm could not play its sound, so it showed a notification")
        AlarmNotifications.post(context, alarm, quiet = false)
      }
    }
  }
}
