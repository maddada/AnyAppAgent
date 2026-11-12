package com.anyapp.updates

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertificateFactory
import java.util.zip.ZipFile

/**
 * Quick updates (Kiwimake docs/FAST-LANE.md). Same file in every Kiwimake template: do not
 * edit it in an app.
 *
 * A quick update is a new JavaScript bundle and its pictures, made by the PC when a change needed
 * no native work. Kiwimake hands it over ([ReadyPopup], [HostLink]); this file checks it and
 * decides which bundle the app starts with:
 *
 * - **Checked before anything runs:** ota.json must be signed by the key this app is signed with
 *   (its own certificate, so only whoever can sign an APK of this app can make one), name this
 *   package and this build's native fingerprint (`anyapp_runtime`), be newer than what runs, and
 *   every file must match its SHA-256. Anything else is refused and never unpacked.
 * - **Rollback:** the first start of a new bundle is a trial. A fatal JavaScript error during the
 *   trial, or a trial start that never got going (the app died before [CONFIRM_AFTER_MS]), marks
 *   it bad: the app goes back to the last good bundle (or the APK's own) and tells Kiwimake.
 * - A newer APK replaces all of it: quick updates older than or as old as the installed APK, or
 *   made for other native code, are dropped.
 *
 * React Native apps only (the bundle loader is in the Expo module); a Kotlin app never gets one.
 */
object Ota {
  private const val TAG = "AnyAppOta"
  private const val DIR = "anyapp-ota"
  private const val MAX_BYTES = 200L * 1024 * 1024
  const val CONFIRM_AFTER_MS = 5_000L
  private val SAFE_NAME = Regex("^[A-Za-z0-9_][A-Za-z0-9_./-]*$")

  /** The quick update build the running JavaScript came from (0: the APK's own bundle). */
  @Volatile var loaded: Long = 0
    private set

  private class State(
    var apk: Long = 0,
    var runtime: String = "",
    var staged: Long = 0, // checked and unpacked, not started yet
    var current: Long = 0, // what the next start loads (0: the APK's own)
    var good: Long = 0, // the last one that started fine (0: the APK's own)
    var trial: Boolean = false, // `current` has not started fine yet
    var attempts: Int = 0,
    val bad: MutableSet<Long> = mutableSetOf(),
  )

  // ---------------------------------------------------------------- this build

  fun runtime(ctx: Context): String {
    val id = ctx.resources.getIdentifier("anyapp_runtime", "string", ctx.packageName)
    return if (id == 0) "" else ctx.getString(id).trim()
  }

  /** The version this app shows now: the APK's build or the quick update it runs, whichever is newer. */
  fun runningBuild(ctx: Context): Long = maxOf(AppUpdater.installedBuild(ctx), loaded)

  // ---------------------------------------------------------------- state on disk

  private fun root(ctx: Context) = File(ctx.filesDir, DIR)
  private fun buildDir(ctx: Context, build: Long) = File(root(ctx), "b$build")
  private fun stateFile(ctx: Context) = File(root(ctx), "state.json")

  private fun load(ctx: Context): State {
    val s = try {
      val j = JSONObject(stateFile(ctx).readText())
      State(
        j.optLong("apk"), j.optString("runtime"), j.optLong("staged"), j.optLong("current"), j.optLong("good"),
        j.optBoolean("trial"), j.optInt("attempts"),
        j.optJSONArray("bad")?.let { a -> (0 until a.length()).map { a.getLong(it) }.toMutableSet() } ?: mutableSetOf(),
      )
    } catch (_: Exception) {
      State()
    }
    // A new APK, or other native code: what was unpacked for the old one is dropped.
    val apk = AppUpdater.installedBuild(ctx)
    val runtime = runtime(ctx)
    if (s.apk != apk || s.runtime != runtime) {
      val keep = { b: Long -> b > apk && s.runtime == runtime && runtime.isNotEmpty() }
      s.staged = if (keep(s.staged)) s.staged else 0
      s.current = if (keep(s.current)) s.current else 0
      s.good = if (keep(s.good)) s.good else 0
      if (s.current == 0L) s.trial = false
      s.bad.retainAll { it > apk }
      s.apk = apk
      s.runtime = runtime
      save(ctx, s)
      cleanup(ctx, s)
    }
    return s
  }

  private fun save(ctx: Context, s: State) {
    root(ctx).mkdirs()
    val j = JSONObject()
      .put("apk", s.apk).put("runtime", s.runtime).put("staged", s.staged).put("current", s.current).put("good", s.good)
      .put("trial", s.trial).put("attempts", s.attempts).put("bad", JSONArray(s.bad.toList()))
    val tmp = File(root(ctx), "state.json.tmp")
    tmp.writeText(j.toString())
    if (!tmp.renameTo(stateFile(ctx))) {
      stateFile(ctx).delete()
      tmp.renameTo(stateFile(ctx))
    }
  }

