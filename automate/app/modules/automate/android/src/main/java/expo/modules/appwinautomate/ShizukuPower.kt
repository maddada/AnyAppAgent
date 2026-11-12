package expo.modules.appwinautomate

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import rikka.shizuku.Shizuku

/**
 * M7: powers no normal app has, through Shizuku (the person's Shizuku app runs a privileged
 * process after a wireless-debugging pairing, and again after every restart). Only a fixed set of
 * actions, never a command an automation writes: Wi-Fi on and off, mobile data on and off, and
 * stopping another app. The safety locks do not change this list.
 */
object ShizukuPower {
  private const val SHIZUKU_PACKAGE = "moe.shizuku.privileged.api"
  const val REQUEST = 7305

  /** "missing" (Shizuku not installed), "stopped" (installed, not running), "denied", "ready". */
  fun state(c: Context): String {
    val installed = try {
      c.packageManager.getPackageInfo(SHIZUKU_PACKAGE, 0); true
    } catch (e: PackageManager.NameNotFoundException) {
      false
    }
    if (!installed) return "missing"
    return try {
      if (!Shizuku.pingBinder()) "stopped"
      else if (Shizuku.isPreV11()) "stopped"
      else if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) "ready"
      else "denied"
    } catch (e: Throwable) {
      "stopped"
    }
  }

  fun request() {
    try {
      if (Shizuku.pingBinder() && Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) Shizuku.requestPermission(REQUEST)
    } catch (e: Throwable) {
      Log.w(Automate.TAG, "Shizuku permission request failed", e)
    }
  }

  /** Runs one of the fixed actions. Returns "" when done, else why not. */
  fun act(c: Context, action: String, arg: String?): String {
    val cmd = when (action) {
      "wifiOn" -> arrayOf("svc", "wifi", "enable")
      "wifiOff" -> arrayOf("svc", "wifi", "disable")
      "dataOn" -> arrayOf("svc", "data", "enable")
      "dataOff" -> arrayOf("svc", "data", "disable")
      "stopApp" -> {
        val pkg = packageFor(c, arg) ?: return "No app called \"$arg\" on this phone."
        if (pkg == c.packageName || pkg.startsWith("com.android.") || pkg == SHIZUKU_PACKAGE) return "That app can not be stopped by an automation."
        arrayOf("am", "force-stop", pkg)
      }
      else -> return "Unknown action."
    }
    when (state(c)) {
      "missing" -> return "Shizuku is not installed."
      "stopped" -> return "Shizuku is not running (start it again in the Shizuku app after a restart)."
      "denied" -> return "Shizuku has not allowed this app yet."
    }
    return try {
      // Shizuku 13 keeps newProcess private; it is the documented way for one-off commands.
      val m = Shizuku::class.java.getDeclaredMethod("newProcess", Array<String>::class.java, Array<String>::class.java, String::class.java)
      m.isAccessible = true
      val p = m.invoke(null, cmd, null, null) as Process
      val code = p.waitFor()
      if (code == 0) "" else "It did not work (code $code)."
    } catch (e: Throwable) {
      Log.w(Automate.TAG, "Shizuku action failed", e)
      "It did not work: ${e.javaClass.simpleName}."
    }
  }

  private fun packageFor(c: Context, name: String?): String? {
    if (name.isNullOrBlank()) return null
    val pm = c.packageManager
    val wanted = name.lowercase()
    return pm.getInstalledApplications(0).firstOrNull {
      it.packageName.lowercase() == wanted || pm.getApplicationLabel(it).toString().lowercase() == wanted
    }?.packageName
  }
}
