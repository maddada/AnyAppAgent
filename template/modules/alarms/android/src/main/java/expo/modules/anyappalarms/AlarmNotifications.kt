package expo.modules.anyappalarms

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object AlarmNotifications {
  /** Alarms without a sound or spoken text: the notification itself makes the sound. */
  const val CHANNEL_SOUND = "anyapp_alarms"
  /** Alarms whose sound or speech is played by AlarmService: the notification stays quiet. */
  const val CHANNEL_QUIET = "anyapp_alarms_spoken"

  private fun ensureChannels(c: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = c.getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL_SOUND) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_SOUND, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Alarms and reminders"
          enableVibration(true)
        }
      )
    }
    if (nm.getNotificationChannel(CHANNEL_QUIET) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_QUIET, "Spoken alarms", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Alarms that play a sound or speak"
          setSound(null, null)
          enableVibration(true)
        }
      )
    }
  }

  private fun smallIcon(c: Context): Int {
    val custom = c.resources.getIdentifier("notification_icon", "drawable", c.packageName)
    return if (custom != 0) custom else android.R.drawable.ic_lock_idle_alarm
  }

  fun build(c: Context, alarm: AlarmData, quiet: Boolean): Notification {
    ensureChannels(c)
    val text = alarm.body ?: alarm.speak
    return NotificationCompat.Builder(c, if (quiet) CHANNEL_QUIET else CHANNEL_SOUND)
      .setSmallIcon(smallIcon(c))
      .setContentTitle(alarm.title)
      .apply { if (text != null) setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text)) }
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setWhen(alarm.at)
      .setShowWhen(true)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(AlarmScheduler.launchPendingIntent(c))
      .build()
  }

  fun post(c: Context, alarm: AlarmData, quiet: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      Log.w(AlarmScheduler.TAG, "Notification permission not granted; alarm ${alarm.id} shows no notification")
      return
    }
    try {
      NotificationManagerCompat.from(c).notify(alarm.notificationId, build(c, alarm, quiet))
      Log.i(AlarmScheduler.TAG, "Notification posted for alarm ${alarm.id}")
    } catch (e: SecurityException) {
      Log.w(AlarmScheduler.TAG, "Could not post notification", e)
    }
  }
}
