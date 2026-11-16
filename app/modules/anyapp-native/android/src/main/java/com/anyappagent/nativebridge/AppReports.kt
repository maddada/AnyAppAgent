package com.anyappagent.nativebridge

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Crash reports and diaries from apps made with Kiwimake (docs/VERSIONS.md). An app sends them
 * only to the app that installed it, with a `sender` PendingIntent: Android stamps who created it,
 * so the sender cannot be faked. A report is accepted only from an app this Kiwimake installed
 * itself (Android's install source record).
 *
 * Crashes wait in a small queue (at most 20) until the JavaScript side sends them to the PC; a
 * notification "<app> crashed. Fix it?" opens the app's chat. Diaries go straight to JavaScript,
 * which asked for them (AppReports.requestDiary).
 *
 * Feedback ("Send to Kiwimake" on an app's shake-to-give-feedback screen) is taken only from the
 * person's own apps: the picture (a content:// address the app granted to Kiwimake) is copied at
 * once and waits in its own queue, like a crash, until the JavaScript side sends it to the app's
 * chat. The ordered broadcast is answered right away: SENT when JavaScript runs (it sends now),
 * WAITING when it does not (a notification offers to open Kiwimake, which sends it), NOT_YOURS.
 */
class AppReportsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val sender = senderOf(context, intent) ?: return
    when (intent.action) {
      AppReports.ACTION_CRASH -> AppReports.crash(context, sender, intent.getStringExtra("report") ?: return)
      AppReports.ACTION_DIARY -> AppReports.diary(sender, intent.getStringExtra("requestId") ?: return, intent.getStringExtra("diary") ?: "[]")
      AppReports.ACTION_FEEDBACK -> feedback(context, sender, intent)
    }
  }

  private fun feedback(context: Context, sender: String, intent: Intent) {
    if (!UpdatesProvider.owns(context, sender)) {
      resultCode = AppReports.FEEDBACK_NOT_YOURS
      return
    }
    val picture: android.net.Uri? = if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra("picture", android.net.Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra("picture")
    }
    // Only the sender's own feedback provider: never a file of some other app.
    if (picture == null || picture.scheme != "content" || picture.authority != "$sender.anyappfeedback") return
    val pending = goAsync()
    Thread {
      try {
        val ok = AppReports.takeFeedback(
          context, sender, picture,
          intent.getIntExtra("width", 0), intent.getIntExtra("height", 0),
          intent.getStringExtra("notes").orEmpty().take(4000), intent.getStringExtra("screen").orEmpty().take(80),
        )
        if (!ok) {
          pending.resultCode = 0
          pending.finish()
        } else {
          // Answered by JavaScript once it is in the chat (SENT), or WAITING after a few seconds;
          // the broadcast stays open meanwhile, so Android does not freeze Kiwimake mid-send.
          AppReports.feedbackArrived(context, sender, pending)
        }
      } catch (_: Throwable) {
        pending.resultCode = 0
        pending.finish()
      }
    }.start()
  }

  private fun senderOf(context: Context, intent: Intent): String? {
    val pending: PendingIntent? = if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra("sender", PendingIntent::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra("sender")
    }
    val pkg = pending?.creatorPackage ?: return null
    return if (AppReports.installedByUs(context, pkg)) pkg else null
  }
}

object AppReports {
  const val ACTION_CRASH = "com.anyappagent.action.CRASH"
  const val ACTION_DIARY = "com.anyappagent.action.DIARY"
  const val ACTION_DIARY_REQUEST = "com.anyapp.action.DIARY_REQUEST"
  const val ACTION_FEEDBACK = "com.anyappagent.action.FEEDBACK"
  const val FEEDBACK_SENT = 1
  const val FEEDBACK_WAITING = 2
  const val FEEDBACK_NOT_YOURS = 3
  private const val FEEDBACK_PREFS = "anyapp_feedback"
  private const val MAX_FEEDBACK = 20
  private const val MAX_PICTURE_BYTES = 20L * 1024 * 1024
  private const val PREFS = "anyapp_crashes"
  private const val MAX_WAITING = 20
  private val lock = Any()