  /** Keeps only the folders still needed (what runs, what is staged, the last good one). */
  private fun cleanup(ctx: Context, s: State) {
    val keep = setOf(s.current, s.staged, s.good).filter { it > 0 }.map { "b$it" }.toSet()
    root(ctx).listFiles()?.forEach { f -> if (f.isDirectory && f.name !in keep) f.deleteRecursively() }
  }

  // ---------------------------------------------------------------- what to start with

  /**
   * The bundle file the React instance starts with now, or null for the APK's own bundle. Called
   * at every start and reload: a staged update becomes current here (a trial), and a trial whose
   * last start never got going is rolled back.
   */
  @Synchronized
  fun bundleForLaunch(ctx: Context): String? {
    return try {
      val s = load(ctx)
      if (s.staged > s.current && s.staged !in s.bad) {
        s.current = s.staged
        s.trial = true
        s.attempts = 0
      }
      s.staged = 0
      if (s.current > 0 && s.trial && s.attempts >= 1) {
        Log.w(TAG, "build ${s.current} did not start last time: back to ${if (s.good > 0) "build ${s.good}" else "the installed version"}")
        markBad(ctx, s, s.current)
      }
      if (s.current > 0 && !File(buildDir(ctx, s.current), "index.android.bundle").isFile) {
        s.current = s.good
        s.trial = false
      }
      if (s.trial) s.attempts++
      save(ctx, s)
      loaded = s.current
      Log.i(TAG, "starting with ${if (s.current > 0) "quick update ${s.current}${if (s.trial) " (trial)" else ""}" else "the installed version"}")
      if (s.current > 0) File(buildDir(ctx, s.current), "index.android.bundle").absolutePath else null
    } catch (e: Exception) {
      Log.w(TAG, "could not choose the bundle, starting with the installed version", e)
      loaded = 0
      null
    }
  }

  private fun markBad(ctx: Context, s: State, build: Long) {
    s.bad.add(build)
    s.current = s.good
    s.trial = false
    s.attempts = 0
    Thread { runCatching { HostLink.report(ctx, bad = build) } }.start()
  }

  private val main = Handler(Looper.getMainLooper())

  /** The React instance was made: if it is still alive after [CONFIRM_AFTER_MS], the trial passed. */
  fun onInstanceCreated(ctx: Context) {
    val build = loaded
    main.postDelayed({ Thread { runCatching { confirm(ctx.applicationContext, build) } }.start() }, CONFIRM_AFTER_MS)
  }

  @Synchronized
  private fun confirm(ctx: Context, build: Long) {
    if (build != loaded) return
    val s = load(ctx)
    if (build > 0 && s.current == build && s.trial) {
      s.trial = false
      s.attempts = 0
      s.good = build
      save(ctx, s)
      cleanup(ctx, s)
      Log.i(TAG, "quick update $build started fine")
    }
    HostLink.report(ctx, running = runningBuild(ctx))
  }

  /**
   * A fatal JavaScript error. True when it came from a quick update on trial: it is marked bad and
   * the caller reloads with the last good bundle.
   */
  @Synchronized
  fun onFatal(ctx: Context, error: Throwable): Boolean {
    val s = load(ctx)
    if (loaded == 0L || s.current != loaded || !s.trial) return false
    Log.w(TAG, "quick update $loaded failed at start: ${error.message}; going back")
    markBad(ctx, s, loaded)
    save(ctx, s)
    cleanup(ctx, s)
    return true
  }

  /** A checked update waiting for a reload (newer than what runs), or 0. */
  @Synchronized
  fun stagedBuild(ctx: Context): Long {
    val s = load(ctx)
    val next = maxOf(s.staged, s.current)
    return if (next > runningBuild(ctx) && next !in s.bad) next else 0
  }

  /** True when this build was already refused or rolled back here. */
  @Synchronized
  fun isBad(ctx: Context, build: Long): Boolean = build in load(ctx).bad

  // ---------------------------------------------------------------- checking and unpacking

  class Refused(message: String) : Exception(message)

  /**
   * Copies the quick update from [input], checks it (signature, package, native fingerprint,
   * build, every file's SHA-256) and unpacks it. Returns its build. Throws [Refused] for an
   * update this app must not run (it is then remembered as bad).
   */
  fun stage(ctx: Context, input: InputStream): Long {
    val dir = root(ctx).apply { mkdirs() }
    val zipFile = File(dir, "incoming.zip")
    input.use { src ->
      zipFile.outputStream().use { out ->
        val buf = ByteArray(1 shl 16)
        var total = 0L
        while (true) {
          val n = src.read(buf)
          if (n < 0) break
          total += n
          if (total > MAX_BYTES) throw Refused("too large")
          out.write(buf, 0, n)
        }
      }
    }
    try {
      return unpack(ctx, zipFile)
    } finally {
      zipFile.delete()
    }
  }

