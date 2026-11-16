// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package com.anyapp.feedback

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.io.File

/**
 * "Send to Kiwimake": hands a feedback picture and its notes to the Kiwimake that installed this
 * app, which puts them in this app's chat on the person's PC. Shown only on the owner's phone
 * (Kiwimake says the app is one of theirs). Kiwimake answers at once: [SENT] (it is sending now),
 * [WAITING] (kept; it sends when Kiwimake opens) or [NOT_YOURS]; no answer means it could not take it.
 *
 * Who sent it cannot be faked: Android stamps the creator of the `sender` PendingIntent, the same
 * proof the crash reports use. The picture goes as a content:// address of [FeedbackProvider],
 * readable by Kiwimake only (a one-off grant), so nothing large rides in the broadcast.
 */
object KiwimakeLink {
  const val ACTION_FEEDBACK = "com.anyappagent.action.FEEDBACK"
  const val SENT = 1
  const val WAITING = 2
  const val NOT_YOURS = 3
  private const val ACTION_IDENTITY = "com.anyapp.action.IDENTITY"

  /** The Kiwimake that installed this app, or null (installed some other way, or none). */
  fun host(context: Context): String? {
    val pm = context.packageManager
    val installer = try {
      if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(context.packageName).installingPackageName
      else @Suppress("DEPRECATION") pm.getInstallerPackageName(context.packageName)
    } catch (_: Exception) {
      null
    }
    return installer?.takeIf { it.startsWith("com.anyappagent") && it != context.packageName }
  }

  /** True when Kiwimake on this phone made this app for this person. IPC: call off the main thread. */
  fun canSend(context: Context): Boolean {
    val host = host(context) ?: return false
    return try {
      context.contentResolver.query(Uri.parse("content://$host.updates/owns/${context.packageName}"), null, null, null, null)?.use { c ->
        c.moveToFirst() && c.getInt(0) == 1
      } ?: false
    } catch (_: Exception) {
      false
    }
  }

  /** Hands [picture] (a file in [FeedbackProvider]'s folder) and [notes] to Kiwimake. [onResult] runs on the main thread. */
  fun send(context: Context, picture: File, width: Int, height: Int, notes: String, screen: String, onResult: (Int) -> Unit) {
    val main = Handler(Looper.getMainLooper())
    var answered = false
    val answer: (Int) -> Unit = { code ->
      main.post {
        if (!answered) {
          answered = true
          onResult(code)
        }
      }
    }
    val host = host(context) ?: run {
      answer(0)
      return
    }
    try {
      val uri = FeedbackProvider.uriFor(context, picture)
      context.grantUriPermission(host, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val sender = PendingIntent.getBroadcast(
        context, 0, Intent(ACTION_IDENTITY).setPackage(context.packageName), PendingIntent.FLAG_IMMUTABLE,
      )
      val intent = Intent(ACTION_FEEDBACK).setPackage(host)
        .putExtra("picture", uri)
        .putExtra("width", width)
        .putExtra("height", height)
        .putExtra("notes", notes.take(4000))
        .putExtra("screen", screen.take(80))
        .putExtra("sender", sender)
        // Foreground: Kiwimake gets up to 10 s to put it in the chat before it answers.
        .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES or Intent.FLAG_RECEIVER_FOREGROUND)
      context.sendOrderedBroadcast(intent, null, object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
          answer(resultCode)
        }
      }, main, 0, null, null)
      main.postDelayed({ answer(0) }, 15_000)
    } catch (_: Throwable) {
      answer(0)
    }
  }
}
