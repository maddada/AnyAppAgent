package com.anyapp.updates

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Updates for people the app is shared with (Kiwimake docs/DISTRIBUTION.md, stage 4). Same file
 * in every Kiwimake template: do not edit it in an app.
 *
 * The PC writes the app's feed address into the build (`anyapp_update_feed`, empty until the app
 * is shared). The app reads that update.json from GitHub when it opens (at most every 6 hours)
 * and once a day in the background, and when a newer build is out it shows one notification. A tap
 * opens [UpdateActivity], which downloads, checks and installs it.
 *
 * When Kiwimake is on the phone and handles this app (the owner's phone, or a friend who added
 * it in Kiwimake), the app stays silent: Kiwimake shows the update instead.
 */
object AppUpdater {
  const val HOST_ACTION = "com.anyappagent.action.UPDATES"
  const val CHANNEL_ID = "anyapp_updates"
  private const val PREFS = "anyapp_updates"
  private const val NOTIFICATION_ID = 0x5A11
  private const val JOB_ID = 0x5A12
  private const val CHECK_EVERY_MS = 6 * 60 * 60 * 1000L
  private const val TAG = "AnyAppUpdate"

  /** What the person sees, in plain words. */
  sealed class State {
    object Off : State() // not shared: no feed in this build
    object UpToDate : State()
    object HandledByAnyAppAgent : State()
    data class Available(val update: Update) : State()
    data class Problem(val message: String) : State()
  }

  data class Apk(val abi: String, val url: String, val size: Long, val sha256: String)

  data class Update(val build: Long, val version: String, val notes: String, val apk: Apk, val signer: String)

  // ---------------------------------------------------------------- feed and channel

  private fun stringRes(ctx: Context, name: String): String {
    val id = ctx.resources.getIdentifier(name, "string", ctx.packageName)
    return if (id == 0) "" else ctx.getString(id).trim()
  }

  fun feed(ctx: Context): String = stringRes(ctx, "anyapp_update_feed")

  fun testingFeed(ctx: Context): String = stringRes(ctx, "anyapp_update_testing_feed")

  fun isOn(ctx: Context): Boolean = feed(ctx).startsWith("https://")

  /** "testing" also offers test versions; "stable" (the default) only published ones. */
  fun channel(ctx: Context): String = prefs(ctx).getString("channel", "stable") ?: "stable"

  fun setChannel(ctx: Context, channel: String) {
    prefs(ctx).edit().putString("channel", if (channel == "testing") "testing" else "stable").putLong("lastCheck", 0).apply()
  }

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ---------------------------------------------------------------- when to check

  /** Call when the app opens: checks if 6 hours passed, and keeps the daily background check. */
  fun onAppStart(ctx: Context) {
    val app = ctx.applicationContext
    if (!isOn(app)) {
      Log.i(TAG, "off: this build has no update feed (the app is not shared)")
      return
    }
    scheduleDaily(app)
    synchronized(this) {
      // Claimed before the check starts, so a second start (two activities, a reload) checks once.
      if (System.currentTimeMillis() - prefs(app).getLong("lastCheck", 0) < CHECK_EVERY_MS) return
      prefs(app).edit().putLong("lastCheck", System.currentTimeMillis()).commit()
    }
    Thread { runCatching { checkAndNotify(app) } }.start()
  }

