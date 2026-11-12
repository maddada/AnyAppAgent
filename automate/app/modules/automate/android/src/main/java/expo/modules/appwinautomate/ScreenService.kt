package expo.modules.appwinautomate

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * M6: read the screen and tap, for automations. Off until the person turns it on in Android's
 * Accessibility settings (asked on the card). It does nothing by itself: it only answers
 * read() and tap() from a running automation.
 *
 * The deny-list below can not be turned off, not even with the safety locks off: never in a
 * password field, never in a package installer, Settings or the permission screens (so no
 * automation can install apps, change security settings or grant itself anything), and never in
 * this app (so no automation can approve its own card).
 */
class ScreenService : AccessibilityService() {
  override fun onServiceConnected() {
    instance = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

  override fun onInterrupt() {}

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  companion object {
    @Volatile var instance: ScreenService? = null

    private val DENIED_PREFIXES = listOf(
      "com.android.packageinstaller",
      "com.google.android.packageinstaller",
      "com.android.settings",
      "com.google.android.settings",
      "com.android.permissioncontroller",
      "com.google.android.permissioncontroller",
      "com.android.vending",
      "com.android.systemui",
    )

    fun isOn(c: Context): Boolean {
      val enabled = Settings.Secure.getString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
      return enabled.split(':').any { it.startsWith(c.packageName + "/") }
    }

    private fun denied(c: Context, pkg: String?): String? {
      if (pkg == null) return "Nothing is on the screen."
      if (pkg == c.packageName) return "Not in this app: an automation can not touch its own cards."
      if (DENIED_PREFIXES.any { pkg.startsWith(it) }) return "Not in $pkg: installers, Settings and permission screens are never touched."
      return null
    }

    private fun label(c: Context, pkg: String?): String = try {
      c.packageManager.getApplicationLabel(c.packageManager.getApplicationInfo(pkg ?: "", 0)).toString()
    } catch (e: Exception) {
      pkg ?: ""
    }

    /** { app, texts: [...] } of the window in front (no password fields), or { refused }. */
    fun read(c: Context): String {
      val s = instance ?: return JSONObject().put("refused", "Screen access is off: turn it on on the card.").toString()
      val root = s.rootInActiveWindow ?: return JSONObject().put("refused", "Nothing is on the screen.").toString()
      val pkg = root.packageName?.toString()
      denied(c, pkg)?.let { return JSONObject().put("refused", it).put("app", label(c, pkg)).toString() }
      val texts = JSONArray()
      fun walk(n: AccessibilityNodeInfo?, depth: Int) {
        if (n == null || depth > 40 || texts.length() >= 200) return
        if (!n.isPassword && n.isVisibleToUser) {
          val t = (n.text ?: n.contentDescription)?.toString()?.trim()
          if (!t.isNullOrEmpty()) texts.put(t.take(200))
        }
        for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
      }
      walk(root, 0)
      return JSONObject().put("app", label(c, pkg)).put("texts", texts).toString()
    }

    /** Taps the first visible thing showing `text`. Returns "" when done, else why not. */
    fun tap(c: Context, text: String): String {
      val s = instance ?: return "Screen access is off: turn it on on the card."
      val root = s.rootInActiveWindow ?: return "Nothing is on the screen."
      val pkg = root.packageName?.toString()
      denied(c, pkg)?.let { return it }
      val found = root.findAccessibilityNodeInfosByText(text).firstOrNull { it.isVisibleToUser && !it.isPassword }
        ?: return "\"$text\" is not on the screen."
      var n: AccessibilityNodeInfo? = found
      while (n != null && !n.isClickable) n = n.parent
      val target = n ?: return "\"$text\" can not be tapped."
      if (target.isPassword || target.isEditable) return "Text fields are never tapped."
      return if (target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) "" else "The tap did not go through."
    }
  }
}
