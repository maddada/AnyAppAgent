package expo.modules.anyappdiary

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Crash catcher (docs in AGENTS.md, "Crashes"). When the app crashes, AnyAppAgent on the phone (the
 * app that installed this one) gets the report and offers the person "Fix it", which sends it to
 * the app's agent. Installed when the app process starts (AnyappDiaryPackage). Fatal JavaScript
 * errors are reported by src/lib/crash.ts first (better stack, the screen) and reach this handler
 * afterwards as a JavascriptException, which is then not sent twice.
 */
object CrashCatcher {
  const val ACTION_CRASH = "com.anyappagent.action.CRASH"
  const val ACTION_IDENTITY = "com.anyapp.action.IDENTITY"
  private const val MAX_STACK = 16 * 1024

  @Volatile private var installed = false
  @Volatile var lastJsReportAt = 0L

  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        val fromJs = error.javaClass.name.endsWith("JavascriptException")
        if (!(fromJs && System.currentTimeMillis() - lastJsReportAt < 10_000)) send(app, "crash", error)
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

  private fun send(context: Context, kind: String, error: Throwable) {
    val name = error.javaClass.simpleName.ifEmpty { error.javaClass.name }
    val message = "$name: ${error.message ?: "no message"}".replace(Regex("\\s+"), " ").trim().take(500)
    val stack = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
    sendReport(context, JSONObject().put("kind", kind).put("message", message).put("stack", stack))
  }

  /**
   * Sends a report ({kind, message, stack?, screen?}); adds when, the version and the diary. Writes
   * a diary note too. Never throws. Returns false when there is nobody to send it to.
   */
  fun sendReport(context: Context, report: JSONObject): Boolean {
    return try {
      val kind = if (report.optString("kind") == "error") "error" else "crash"
      val message = report.optString("message").replace(Regex("\\s+"), " ").trim().take(500).ifEmpty { "Unknown error" }
      Diary.note(context, (if (kind == "crash") "The app crashed: " else "The app caught an error: ") + message.take(120))
      val target = installer(context) ?: return false
      val out = JSONObject()
        .put("kind", kind)
        .put("message", message)
        .put("at", Diary.iso())
        .put("diary", Diary.read(context, 50))
      report.optString("stack").takeIf { it.isNotBlank() }?.let { out.put("stack", it.take(MAX_STACK)) }
      report.optString("screen").takeIf { it.isNotBlank() }?.let { out.put("screen", it.take(80)) }
      versionCode(context)?.let { out.put("versionCode", it) }
      context.sendBroadcast(
        Intent(ACTION_CRASH).setPackage(target).putExtra("report", out.toString()).putExtra("sender", sender(context)),
      )
      true
    } catch (_: Throwable) {
      false
    }
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

  @Suppress("unused")
  private fun empty() = JSONArray()
}
