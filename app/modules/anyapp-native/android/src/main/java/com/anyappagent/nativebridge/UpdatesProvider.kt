package com.anyappagent.nativebridge

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.util.concurrent.ConcurrentHashMap

/**
 * "Kiwimake first" (docs/DISTRIBUTION.md, stage 5) and the fast lane (docs/FAST-LANE.md). An app
 * made with Kiwimake talks to it here, always about itself only (the caller's package must be
 * the package in the address, so no app learns anything about another one):
 *
 * - `handles/<pkg>` (query): 1 when Kiwimake handles this app's updates (it installed it, or the
 *   person follows it), so the app shows no update notification of its own.
 * - `ready/<pkg>` (query): what Kiwimake has ready for the app now, kind "ota" (a quick update)
 *   or "apk", and the build. Only newer than what the app runs.
 * - `ota/<pkg>` (open): the quick update file. The app checks its signature itself.
 * - `presence/<pkg>` (update, front=1|0): the app is on screen, so Kiwimake leaves the install of
 *   a new APK to the app's Reload popup instead of replacing the app under the person's finger.
 * - `report/<pkg>` (update, running=<build> and/or bad=<build>): the version the app runs now, or a
 *   quick update it refused or rolled back.
 * - `owns/<pkg>` (query): 1 when the app is one of this person's own (it is in the paired PC's app
 *   list), so its "Change this app" row shows even when the owner hid it from others
 *   (docs/CHANGE-THIS-APP.md).
 */
class UpdatesProvider : ContentProvider() {
  companion object {
    private const val PREFS = "anyapp_updates_host"
    private const val FOLLOWED = "followed"
    private const val OWN = "own"
    const val READY_ACTION = "com.anyapp.updates.READY"

    /** Package -> (on screen, when it said so). Kept in memory: a restart forgets it (not on screen). */
    private val presence = ConcurrentHashMap<String, Pair<Boolean, Long>>()

    /**
     * Apps to open again the moment their install succeeds (their Reload popup asked for it).
     * Done in [InstallResultReceiver], while Kiwimake is still on screen: Android refuses an
     * activity start from an app that is no longer visible.
     */
    val reopenAfterInstall: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** Set by the module: an app reported its running version or a rolled-back quick update. */
    @Volatile var reportListener: ((String) -> Unit)? = null

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun followed(ctx: Context): Set<String> = prefs(ctx).getStringSet(FOLLOWED, emptySet()) ?: emptySet()

    /** Apps the person added in Kiwimake from someone's share link: Kiwimake updates them. */
    fun setFollowed(ctx: Context, packages: Collection<String>) {
      prefs(ctx).edit().putStringSet(FOLLOWED, packages.toSet()).apply()
    }

    /** The packages of the person's own apps (the paired PC's list), set by the JavaScript side. */
    fun setOwn(ctx: Context, packages: Collection<String>) {
      prefs(ctx).edit().putStringSet(OWN, packages.toSet()).apply()
    }

    fun owns(ctx: Context, pkg: String): Boolean = pkg in (prefs(ctx).getStringSet(OWN, emptySet()) ?: emptySet())

    fun handles(ctx: Context, pkg: String): Boolean = installedByUs(ctx, pkg) || pkg in followed(ctx)

    private fun installedByUs(ctx: Context, pkg: String): Boolean = try {
      if (Build.VERSION.SDK_INT >= 30) {
        ctx.packageManager.getInstallSourceInfo(pkg).installingPackageName == ctx.packageName
      } else {
        @Suppress("DEPRECATION")
        ctx.packageManager.getInstallerPackageName(pkg) == ctx.packageName
      }
    } catch (_: Exception) {
      false
    }

    // ---------------------------------------------------------------- ready for an app

    private fun otaFile(ctx: Context, pkg: String) = File(File(ctx.filesDir, "ota"), "$pkg.zip")

    /**
     * Records what is ready for [pkg]: kind "ota" (with [file], copied here) or "apk", build [build].
     * Then tells the app (a broadcast only it receives).
     */
    fun setReady(ctx: Context, pkg: String, kind: String, build: Long, file: File?) {
      if (kind == "ota") {
        val src = file ?: throw IllegalArgumentException("a quick update needs its file")
        val dst = otaFile(ctx, pkg)
        dst.parentFile?.mkdirs()
        val tmp = File(dst.parentFile, "$pkg.zip.tmp")
        src.inputStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
        dst.delete()
        if (!tmp.renameTo(dst)) throw IllegalStateException("could not keep the quick update")
      }
      prefs(ctx).edit().putString("ready:$pkg", JSONObject().put("kind", kind).put("build", build).toString()).apply()
      notifyApp(ctx, pkg)
    }

    fun clearReady(ctx: Context, pkg: String) {
      prefs(ctx).edit().remove("ready:$pkg").apply()
      otaFile(ctx, pkg).delete()
    }

    private fun readyEntry(ctx: Context, pkg: String): Pair<String, Long>? = try {
      prefs(ctx).getString("ready:$pkg", null)?.let { JSONObject(it) }?.let { it.getString("kind") to it.getLong("build") }
    } catch (_: Exception) {
      null
    }

    fun notifyApp(ctx: Context, pkg: String) {
      try {
        ctx.sendBroadcast(Intent(READY_ACTION).setPackage(pkg).addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES))
      } catch (_: Exception) {
      }
    }

