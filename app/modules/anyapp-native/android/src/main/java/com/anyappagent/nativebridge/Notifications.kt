package com.anyappagent.nativebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

object Notifications {
  const val CHANNEL_READY = "anyapp_ready"
  const val CHANNEL_WORKING = "anyapp_working"

  /** The accent colour JS passes from the shared theme tokens, or null. */
  fun tint(color: String?): Int? = try {
    if (color.isNullOrBlank()) null else android.graphics.Color.parseColor(color)
  } catch (_: IllegalArgumentException) {
    null
  }

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL_READY) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_READY, "Apps ready to install", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Tells you when a new app or an update is ready."
        }
      )
    }
    if (nm.getNotificationChannel(CHANNEL_WORKING) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_WORKING, "Waiting for your PC", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while your PC is making or changing an app."
          setShowBadge(false)
        }
      )
    }
  }

  /** A PendingIntent that opens AnyAppAgent, optionally with a deep link the JS side handles. */
  fun openAppIntent(context: Context, requestCode: Int, url: String?): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (url != null) {
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.parse(url)
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(context, requestCode, launch, flags)
  }
}