  fun scheduleDaily(ctx: Context) {
    val js = ctx.getSystemService(JobScheduler::class.java) ?: return
    if (js.allPendingJobs.any { it.id == JOB_ID }) return
    val job = JobInfo.Builder(JOB_ID, ComponentName(ctx, UpdateJob::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .setPeriodic(24 * 60 * 60 * 1000L)
      .setPersisted(false)
      .build()
    val result = runCatching { js.schedule(job) }
    Log.i(TAG, "daily check scheduled: ${result.getOrNull() == JobScheduler.RESULT_SUCCESS}${result.exceptionOrNull()?.let { " ($it)" } ?: ""}")
  }

  /** Checks now (on a background thread) and shows the notification when there is something new. */
  fun checkAndNotify(ctx: Context): State {
    val state = check(ctx)
    Log.i(TAG, "check: " + when (state) {
      is State.Available -> "build ${state.update.build} (${state.update.version}) is available"
      is State.Problem -> state.message
      is State.HandledByAnyAppAgent -> "Kiwimake handles this app's updates"
      is State.UpToDate -> "up to date"
      is State.Off -> "off"
    })
    if (state is State.Available) notifyAvailable(ctx, state.update) else cancelNotification(ctx)
    return state
  }

  // ---------------------------------------------------------------- the check

  /** Reads the feed(s) and compares with what is installed. Network: call off the main thread. */
  fun check(ctx: Context): State {
    if (!isOn(ctx)) return State.Off
    prefs(ctx).edit().putLong("lastCheck", System.currentTimeMillis()).apply()
    if (handledByAnyAppAgent(ctx)) return State.HandledByAnyAppAgent
    val feeds = listOf(feed(ctx)) + if (channel(ctx) == "testing") listOf(testingFeed(ctx)).filter { it.startsWith("https://") } else emptyList()
    var best: Update? = null
    var problem: String? = null
    for (url in feeds) {
      try {
        val update = parse(ctx, url, readText(url)) ?: continue
        if (best == null || update.build > best.build) best = update
      } catch (e: Exception) {
        problem = "Couldn't check for updates (${e.message ?: "no internet"})."
      }
    }
    val installed = installedBuild(ctx)
    val update = best ?: return if (problem != null) State.Problem(problem) else State.UpToDate
    if (update.build <= installed) return State.UpToDate
    val mine = installedSigner(ctx)
    if (mine != null && update.signer.isNotEmpty() && !update.signer.equals(mine, ignoreCase = true)) {
      return State.Problem("This update can't replace your copy (it is signed differently). Ask whoever shared the app for a new link.")
    }
    return State.Available(update)
  }

  private fun parse(ctx: Context, feedUrl: String, text: String): Update? {
    val doc = JSONObject(text)
    if (doc.optInt("format") != 1 || doc.optString("package") != ctx.packageName) return null
    val build = doc.getLong("build")
    val blocked = doc.optJSONArray("blocked")
    if (blocked != null) for (i in 0 until blocked.length()) if (blocked.getLong(i) == build) return null
    val apks = doc.getJSONArray("apks")
    val all = (0 until apks.length()).map { apks.getJSONObject(it) }
    // This phone's first supported ABI, else the full APK.
    val pick = Build.SUPPORTED_ABIS.firstNotNullOfOrNull { abi -> all.firstOrNull { it.optString("abi") == abi } }
      ?: all.firstOrNull { it.optString("abi") == "universal" } ?: return null
    val base = feedUrl.substring(0, feedUrl.lastIndexOf('/') + 1)
    val apk = Apk(pick.getString("abi"), base + Uri.encode(pick.getString("name")), pick.getLong("size"), pick.getString("sha256").lowercase())
    return Update(build, doc.optString("version", build.toString()), doc.optString("notes"), apk, doc.optString("signer").lowercase())
  }

  private fun readText(url: String): String {
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 15_000
    c.readTimeout = 20_000
    c.instanceFollowRedirects = true
    c.setRequestProperty("Accept", "application/json, application/octet-stream")
    try {
      if (c.responseCode == 404) throw IllegalStateException("nothing published yet")
      if (c.responseCode !in 200..299) throw IllegalStateException("HTTP ${c.responseCode}")
      return c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
    } finally {
      c.disconnect()
    }
  }

  // ---------------------------------------------------------------- this app

  @Suppress("DEPRECATION")
  fun installedBuild(ctx: Context): Long {
    val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
    return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
  }

  /** SHA-256 of the certificate that signs this app now (the newest one after a key rotation). */
  fun installedSigner(ctx: Context): String? = signerOf(
    if (Build.VERSION.SDK_INT >= 28) ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    else @Suppress("DEPRECATION") ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES),
  )

  @Suppress("DEPRECATION")
  fun signerOf(info: PackageInfo?): String? {
    info ?: return null
    val cert = if (Build.VERSION.SDK_INT >= 28) {
      val si = info.signingInfo ?: return null
      if (si.hasMultipleSigners()) return null
      si.signingCertificateHistory?.lastOrNull()
    } else {
      info.signatures?.singleOrNull()
    } ?: return null
    return MessageDigest.getInstance("SHA-256").digest(cert.toByteArray()).joinToString("") { "%02x".format(it) }
  }

  // ---------------------------------------------------------------- Kiwimake first

  /**
   * True when a Kiwimake on this phone says it handles this app's updates (it installed it, or
   * the person added the app there). Then this app shows nothing of its own: one notification only.
   */
  fun handledByAnyAppAgent(ctx: Context): Boolean {
    val pm = ctx.packageManager
    val hosts = runCatching { pm.queryIntentServices(Intent(HOST_ACTION), 0).map { it.serviceInfo.packageName }.distinct() }.getOrDefault(emptyList())
    for (host in hosts) {
      val uri = Uri.parse("content://$host.updates/handles/${ctx.packageName}")
      val handles = runCatching {
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c -> c.moveToFirst() && c.getInt(0) == 1 } ?: false
      }.getOrDefault(false)
      if (handles) return true
    }
    return false
  }

  // ---------------------------------------------------------------- notification

  private fun notifyAvailable(ctx: Context, update: Update) {
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= 26) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "When a new version of this app is out"
      })
    }
    if (prefs(ctx).getLong("notifiedBuild", 0) == update.build && nm.activeNotifications.any { it.id == NOTIFICATION_ID }) return
    val tap = PendingIntent.getActivity(
      ctx, 0, Intent(ctx, UpdateActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(UpdateActivity.EXTRA_START, true),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val label = ctx.applicationInfo.loadLabel(ctx.packageManager).toString()
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= 26) android.app.Notification.Builder(ctx, CHANNEL_ID) else android.app.Notification.Builder(ctx)
    val n = builder
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentTitle("$label ${update.version} is ready")
      .setContentText(update.notes.lineSequence().firstOrNull { it.isNotBlank() }?.removePrefix("- ")?.take(120) ?: "Tap to update.")
      .setStyle(android.app.Notification.BigTextStyle().bigText(update.notes.ifBlank { "Tap to update." }))
      .setContentIntent(tap)
      .setAutoCancel(true)
      .build()
    runCatching { nm.notify(NOTIFICATION_ID, n) }
    prefs(ctx).edit().putLong("notifiedBuild", update.build).apply()
  }

  fun cancelNotification(ctx: Context) {
    ctx.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
  }
}
