package com.anyapp.abilities

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.os.Build

/**
 * App shortcuts: long-press the app icon for up to 4 quick actions. [icon] is the name of a
 * drawable in the app (for example "glyph_cup_water"); without one the app icon is used.
 * [open] true opens the app with the action; false runs it in the background.
 */
data class Shortcut(val id: String, val label: String, val action: String, val icon: String? = null, val open: Boolean = false, val longLabel: String? = null)

object Shortcuts {
  /** Replaces the app's shortcuts with [list] (the first 4 are shown). Call it when the app starts. */
  fun set(context: Context, list: List<Shortcut>) {
    if (Build.VERSION.SDK_INT < 25) return
    val mgr = context.getSystemService(ShortcutManager::class.java) ?: return
    val infos = list.take(4).mapIndexed { i, s ->
      val intent = Intent(context, ActionActivity::class.java)
        .setAction("com.anyapp.abilities.SHORTCUT")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        .putExtra("action", s.action)
        .putExtra("id", s.id)
        .putExtra("open", if (s.open) "true" else "false")
      val iconRes = s.icon?.let { Actions.res(context, it, "drawable") }?.takeIf { it != 0 }
      ShortcutInfo.Builder(context, s.id)
        .setShortLabel(s.label)
        .setLongLabel(s.longLabel ?: s.label)
        .setRank(i)
        .setIntent(intent)
        .apply {
          if (iconRes != null) setIcon(Icon.createWithResource(context, iconRes))
          else setIcon(Icon.createWithResource(context, context.applicationInfo.icon))
        }
        .build()
    }
    mgr.dynamicShortcuts = infos
  }

  /** Records that the person did [shortcutId] another way, so the launcher can suggest it. */
  fun reportUsed(context: Context, shortcutId: String) {
    if (Build.VERSION.SDK_INT >= 25) context.getSystemService(ShortcutManager::class.java)?.reportShortcutUsed(shortcutId)
  }
}
