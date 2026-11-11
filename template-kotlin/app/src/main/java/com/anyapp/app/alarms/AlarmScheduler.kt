package com.anyapp.app.alarms

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import com.anyapp.app.diary.Diary
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object AlarmScheduler {
  const val TAG = "AnyappAlarms"
  const val ACTION_FIRE = "com.anyapp.app.alarms.FIRE"
  const val EXTRA_ID = "id"

  private fun alarmManager(c: Context) = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  fun canScheduleExact(c: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager(c).canScheduleExactAlarms()

  /** Stores and arms the alarm. Returns true when it is exact (always, for side-loaded apps). */
  fun schedule(c: Context, alarm: AlarmData): Boolean {
    AlarmStore.put(c, alarm)
    return arm(c, alarm)
  }

  private fun arm(c: Context, alarm: AlarmData): Boolean {
    val am = alarmManager(c)
    val operation = firePendingIntent(c, alarm.id)
    return if (canScheduleExact(c)) {
      // setAlarmClock is never deferred by Doze or battery savers.
      am.setAlarmClock(AlarmManager.AlarmClockInfo(alarm.at, launchPendingIntent(c)), operation)
      Log.i(TAG, "Scheduled exact alarm ${alarm.id} at ${alarm.at}")
      Diary.note(c, "${alarm.title.take(60)} alarm set for ${timeLabel(alarm.at)}")
      true
    } else {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.at, operation)
      Log.w(TAG, "Exact alarms not allowed; scheduled ${alarm.id} inexactly")
      Diary.note(c, "${alarm.title.take(60)} alarm set for ${timeLabel(alarm.at)}, but not exactly: the phone does not allow exact alarms, so it may ring late")
      false
    }
  }

  /** "15:42" today, "Nov 12 15:42" on another day: for diary notes. */
  private fun timeLabel(at: Long): String {
    val day = SimpleDateFormat("yyyyMMdd", Locale.US)
    val same = day.format(Date(at)) == day.format(Date())
    return SimpleDateFormat(if (same) "HH:mm" else "MMM d HH:mm", Locale.US).format(Date(at))
  }

  fun cancel(c: Context, id: String) {
    alarmManager(c).cancel(firePendingIntent(c, id))
    AlarmStore.remove(c, id)
  }

  fun cancelAll(c: Context) {
    AlarmStore.all(c).forEach { cancel(c, it.id) }
  }

  /** Re-arms every stored alarm (after a reboot, an app update or a clock change). */
  fun rescheduleAll(c: Context) {
    val now = System.currentTimeMillis()
    for (alarm in AlarmStore.all(c)) {
      if (alarm.at > now) {
        arm(c, alarm)
      } else {
        val next = alarm.nextOccurrence(now)
        if (next != null) schedule(c, next) else AlarmStore.remove(c, alarm.id)
      }
    }
  }

  private fun firePendingIntent(c: Context, id: String): PendingIntent {
    val intent = Intent(c, AlarmReceiver::class.java)
      .setAction(ACTION_FIRE)
      .setData(Uri.parse("anyapp-alarm://alarm/" + Uri.encode(id)))
      .putExtra(EXTRA_ID, id)
    return PendingIntent.getBroadcast(
      c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  fun launchPendingIntent(c: Context): PendingIntent? {
    val intent = c.packageManager.getLaunchIntentForPackage(c.packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    return PendingIntent.getActivity(
      c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
