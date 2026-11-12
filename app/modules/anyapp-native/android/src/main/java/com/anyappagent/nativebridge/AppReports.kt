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
 */
class AppReportsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val sender = senderOf(context, intent) ?: return
    when (intent.action) {
      AppReports.ACTION_CRASH -> AppReports.crash(context, sender, intent.getStringExtra("report") ?: return)
      AppReports.ACTION_DIARY -> AppReports.diary(sender, intent.getStringExtra("requestId") ?: return, intent.getStringExtra("diary") ?: "[]")
    }
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
  private const val PREFS = "anyapp_crashes"
  private const val MAX_WAITING = 20
  private val lock = Any()

  /** (packageName) -> a crash is waiting; set by the module while JavaScript runs. */
  @Volatile var onCrash: ((String) -> Unit)? = null
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
