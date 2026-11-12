package com.anyappagent.nativebridge

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps Kiwimake's process (and so its connection to the PC, the Easy Connect tunnel included)
 * alive while the PC is working on an app and while an APK is on its way to the phone: a process
 * with a foreground service is never frozen by Android, so a download that started in front
 * carries on, and one that starts in the background (an update announced while it runs) works.
 * Android only lets it START while Kiwimake is in front; once running, its text is changed
 * with [update] (no new start needed, so that also works from the background).
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Your PC is working on your app"
    Notifications.ensureChannels(this)
    try {
      val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(this, text, intent?.getStringExtra(EXTRA_COLOR)), type)
      running = true
    } catch (_: Exception) {
      running = false
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    // Android 15+ caps dataSync services; give up quietly, the app catches up when reopened.
    running = false
    stopSelf()
  }

  companion object {
    const val EXTRA_TEXT = "text"
    const val EXTRA_COLOR = "color"
    const val NOTIFICATION_ID = 7301

    /** True while the service runs in the foreground (this process is not frozen). */
    @Volatile
    var running = false
      private set

    fun notification(context: Context, text: String, color: String?): Notification =
      NotificationCompat.Builder(context, Notifications.CHANNEL_WORKING)
        .setSmallIcon(R.drawable.ic_stat_anyappagent)
        .apply { Notifications.tint(color)?.let { setColor(it) } }
        .setContentTitle(text)
        .setContentText("You'll get a message when it's ready.")
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setContentIntent(Notifications.openAppIntent(context, NOTIFICATION_ID, null))
        .build()

    /** Changes the running service's text in place; false when it is not running. */
    fun update(context: Context, text: String, color: String?): Boolean {
      if (!running) return false
      Notifications.ensureChannels(context)
      val manager = NotificationManagerCompat.from(context)
      // Notifications off: the service still runs, only its text stays as it was.
      if (!manager.areNotificationsEnabled()) return true
      try {
        manager.notify(NOTIFICATION_ID, notification(context, text, color))
      } catch (_: SecurityException) {
      }
      return true
    }
  }
}
