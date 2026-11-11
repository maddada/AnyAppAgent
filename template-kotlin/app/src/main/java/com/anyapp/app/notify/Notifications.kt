package com.anyapp.app.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.anyapp.app.R
import com.anyapp.app.alarms.AlarmScheduler

/** Plain notifications (for alarms that ring and speak, use com.anyapp.app.alarms.Alarms). */
object Notifications {
  private const val CHANNEL = "general"

  fun hasPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  /** Shows a notification now. Does nothing without permission (see [rememberNotificationPermission]). */
  fun notifyNow(context: Context, title: String, text: String? = null, id: Int = (title + text).hashCode()) {
    if (!hasPermission(context)) return
    val nm = context.getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Notifications", NotificationManager.IMPORTANCE_DEFAULT))
    }
    val n = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .apply { if (text != null) setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text)) }
      .setAutoCancel(true)
      .setContentIntent(AlarmScheduler.launchPendingIntent(context))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(id, n)
    } catch (_: SecurityException) {
      // permission was revoked in the meantime
    }
  }
}

/** Asks for the notification permission from a composable. */
class NotificationPermission(granted: Boolean, private val ask: () -> Unit) {
  var granted by mutableStateOf(granted)
    internal set

  /** Shows the system prompt (once; Android remembers "Don't allow"). */
  fun request() = ask()
}

@Composable
fun rememberNotificationPermission(onResult: (Boolean) -> Unit = {}): NotificationPermission {
  val context = LocalContext.current
  var holder: NotificationPermission? = null
  val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
    holder?.granted = ok
    onResult(ok)
  }
  return remember {
    NotificationPermission(Notifications.hasPermission(context)) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
      else onResult(true)
    }
  }.also { holder = it }
}
