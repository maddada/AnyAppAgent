package expo.modules.appwinautomate

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import expo.modules.kotlin.Promise
import java.util.concurrent.ConcurrentHashMap

/** Automate's notifications: what automations show, the running notice, and the ask-before-sending question. Every one carries Stop all. */
object Notices {
  private const val CH_SHOW = "automate_show"
  private const val CH_RUN = "automate_running"
  private const val CH_ASK = "automate_ask"
  private const val CH_LISTEN = "automate_listening"
  const val RUNNING_ID = 7301
  const val LISTENING_ID = 7304
  private const val STOPPED_ID = 7302
  const val ACTION_STOP_ALL = "expo.modules.appwinautomate.STOP_ALL"
  const val ACTION_ANSWER = "expo.modules.appwinautomate.ANSWER"

  private val questions = ConcurrentHashMap<String, Promise>()
  private val main = Handler(Looper.getMainLooper())

  private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)

  private fun channels(c: Context) {
    val nm = nm(c)
    if (nm.getNotificationChannel(CH_SHOW) == null) {
      nm.createNotificationChannel(NotificationChannel(CH_SHOW, "What automations show", NotificationManager.IMPORTANCE_DEFAULT))
    }
    if (nm.getNotificationChannel(CH_RUN) == null) {
      nm.createNotificationChannel(NotificationChannel(CH_RUN, "Running an automation", NotificationManager.IMPORTANCE_LOW))
    }
    if (nm.getNotificationChannel(CH_LISTEN) == null) {
      nm.createNotificationChannel(NotificationChannel(CH_LISTEN, "Listening for the charger, Wi-Fi or Bluetooth", NotificationManager.IMPORTANCE_MIN))
    }
    if (nm.getNotificationChannel(CH_ASK) == null) {
      nm.createNotificationChannel(NotificationChannel(CH_ASK, "Questions before sending", NotificationManager.IMPORTANCE_HIGH))
    }
  }

  fun canNotify(c: Context) = nm(c).areNotificationsEnabled()

  /** The app's own name (under its icon): the one place it is set is app.json "expo.name". */
  fun appName(c: Context): String = c.applicationInfo.loadLabel(c.packageManager).toString()

  private fun icon(c: Context): Int {
    val custom = c.resources.getIdentifier("notification_icon", "drawable", c.packageName)
    return if (custom != 0) custom else android.R.drawable.ic_popup_reminder
  }

  private fun openApp(c: Context): PendingIntent? {
    val intent = c.packageManager.getLaunchIntentForPackage(c.packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    return PendingIntent.getActivity(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun stopAllAction(c: Context): NotificationCompat.Action {
    val intent = Intent(c, ActionReceiver::class.java).setAction(ACTION_STOP_ALL)
    val pi = PendingIntent.getBroadcast(c, 2, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Action(0, "Stop all", pi)
  }

  fun running(c: Context, label: String?): Notification {
    channels(c)
    return NotificationCompat.Builder(c, CH_RUN)
      .setSmallIcon(icon(c))
      .setContentTitle("Running an automation")
      .setContentText(if (label != null) "${appName(c)}: $label" else appName(c))
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(openApp(c))
      .addAction(stopAllAction(c))
      .build()
  }

  fun listening(c: Context, kinds: Set<String>): Notification {
    channels(c)
    val what = kinds.sorted().map {
      when (it) {
        "wifi" -> "Wi-Fi"
        "bluetooth" -> "Bluetooth"
        "app" -> "the app in front"
        "place" -> "places"
        else -> "the charger"
      }
    }
    return NotificationCompat.Builder(c, CH_LISTEN)
      .setSmallIcon(icon(c))
      .setContentTitle("Listening for ${what.joinToString(", ")}")
      .setContentText(appName(c))
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(openApp(c))
      .addAction(stopAllAction(c))
      .build()
  }

  fun show(c: Context, title: String, body: String?, tag: String) {
    channels(c)
    val n = NotificationCompat.Builder(c, CH_SHOW)
      .setSmallIcon(icon(c))
      .setContentTitle(title)
      .apply { if (body != null) setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body)) }
      .setAutoCancel(true)
      .setContentIntent(openApp(c))
      .addAction(stopAllAction(c))
      .build()
    nm(c).notify(tag, tag.hashCode(), n)
  }

  fun stoppedNotice(c: Context) {
    channels(c)
    nm(c).cancel(RUNNING_ID)
    val n = NotificationCompat.Builder(c, CH_SHOW)
      .setSmallIcon(icon(c))
      .setContentTitle("Everything stopped")
      .setContentText("No automation runs until you resume them in ${appName(c)}.")
      .setAutoCancel(true)
      .setContentIntent(openApp(c))
      .build()
    nm(c).notify(STOPPED_ID, n)
  }

  /** Asks the person with Allow / Don't allow. Answers "allow", "deny" or "timeout". */
  fun ask(c: Context, title: String, text: String, timeoutMs: Long, promise: Promise) {
    channels(c)
    val id = "q" + System.nanoTime().toString(36)
    questions[id] = promise
    fun answerIntent(answer: String, code: Int): PendingIntent {
      val intent = Intent(c, ActionReceiver::class.java).setAction(ACTION_ANSWER).putExtra("question", id).putExtra("answer", answer)
        .setData(android.net.Uri.parse("appwin-automate://ask/$id/$answer"))
      return PendingIntent.getBroadcast(c, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val n = NotificationCompat.Builder(c, CH_ASK)
      .setSmallIcon(icon(c))
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setOngoing(true)
      .addAction(NotificationCompat.Action(0, "Don't allow", answerIntent("deny", 3)))
      .addAction(NotificationCompat.Action(0, "Allow", answerIntent("allow", 4)))
      .build()
    nm(c).notify(id, ASK_ID, n)
    main.postDelayed({ answer(c, id, "timeout") }, timeoutMs)
  }

  fun answer(c: Context, id: String, answer: String) {
    nm(c).cancel(id, ASK_ID)
    questions.remove(id)?.resolve(answer)
  }

  fun denyAllQuestions(c: Context) {
    for (id in questions.keys.toList()) answer(c, id, "deny")
  }

  private const val ASK_ID = 7303
}
