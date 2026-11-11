package com.anyapp.app.alarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.anyapp.app.diary.Diary

/** Receives the AlarmManager broadcast when an alarm is due, even if the app is closed. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(AlarmScheduler.EXTRA_ID) ?: return
    val alarm = AlarmStore.get(context, id)
    if (alarm == null) {
      Log.w(AlarmScheduler.TAG, "Alarm $id fired but was cancelled")
      Diary.note(context, "An alarm went off that had been cancelled, so it stayed quiet")
      return
    }
    Log.i(AlarmScheduler.TAG, "Alarm fired: $id (${alarm.title})")
    Diary.note(context, "${alarm.title.take(60)} alarm rang")

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
        Diary.note(context, "${alarm.title.take(60)} alarm could not play its sound (${e.javaClass.simpleName}), showed a notification instead")
        AlarmNotifications.post(context, alarm, quiet = false)
      }
    }
  }
}
