package com.anyapp.updates

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log

/**
 * "Change this app" (AnyAppAgent docs/CHANGE-THIS-APP.md). Same file in every AnyAppAgent template:
 * do not edit it in an app.
 *
 * Every app has a "Change this app" row in its settings. A tap:
 * - with AnyAppAgent on this phone: opens it with anyappagent://change?package=...&name=...&owner=...
 *   &repo=...&build=...&version=...&screen=... AnyAppAgent works out the rest: the owner lands in this
 *   app's chat; anyone else can suggest a change, or make their own version on their own PC;
 * - without AnyAppAgent: [ChangeSheet], drawn here so it works offline: what AnyAppAgent is, what an
 *   own version needs, Get AnyAppAgent, and Suggest a change (a text through the share menu).
 *
 * The PC writes two values into the build: `anyapp_change_owner` (the owner's name) and
 * `anyapp_change_others` ("0" when only the owner's phone shows the row). The owner's phone is the
 * one whose AnyAppAgent has this app in its list (`owns/<this package>` on its provider).
 */
object ChangeThisApp {
  private const val TAG = "AnyAppChange"
  const val ANYAPPAGENT_PACKAGE = "com.anyappagent"
  /** Declared only by AnyAppAgent versions that know anyappagent://change (older copies are skipped). */
  const val CHANGE_ACTION = "com.anyappagent.action.CHANGE"
  const val GET_ANYAPPAGENT_URL = "https://github.com/maddada/AnyAppAgent/releases/latest"

  private fun stringRes(ctx: Context, name: String): String {
    val id = ctx.resources.getIdentifier(name, "string", ctx.packageName)
    return if (id == 0) "" else ctx.getString(id).trim()
  }

  /** The owner's name, as the PC wrote it into the build ("" when unknown). */
  fun owner(ctx: Context): String = stringRes(ctx, "anyapp_change_owner")

  /** False when the owner switched "Show Change this app to others" off. */
  fun showToOthers(ctx: Context): Boolean = stringRes(ctx, "anyapp_change_others") != "0"

  /** owner/anyapp-<slug>-releases when the app is shared on GitHub, from its update feed; else "". */
  fun releasesRepo(ctx: Context): String {
    val m = Regex("^https://github\\.com/([A-Za-z0-9-]+)/(anyapp-[a-z0-9-]+-releases)/").find(AppUpdater.feed(ctx))
    return if (m == null) "" else "${m.groupValues[1]}/${m.groupValues[2]}"
  }

  fun appName(ctx: Context): String = runCatching { ctx.applicationInfo.loadLabel(ctx.packageManager).toString() }.getOrDefault("this app")

  fun build(ctx: Context): Long = runCatching {
    val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
    if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
  }.getOrDefault(0L)

  fun version(ctx: Context): String = runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" }.getOrDefault("")

  /**
   * The AnyAppAgent to open: the one that installed this app, else the usual package, else any copy
   * on the phone (found by its action, so a test copy under another package works the same).
   */
  fun hosts(ctx: Context): List<String> = runCatching {
    ctx.packageManager.queryIntentActivities(Intent(CHANGE_ACTION, Uri.parse("anyappagent://change")), 0)
      .map { it.activityInfo.packageName }.distinct()
  }.getOrDefault(emptyList())

  fun host(ctx: Context): String? {
    val hosts = hosts(ctx)
    if (hosts.isEmpty()) return null
    val installer = runCatching {
      if (Build.VERSION.SDK_INT >= 30) ctx.packageManager.getInstallSourceInfo(ctx.packageName).installingPackageName
      else @Suppress("DEPRECATION") ctx.packageManager.getInstallerPackageName(ctx.packageName)
    }.getOrNull()
    return hosts.firstOrNull { it == installer } ?: hosts.firstOrNull { it == ANYAPPAGENT_PACKAGE } ?: hosts.first()
  }

  /** True when an AnyAppAgent on this phone made this app (it is in its list). IPC: off the main thread. */
  fun isMine(ctx: Context): Boolean = hosts(ctx).any { host ->
    runCatching {
      ctx.contentResolver.query(Uri.parse("content://$host.updates/owns/${ctx.packageName}"), null, null, null, null)?.use { c ->
        c.moveToFirst() && c.getInt(0) == 1
      } ?: false
    }.getOrDefault(false)
  }

  /** Whether the row shows: always on the owner's phone, elsewhere unless the owner hid it. Off the main thread. */
  fun visible(ctx: Context): Boolean = showToOthers(ctx) || isMine(ctx)

  fun link(ctx: Context, screen: String?): Uri = Uri.parse("anyappagent://change").buildUpon().apply {
    appendQueryParameter("package", ctx.packageName)
    appendQueryParameter("name", appName(ctx))
    owner(ctx).takeIf { it.isNotEmpty() }?.let { appendQueryParameter("owner", it) }
    releasesRepo(ctx).takeIf { it.isNotEmpty() }?.let { appendQueryParameter("repo", it) }
    build(ctx).takeIf { it > 0 }?.let { appendQueryParameter("build", it.toString()) }
    version(ctx).takeIf { it.isNotEmpty() }?.let { appendQueryParameter("version", it) }
    screen?.takeIf { it.isNotBlank() }?.let { appendQueryParameter("screen", it.take(40)) }
  }.build()

  /** The row's tap: AnyAppAgent when it is on the phone, else the explanation sheet. */
  fun open(activity: Activity, screen: String? = "settings") {
    val host = host(activity)
    if (host != null) {
      val started = runCatching {
        activity.startActivity(Intent(CHANGE_ACTION, link(activity, screen)).setPackage(host).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      }.onFailure { Log.w(TAG, "could not open $host", it) }.getOrDefault(false)
      if (started) {
        Log.i(TAG, "opened $host")
        return
      }
    }
    Log.i(TAG, "no AnyAppAgent here: the explanation sheet")
    activity.startActivity(Intent(activity, ChangeSheet::class.java))
  }

  // ---------------------------------------------------------------- the suggestion text

  /**
   * The suggestion message, exactly as AnyAppAgent writes it (shared/chat/suggestions.ts): the owner
   * shares it into AnyAppAgent or pastes it on the PC, and the last line files it under this app.
   */
  fun suggestionText(ctx: Context, from: String, text: String): String {
    val who = from.replace('\u2014', ',').replace(Regex("[\\r\\n]+"), " ").trim().take(60).ifEmpty { "Someone" }
    val app = appName(ctx).replace(Regex("[\\r\\n]+"), " ").trim().take(80).ifEmpty { "your app" }
    val body = text.replace("\u2014", ", ").trim().take(2000)
    val b = build(ctx)
    return listOf(
      "$who suggests a change to $app:",
      "",
      body,
      "",
      "If you made $app with AnyAppAgent, share this message to AnyAppAgent or paste it there.",
      "anyapp-suggestion: ${ctx.packageName}${if (b > 0) " $b" else ""}",
    ).joinToString("\n")
  }

  /** Opens Android's share menu with the suggestion (WhatsApp, SMS, email...). */
  fun shareSuggestion(activity: Activity, from: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain")
      .putExtra(Intent.EXTRA_TEXT, suggestionText(activity, from, text))
      .putExtra(Intent.EXTRA_SUBJECT, "A change for ${appName(activity)}")
    activity.startActivity(Intent.createChooser(send, "Send your suggestion"))
  }
}