  private fun unpack(ctx: Context, zipFile: File): Long {
    ZipFile(zipFile).use { zip ->
      val manifestBytes = zip.getEntry("ota.json")?.let { e -> zip.getInputStream(e).use { it.readBytes() } } ?: throw Refused("no ota.json")
      val sig = zip.getEntry("ota.sig")?.let { e -> zip.getInputStream(e).use { it.readBytes() } } ?: throw Refused("no signature")
      if (!signedByThisApp(ctx, manifestBytes, Base64.decode(String(sig).trim(), Base64.DEFAULT))) throw Refused("not signed by this app's key")
      val m = JSONObject(String(manifestBytes))
      val build = m.getLong("build")
      if (m.optInt("format") != 1) throw Refused("unknown format")
      if (m.optString("package") != ctx.packageName) throw Refused("made for another app")
      val runtime = runtime(ctx)
      if (runtime.isEmpty() || m.optString("runtime") != runtime) throw Refused("made for other native code")
      synchronized(this) {
        val s = load(ctx)
        if (build in s.bad) throw Refused("build $build was rolled back here")
        if (build <= AppUpdater.installedBuild(ctx)) return build // the installed APK is as new
        if (build == s.current || build == s.staged) return build // already here
      }
      val files = m.getJSONArray("files")
      val tmp = File(root(ctx), "b$build.tmp").apply { deleteRecursively(); mkdirs() }
      try {
        var sawBundle = false
        for (i in 0 until files.length()) {
          val f = files.getJSONObject(i)
          val name = f.getString("name")
          if (!SAFE_NAME.matches(name) || name.contains("..")) throw Refused("file name not allowed")
          val entry = zip.getEntry(name) ?: throw Refused("$name is missing")
          val out = File(tmp, name)
          if (!out.canonicalPath.startsWith(tmp.canonicalPath + File.separator)) throw Refused("file name not allowed")
          out.parentFile?.mkdirs()
          val digest = MessageDigest.getInstance("SHA-256")
          var size = 0L
          zip.getInputStream(entry).use { src ->
            out.outputStream().use { dst ->
              val buf = ByteArray(1 shl 16)
              while (true) {
                val n = src.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
                dst.write(buf, 0, n)
                size += n
              }
            }
          }
          val sum = digest.digest().joinToString("") { "%02x".format(it) }
          if (size != f.getLong("size") || !sum.equals(f.getString("sha256"), ignoreCase = true)) throw Refused("$name was damaged")
          if (name == "index.android.bundle") sawBundle = true
        }
        if (!sawBundle) throw Refused("no bundle")
        val final = buildDir(ctx, build)
        final.deleteRecursively()
        if (!tmp.renameTo(final)) throw IllegalStateException("could not move the update into place")
      } catch (e: Exception) {
        tmp.deleteRecursively()
        throw e
      }
      synchronized(this) {
        val s = load(ctx)
        s.staged = maxOf(s.staged, build)
        save(ctx, s)
      }
      Log.i(TAG, "quick update $build checked and ready")
      return build
    }
  }

  /** ota.json must be signed (SHA256withRSA) by a key this app is signed with now. */
  @Suppress("DEPRECATION")
  private fun signedByThisApp(ctx: Context, data: ByteArray, sig: ByteArray): Boolean {
    val pm = ctx.packageManager
    val certs = if (Build.VERSION.SDK_INT >= 28) {
      val si = pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo ?: return false
      if (si.hasMultipleSigners()) si.apkContentsSigners.toList() else listOfNotNull(si.signingCertificateHistory?.lastOrNull())
    } else {
      pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES).signatures?.toList() ?: emptyList()
    }
    val factory = CertificateFactory.getInstance("X.509")
    return certs.any { c ->
      runCatching {
        val cert = factory.generateCertificate(ByteArrayInputStream(c.toByteArray()))
        Signature.getInstance("SHA256withRSA").run {
          initVerify(cert.publicKey)
          update(data)
          verify(sig)
        }
      }.getOrDefault(false)
    }
  }

  /** Remembers a refused update so it is not offered again, and tells Kiwimake. */
  @Synchronized
  fun refuse(ctx: Context, build: Long, why: String) {
    Log.w(TAG, "quick update $build refused: $why")
    if (build <= 0) return
    val s = load(ctx)
    s.bad.add(build)
    save(ctx, s)
    Thread { runCatching { HostLink.report(ctx, bad = build) } }.start()
  }
}