    fun inFront(pkg: String): Boolean {
      val (front, at) = presence[pkg] ?: return false
      return front && System.currentTimeMillis() - at < 12 * 60 * 60 * 1000L
    }

    // ---------------------------------------------------------------- what the app runs

    fun apkVersion(ctx: Context, pkg: String): Long? = try {
      PackageInfoCompat.getLongVersionCode(ctx.packageManager.getPackageInfo(pkg, 0))
    } catch (_: Exception) {
      null
    }

    /** The app's native fingerprint (string resource anyapp_runtime), "" for an app without the fast lane. */
    fun runtimeOf(ctx: Context, pkg: String): String = try {
      val res = ctx.packageManager.getResourcesForApplication(pkg)
      val id = res.getIdentifier("anyapp_runtime", "string", pkg)
      if (id == 0) "" else res.getString(id).trim()
    } catch (_: Exception) {
      ""
    }

    fun reportedRunning(ctx: Context, pkg: String): Long = prefs(ctx).getLong("running:$pkg", 0)

    fun badBuilds(ctx: Context, pkg: String): Set<Long> = try {
      val a = JSONArray(prefs(ctx).getString("bad:$pkg", "[]"))
      (0 until a.length()).map { a.getLong(it) }.toSet()
    } catch (_: Exception) {
      emptySet()
    }

    /**
     * The version the app shows now: its APK's, or a newer quick update it runs (reported by the
     * app) or has been handed (it checks and unpacks it at once; a refusal comes back as "bad").
     */
    fun effectiveVersion(ctx: Context, pkg: String): Long? {
      val apk = apkVersion(ctx, pkg) ?: return null
      var v = maxOf(apk, reportedRunning(ctx, pkg))
      val ready = readyEntry(ctx, pkg)
      if (ready != null && ready.first == "ota" && ready.second > v && ready.second !in badBuilds(ctx, pkg)) v = ready.second
      return v
    }

    private fun onReport(ctx: Context, pkg: String, values: ContentValues) {
      val e = prefs(ctx).edit()
      values.getAsLong("running")?.let { e.putLong("running:$pkg", it) }
      values.getAsLong("bad")?.let { bad ->
        val all = badBuilds(ctx, pkg) + bad
        e.putString("bad:$pkg", JSONArray(all.sorted().takeLast(50)).toString())
      }
      e.apply()
      reportListener?.invoke(pkg)
    }
  }

  override fun onCreate(): Boolean = true

  /** The package the address is about, when the caller is that package; else null. */
  private fun own(uri: Uri, what: String): String? {
    val segments = uri.pathSegments
    if (segments.size != 2 || segments[0] != what) return null
    val pkg = segments[1]
    return if (callingPackage == pkg) pkg else null
  }

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? {
    val ctx = context ?: return null
    val segments = uri.pathSegments
    if (segments.size != 2) return null
    return when (segments[0]) {
      "handles" -> {
        val pkg = segments[1]
        val answer = if (callingPackage == pkg && handles(ctx, pkg)) 1 else 0
        MatrixCursor(arrayOf("handles")).apply { addRow(arrayOf(answer)) }
      }
      "owns" -> {
        val pkg = segments[1]
        val answer = if (callingPackage == pkg && owns(ctx, pkg)) 1 else 0
        MatrixCursor(arrayOf("owns")).apply { addRow(arrayOf(answer)) }
      }
      "ready" -> {
        val cursor = MatrixCursor(arrayOf("kind", "build"))
        val pkg = own(uri, "ready") ?: return cursor
        val ready = readyEntry(ctx, pkg)
        val apk = apkVersion(ctx, pkg) ?: 0
        val runs = maxOf(apk, reportedRunning(ctx, pkg))
        if (ready != null && ready.second > runs && ready.second !in badBuilds(ctx, pkg) && (ready.first != "ota" || otaFile(ctx, pkg).isFile)) {
          cursor.addRow(arrayOf<Any>(ready.first, ready.second))
        }
        cursor
      }
      else -> null
    }
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
    val ctx = context ?: throw FileNotFoundException()
    val pkg = own(uri, "ota") ?: throw FileNotFoundException("not yours")
    if (mode != "r") throw FileNotFoundException("read only")
    val file = otaFile(ctx, pkg)
    if (!file.isFile) throw FileNotFoundException("nothing ready")
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int {
    val ctx = context ?: return 0
    values ?: return 0
    own(uri, "presence")?.let { pkg ->
      presence[pkg] = ((values.getAsInteger("front") ?: 0) == 1) to System.currentTimeMillis()
      return 1
    }
    own(uri, "report")?.let { pkg ->
      onReport(ctx, pkg, values)
      return 1
    }
    return 0
  }

  override fun getType(uri: Uri): String? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
}

/** Lets apps made with Kiwimake find it (action com.anyappagent.action.UPDATES). Nothing binds to it. */
class UpdatesHostService : android.app.Service() {
  override fun onBind(intent: android.content.Intent?): android.os.IBinder? = null
}