  /** (packageName) -> a crash is waiting; set by the module while JavaScript runs. */
  @Volatile var onCrash: ((String) -> Unit)? = null
  /** (packageName, token) -> feedback is waiting; set by the module while JavaScript runs. */
  @Volatile var onFeedback: ((String, String) -> Unit)? = null
  /** (packageName, requestId, diary JSON) */
  @Volatile var onDiary: ((String, String, String) -> Unit)? = null

  fun installedByUs(context: Context, pkg: String): Boolean {
    if (pkg == context.packageName) return false
    return try {
      val pm = context.packageManager
      if (Build.VERSION.SDK_INT >= 30) {
        val src = pm.getInstallSourceInfo(pkg)
        src.installingPackageName == context.packageName || src.initiatingPackageName == context.packageName
      } else {
        @Suppress("DEPRECATION")
        pm.getInstallerPackageName(pkg) == context.packageName
      }
    } catch (_: Exception) {
      false
    }
  }

  fun crash(context: Context, pkg: String, reportJson: String) {
    val report = try {
      JSONObject(reportJson)
    } catch (_: Exception) {
      return
    }
    if (reportJson.length > 64 * 1024) return
    synchronized(lock) {
      val list = waiting(context)
      list.put(JSONObject().put("packageName", pkg).put("report", report))
      val kept = JSONArray()
      for (i in maxOf(0, list.length() - MAX_WAITING) until list.length()) kept.put(list.get(i))
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("waiting", kept.toString()).apply()
    }
    notifyCrash(context, pkg, report.optString("kind") == "error")
    onCrash?.invoke(pkg)
  }

  /** The waiting crashes ([{packageName, report}]) and forgets them; JavaScript sends them to the PC. */
  fun takeWaiting(context: Context): String = synchronized(lock) {
    val list = waiting(context)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("waiting").apply()
    list.toString()
  }

