package com.anyappagent.nativebridge

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps AnyAppAgent's process (and so its connection to the PC) alive while the PC is
 * working on an app, so "ready to install" can be announced even when the app is in the background.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Your PC is working on your app"
    Notifications.ensureChannels(this)
    val notification = NotificationCompat.Builder(this, Notifications.CHANNEL_WORKING)
      .setSmallIcon(R.drawable.ic_stat_anyappagent)
      .apply { Notifications.tint(intent?.getStringExtra(EXTRA_COLOR))?.let { setColor(it) } }
      .setContentTitle(text)
      .setContentText("You'll get a message when it's ready.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(Notifications.openAppIntent(this, NOTIFICATION_ID, null))
      .build()
    try {
      val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    } catch (_: Exception) {
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    // Android 15+ caps dataSync services; give up quietly, the app catches up when reopened.
    stopSelf()
  }

  companion object {
    const val EXTRA_TEXT = "text"
    const val EXTRA_COLOR = "color"
    const val NOTIFICATION_ID = 7301
  }
}
