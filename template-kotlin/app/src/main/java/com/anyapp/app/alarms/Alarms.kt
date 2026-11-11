package com.anyapp.app.alarms

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * One alarm. [at] is a timestamp in milliseconds (local time, e.g. from java.time or Calendar).
 * Use the same [id] again to replace an alarm.
 */
data class Alarm(
  val id: String,
  val at: Long,
  val title: String,
  /** Notification text; defaults to [speak]. */
  val body: String? = null,
  /** Text spoken aloud on the alarm volume when it fires. */
  val speak: String? = null,
  /** BCP-47 language of [speak], e.g. "en-US" or "ar-AE". Default: the phone's language. */
  val language: String? = null,
  /** Name of a sound in res/raw (without extension), played before [speak]. */
  val sound: String? = null,
  /** true: same time every day. */
  val daily: Boolean = false,
  /** Wake the screen with a full-screen alarm when the phone is locked (only with sound or speak). */
  val fullScreen: Boolean = true,
)

/**
 * Exact alarms that ring, speak and survive the app being closed and the phone rebooting.
 * They use AlarmManager.setAlarmClock, so battery saving never delays them.
 *
 *   Alarms.schedule(context, Alarm(id = "fajr-2026-11-11", at = millis, title = "Fajr", speak = "Time for Fajr"))
 */
object Alarms {
  /** Stores and arms the alarm. Returns true when it is exact (always, for side-loaded apps). */
  fun schedule(context: Context, alarm: Alarm): Boolean {
    require(alarm.id.isNotBlank()) { "Alarm.id is required" }
    require(alarm.at > 0) { "Alarm.at must be a timestamp in milliseconds" }
    val data = alarm.toData()
    val exact = AlarmScheduler.schedule(context, data)
    if (data.speak != null) TtsWarmer.warm(context, data.language)
    return exact
  }

  fun cancel(context: Context, id: String) = AlarmScheduler.cancel(context, id)

  fun cancelAll(context: Context) = AlarmScheduler.cancelAll(context)

  /** Every scheduled alarm, soonest first. */
  fun scheduled(context: Context): List<Alarm> = AlarmStore.all(context).map { it.toAlarm() }

  /** Fires an alarm right now (sound, speech and notification), for a "Test" button. */
  fun testNow(context: Context, alarm: Alarm) = AlarmReceiver.fire(context, alarm.toData())

  /** False if the user turned off full-screen alarms for this app (Android 14+). */
  fun canUseFullScreen(context: Context): Boolean = AlarmNotifications.canUseFullScreen(context)

  /** Opens the system setting for full-screen alarms. */
  fun openFullScreenSettings(context: Context) {
    val intent = if (Build.VERSION.SDK_INT >= 34) {
      Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + context.packageName))
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
    }
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun Alarm.toData() = AlarmData(
    id = id,
    at = at,
    title = title,
    body = body?.takeIf { it.isNotBlank() },
    speak = speak?.takeIf { it.isNotBlank() },
    language = language?.takeIf { it.isNotBlank() },
    sound = sound?.takeIf { it.isNotBlank() },
    repeat = if (daily) "daily" else null,
    fullScreen = fullScreen,
  )

  private fun AlarmData.toAlarm() = Alarm(
    id = id,
    at = at,
    title = title,
    body = body,
    speak = speak,
    language = language,
    sound = sound,
    daily = repeat == "daily",
    fullScreen = fullScreen,
  )
}
