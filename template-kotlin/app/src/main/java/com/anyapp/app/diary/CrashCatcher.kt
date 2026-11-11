package com.anyapp.app.diary

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Crash catcher. When the app crashes, AnyAppAgent on the phone (the app that installed this one)
 * gets the report and offers the person "Fix it", which sends it to the app's agent. Installed by
 * [com.anyapp.app.AnyApp] when the app process starts: leave that in place.
 *
 * For an exception you catch but want fixed: `CrashCatcher.reportError(context, e, "Settings")`.
 */
object CrashCatcher {
  const val ACTION_CRASH = "com.anyappagent.action.CRASH"
  const val ACTION_IDENTITY = "com.anyapp.action.IDENTITY"
  private const val MAX_STACK = 16 * 1024

  @Volatile private var installed = false

  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        send(app, "crash", error, null)
      } catch (_: Throwable) {
        // never get in the way of the crash itself
      }
      if (previous != null) {
        previous.uncaughtException(thread, error)
      } else {
        android.os.Process.killProcess(android.os.Process.myPid())
        System.exit(10)
      }
    }
  }

  /** Reports an exception the app caught (it keeps running). Never throws. */
  fun reportError(context: Context, error: Throwable, screen: String? = null) {
    try {
      send(context.applicationContext, "error", error, screen)
    } catch (_: Throwable) {
      // nothing to do
    }
  }

  private fun send(context: Context, kind: String, error: Throwable, screen: String?) {
    val name = error.javaClass.simpleName.ifEmpty { error.javaClass.name }
    val message = "$name: ${error.message ?: "no message"}".replace(Regex("\\s+"), " ").trim().take(500)
    Diary.note(context, (if (kind == "crash") "The app crashed: " else "The app caught an error: ") + message.take(120))
    val target = installer(context) ?: return
    val stack = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString().take(MAX_STACK)
    val report = JSONObject()
      .put("kind", kind)
      .put("message", message)
      .put("stack", stack)
      .put("at", Diary.iso())
      .put("diary", Diary.read(context, 50))
    if (!screen.isNullOrBlank()) report.put("screen", screen.take(80))
    versionCode(context)?.let { report.put("versionCode", it) }
    context.sendBroadcast(
      Intent(ACTION_CRASH).setPackage(target).putExtra("report", report.toString()).putExtra("sender", sender(context)),
    )
  }

  /** Proves to AnyAppAgent which app sent a broadcast: Android stamps the creator of a PendingIntent. */
  fun sender(context: Context): PendingIntent = PendingIntent.getBroadcast(
    context, 0, Intent(ACTION_IDENTITY).setPackage(context.packageName), PendingIntent.FLAG_IMMUTABLE,
  )

  /** The app that installed this one (AnyAppAgent), or null when it was installed some other way. */
  fun installer(context: Context): String? {
    val pm = context.packageManager
    val name = try {
      if (Build.VERSION.SDK_INT >= 30) {
        pm.getInstallSourceInfo(context.packageName).installingPackageName
      } else {
        @Suppress("DEPRECATION")
        pm.getInstallerPackageName(context.packageName)
      }
    } catch (_: Exception) {
      null
    }
    if (name.isNullOrBlank() || name == context.packageName || name == "com.android.shell") return null
    return name
  }

  private fun versionCode(context: Context): Long? = try {
    @Suppress("DEPRECATION")
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
  } catch (_: Throwable) {
    null
  }
}
