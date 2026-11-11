package com.anyapp.updates

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import java.io.InputStream

/**
 * The app's side of "AnyAppAgent first" (AnyAppAgent docs/DISTRIBUTION.md stage 5 and
 * docs/FAST-LANE.md). Same file in every AnyAppAgent template: do not edit it in an app.
 *
 * Apps cannot reach the PC by themselves, so new versions come through AnyAppAgent on the phone.
 * Its provider (content://<AnyAppAgent>.updates/...) answers only the app asking about itself:
 * - `ready/<this package>`: what AnyAppAgent has for this app now (kind "ota" or "apk", build);
 * - `ota/<this package>`: the quick update file (checked here again, see [Ota]);
 * - `presence/<this package>`: this app is on screen or not (then AnyAppAgent does not install an
 *   APK over it by itself, it lets the app's Reload popup start the install);
 * - `report/<this package>`: the version running now, or a quick update that was rolled back.
 * Nothing here can make the app run code it did not check: the signature check is in [Ota].
 */
object HostLink {
  private const val TAG = "AnyAppUpdate"

  data class Ready(val host: String, val kind: String, val build: Long)

  /** AnyAppAgent copies on this phone (found by the action, so a test copy works the same). */
  fun hosts(ctx: Context): List<String> = runCatching {
    ctx.packageManager.queryIntentServices(Intent(AppUpdater.HOST_ACTION), 0).map { it.serviceInfo.packageName }.distinct()
  }.getOrDefault(emptyList())

  private fun uri(host: String, what: String, ctx: Context) = Uri.parse("content://$host.updates/$what/${ctx.packageName}")

  /** The newest version an AnyAppAgent on this phone has ready for this app, or null. */
  fun ready(ctx: Context): Ready? {
    var best: Ready? = null
    for (host in hosts(ctx)) {
      val r = runCatching {
        ctx.contentResolver.query(uri(host, "ready", ctx), null, null, null, null)?.use { c ->
          if (!c.moveToFirst()) return@use null
          val kind = c.getString(c.getColumnIndexOrThrow("kind")) ?: ""
          val build = c.getLong(c.getColumnIndexOrThrow("build"))
          if ((kind == "ota" || kind == "apk") && build > 0) Ready(host, kind, build) else null
        }
      }.getOrNull()
      if (r != null && (best == null || r.build > best.build)) best = r
    }
    return best
  }

  fun openOta(ctx: Context, host: String): InputStream? = runCatching { ctx.contentResolver.openInputStream(uri(host, "ota", ctx)) }.getOrNull()

  /** Tells every AnyAppAgent whether this app is on screen. */
  fun presence(ctx: Context, front: Boolean) {
    for (host in hosts(ctx)) {
      runCatching { ctx.contentResolver.update(uri(host, "presence", ctx), ContentValues().apply { put("front", if (front) 1 else 0) }, null, null) }
    }
  }

  /** The version running now, and/or a quick update that was refused or rolled back. */
  fun report(ctx: Context, running: Long? = null, bad: Long? = null) {
    val values = ContentValues().apply {
      if (running != null) put("running", running)
      if (bad != null) put("bad", bad)
    }
    for (host in hosts(ctx)) {
      runCatching { ctx.contentResolver.update(uri(host, "report", ctx), values, null, null) }
        .onFailure { Log.i(TAG, "report to $host failed: $it") }
    }
  }

  /** Hands the install of a new APK to AnyAppAgent: it installs it and opens this app again. */
  fun openInstall(activity: Activity, host: String): Boolean = runCatching {
    activity.startActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse("anyappagent://?update=${Uri.encode(activity.packageName)}"))
        .setPackage(host)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    true
  }.getOrDefault(false)
}