  private fun waiting(context: Context): JSONArray = try {
    JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("waiting", "[]"))
  } catch (_: Exception) {
    JSONArray()
  }

  private fun notifyCrash(context: Context, pkg: String, caught: Boolean) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    val pm = context.packageManager
    val name = try {
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      "Your app"
    }
    Notifications.ensureChannels(context)
    val id = 0x0C000000 or (pkg.hashCode() and 0x00FFFFFF)
    val url = "anyappagent://?crash=" + android.net.Uri.encode(pkg)
    val notification = NotificationCompat.Builder(context, Notifications.CHANNEL_READY)
      .setSmallIcon(R.drawable.ic_stat_anyappagent)
      .setContentTitle(if (caught) "$name ran into an error. Fix it?" else "$name crashed. Fix it?")
      .setContentText("Tap to send it to its agent on your PC.")
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_ERROR)
      .setContentIntent(Notifications.openAppIntent(context, id, url))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (_: SecurityException) {
      // notifications not allowed: the card in the chat still shows it
    }
  }

  /** Copies the picture into Kiwimake's own folder and queues it. False when it could not be read. */
  fun takeFeedback(context: Context, pkg: String, picture: android.net.Uri, width: Int, height: Int, notes: String, screen: String): Boolean {
    val folder = java.io.File(context.filesDir, "feedback").apply { mkdirs() }
    val file = java.io.File(folder, "${System.currentTimeMillis()}-${pkg.replace(Regex("[^A-Za-z0-9._]"), "_")}.png")
    var copied = 0L
    context.contentResolver.openInputStream(picture)?.use { input ->
      java.io.FileOutputStream(file).use { output ->
        val buffer = ByteArray(1 shl 16)
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          copied += n
          if (copied > MAX_PICTURE_BYTES) break
          output.write(buffer, 0, n)
        }
      }
    } ?: return false
    if (copied == 0L || copied > MAX_PICTURE_BYTES) {
      file.delete()
      return false
    }
    synchronized(lock) {
      val list = waitingFeedback(context)
      list.put(
        JSONObject().put("packageName", pkg).put("file", file.absolutePath).put("width", width).put("height", height)
          .put("notes", notes).put("screen", screen).put("at", System.currentTimeMillis()),
      )
      val kept = JSONArray()
      for (i in 0 until list.length()) {
        if (i < list.length() - MAX_FEEDBACK) java.io.File(list.getJSONObject(i).optString("file")).delete() else kept.put(list.get(i))
      }
      context.getSharedPreferences(FEEDBACK_PREFS, Context.MODE_PRIVATE).edit().putString("waiting", kept.toString()).apply()
    }
    return true
  }

  private val main = android.os.Handler(android.os.Looper.getMainLooper())
  /** Hand-overs waiting for JavaScript's "it is in the chat" (feedbackSent), by token. */
  private val answering = java.util.concurrent.ConcurrentHashMap<String, BroadcastReceiver.PendingResult>()
  private const val ANSWER_WITHIN_MS = 8_000L

  /**
   * JavaScript runs: it sends now, and [feedbackSent] answers the app SENT; no word within a few
   * seconds answers WAITING (it is still sent, on the next connect). JavaScript not running: WAITING,
   * and a notification offers to open Kiwimake, which sends it.
   */
  fun feedbackArrived(context: Context, pkg: String, pending: BroadcastReceiver.PendingResult) {
    val hook = onFeedback
    if (hook != null) {
      val token = java.util.UUID.randomUUID().toString()
      answering[token] = pending
      main.postDelayed({ answer(token, FEEDBACK_WAITING) }, ANSWER_WITHIN_MS)
      hook(pkg, token)
      return
    }
    pending.resultCode = FEEDBACK_WAITING
    pending.finish()
    notifyFeedbackWaiting(context, pkg)
  }

  /** JavaScript's word on a hand-over: sent to the chat, or not (kept for the next connect). */
  fun feedbackSent(token: String, sent: Boolean) = answer(token, if (sent) FEEDBACK_SENT else FEEDBACK_WAITING)

  private fun answer(token: String, code: Int) {
    val pending = answering.remove(token) ?: return
    try {
      pending.resultCode = code
      pending.finish()
    } catch (_: Exception) {
    }
  }

  private fun notifyFeedbackWaiting(context: Context, pkg: String) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    val pm = context.packageManager
    val name = try {
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      "Your app"
    }
    Notifications.ensureChannels(context)
    val id = 0x0F000000 or (pkg.hashCode() and 0x00FFFFFF)
    val url = "anyappagent://?chat=" + android.net.Uri.encode(pkg)
    val notification = NotificationCompat.Builder(context, Notifications.CHANNEL_READY)
      .setSmallIcon(R.drawable.ic_stat_anyappagent)
      .setContentTitle("Feedback for $name is ready to send")
      .setContentText("Tap to send it to its chat on your PC.")
      .setAutoCancel(true)
      .setContentIntent(Notifications.openAppIntent(context, id, url))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (_: SecurityException) {
    }
  }

  /** The waiting feedback ([{packageName, file, width, height, notes, screen, at}]) and forgets it. */
  fun takeWaitingFeedback(context: Context): String = synchronized(lock) {
    val list = waitingFeedback(context)
    context.getSharedPreferences(FEEDBACK_PREFS, Context.MODE_PRIVATE).edit().remove("waiting").apply()
    list.toString()
  }

  private fun waitingFeedback(context: Context): JSONArray = try {
    JSONArray(context.getSharedPreferences(FEEDBACK_PREFS, Context.MODE_PRIVATE).getString("waiting", "[]"))
  } catch (_: Exception) {
    JSONArray()
  }

  fun diary(pkg: String, requestId: String, diaryJson: String) {
    onDiary?.invoke(pkg, requestId, diaryJson)
  }

  /** Asks an app for its diary; false when the app is not on this phone. */
  fun requestDiary(context: Context, pkg: String, requestId: String): Boolean {
    try {
      context.packageManager.getPackageInfo(pkg, 0)
    } catch (_: Exception) {
      return false
    }
    // Include an app that was just installed and never opened (Android keeps it "stopped" until then).
    context.sendBroadcast(Intent(ACTION_DIARY_REQUEST).setPackage(pkg).putExtra("requestId", requestId).addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES))
    return true
  }
}
