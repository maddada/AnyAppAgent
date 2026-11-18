package com.anyappagent.nativebridge

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import java.io.File

/**
 * "Add to home screen" for a web app (docs/WEB-APPS.md): a pinned shortcut with the app's own icon
 * that opens Kiwimake straight on the app's web screen (anyappagent://web?app=&url=&name=). The
 * link carries the address, so it opens while the PC is off (the site is public and its service
 * worker keeps it for offline use).
 */
object WebShortcuts {
  /** Launchers scale shortcut icons down anyway; a big bitmap only risks being refused. */
  private const val MAX_ICON_PX = 256

  fun supported(ctx: Context): Boolean = ShortcutManagerCompat.isRequestPinShortcutSupported(ctx)

  /** Asks the launcher to pin it (the launcher shows its own confirmation). False when it cannot. */
  fun pin(ctx: Context, id: String, label: String, link: String, iconPath: String?): Boolean {
    if (!supported(ctx)) return false
    val uri = Uri.parse(link)
    if (uri.scheme != "anyappagent") return false
    val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(ctx.packageName)
    val icon = iconPath?.let { bitmapOf(it) }?.let { IconCompat.createWithBitmap(it) }
      ?: IconCompat.createWithResource(ctx, ctx.applicationInfo.icon)
    val name = label.trim().ifEmpty { "Web app" }
    val info = ShortcutInfoCompat.Builder(ctx, id)
      .setShortLabel(if (name.length > 25) name.take(24) + "…" else name)
      .setLongLabel(name)
      .setIcon(icon)
      .setIntent(intent)
      .build()
    return try {
      // Already pinned: its name, icon and link follow the app (no second icon).
      if (ShortcutManagerCompat.getShortcuts(ctx, ShortcutManagerCompat.FLAG_MATCH_PINNED).any { it.id == id }) {
        ShortcutManagerCompat.updateShortcuts(ctx, listOf(info))
      }
      ShortcutManagerCompat.requestPinShortcut(ctx, info, null)
    } catch (_: Exception) {
      false
    }
  }

  private fun bitmapOf(path: String): Bitmap? = try {
    val file = if (path.startsWith("file:")) File(Uri.parse(path).path ?: return null) else File(path)
    val raw = BitmapFactory.decodeFile(file.absolutePath)
    if (raw == null) null
    else if (raw.width <= MAX_ICON_PX && raw.height <= MAX_ICON_PX) raw
    else Bitmap.createScaledBitmap(raw, MAX_ICON_PX, MAX_ICON_PX * raw.height / raw.width.coerceAtLeast(1), true)
  } catch (_: Exception) {
    null
  }
}
