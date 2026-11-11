package com.anyapp.updates

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import java.io.File
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * The update box (AppUpdater): what is new, a progress bar, and one button. Opened from the
 * notification it starts downloading at once. The download is checked (size, SHA-256, package,
 * build number and signing key) before Android is asked to install it. Same file in every
 * AnyAppAgent template; plain Android views, so it works in every preset.
 */
class UpdateActivity : Activity() {
  companion object {
    const val EXTRA_START = "start"
    private var current: WeakReference<UpdateActivity>? = null

    /** Shows a status line in the open update box, if there is one. */
    fun post(ctx: Context, text: String) {
      current?.get()?.let { a -> a.runOnUiThread { a.showStatus(text, busy = false, button = a.buttonFor(text)) } }
    }
  }

  private lateinit var title: TextView
  private lateinit var notes: TextView
  private lateinit var status: TextView
  private lateinit var progress: ProgressBar
  private lateinit var button: Button
  private var update: AppUpdater.Update? = null
  private var working = false
  private var waitingForPermission = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    current = WeakReference(this)
    val pad = (20 * resources.displayMetrics.density).toInt()
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
    title = TextView(this).apply { textSize = 20f; text = appLabel() }
    notes = TextView(this).apply { textSize = 15f; setPadding(0, pad / 2, 0, pad / 2) }
    status = TextView(this).apply { textSize = 14f; text = "Looking for a new version..." }
    progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000; isIndeterminate = true }
    button = Button(this).apply { visibility = View.GONE }
    val buttons = LinearLayout(this).apply { gravity = Gravity.END; addView(button) }
    listOf(title, notes, status, progress, buttons).forEach { root.addView(it) }
    setContentView(root)
    button.setOnClickListener { onButton() }
    checkThen(start = intent.getBooleanExtra(EXTRA_START, false))
  }

  override fun onResume() {
    super.onResume()
    if (waitingForPermission && canInstall()) {
      waitingForPermission = false
      startDownload()
    }
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun appLabel() = applicationInfo.loadLabel(packageManager).toString()

  /** Trying again cannot fix a download from another key or of another app: offer Close instead. */
  private fun buttonFor(text: String) = if (text.contains("signed differently") || text.contains("is not this app")) "Close" else "Try again"

  private fun showStatus(text: String, busy: Boolean, button: String? = null) {
    status.text = text
    progress.visibility = if (busy) View.VISIBLE else View.GONE
    working = busy
    this.button.visibility = if (button == null) View.GONE else View.VISIBLE
    if (button != null) this.button.text = button
  }

  private fun onButton() {
    when {
      working -> return
      button.text == "Close" -> finish()
      update == null -> checkThen(start = false)
      else -> startDownload()
    }
  }

  private fun checkThen(start: Boolean) {
    showStatus("Looking for a new version...", busy = true)
    progress.isIndeterminate = true
    Thread {
      val state = runCatching { AppUpdater.check(this) }.getOrElse { AppUpdater.State.Problem("Couldn't check for updates.") }
      runOnUiThread {
        when (state) {
          is AppUpdater.State.Available -> {
            update = state.update
            title.text = "${appLabel()} ${state.update.version}"
            notes.text = state.update.notes
            if (start) startDownload() else showStatus("A new version is ready (${mb(state.update.apk.size)}).", busy = false, button = "Update")
          }
          is AppUpdater.State.UpToDate -> showStatus("You have the newest version.", busy = false, button = "Close")
          is AppUpdater.State.HandledByAnyAppAgent -> showStatus("Updates for this app come through AnyAppAgent.", busy = false, button = "Close")
          is AppUpdater.State.Off -> showStatus("This app is not shared, so it has no updates here.", busy = false, button = "Close")
          is AppUpdater.State.Problem -> showStatus(state.message, busy = false, button = buttonFor(state.message))
        }
      }
    }.start()
  }

  private fun canInstall() = Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls()

  private fun startDownload() {
    val u = update ?: return
    if (!canInstall()) {
      // Once per app: Android lets the person allow this app to install its own updates.
      waitingForPermission = true
      showStatus("Allow ${appLabel()} to install updates, then come back here.", busy = false, button = "Update")
      runCatching { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) }
      return
    }
    AppUpdater.cancelNotification(this)
    showStatus("Updating to ${u.version}...", busy = true)
    progress.isIndeterminate = false
    progress.progress = 0
    Thread {
      try {
        val file = download(u)
        verify(u, file)
        runOnUiThread { showStatus("Installing...", busy = true); progress.isIndeterminate = true }
        install(file)
      } catch (e: Exception) {
        val text = e.message ?: "The update could not be downloaded."
        runOnUiThread { showStatus(text, busy = false, button = buttonFor(text)) }
      }
    }.start()
  }

  private fun mb(bytes: Long) = "%.1f MB".format(bytes / 1048576.0)

  private fun download(u: AppUpdater.Update): File {
    val dir = File(cacheDir, "updates").apply { mkdirs() }
    dir.listFiles()?.filter { it.name != "${u.build}.apk" }?.forEach { it.delete() }
    val file = File(dir, "${u.build}.apk")
    if (file.length() == u.apk.size && sha256(file) == u.apk.sha256) return file // already here
    for (attempt in 1..2) {
      file.delete()
      val c = URL(u.apk.url).openConnection() as HttpURLConnection
      c.connectTimeout = 15_000
      c.readTimeout = 30_000
      c.instanceFollowRedirects = true
      try {
        if (c.responseCode !in 200..299) throw IllegalStateException("The download did not start (HTTP ${c.responseCode}). Try again later.")
        var done = 0L
        var lastShown = 0L
        c.inputStream.use { input ->
          file.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) {
              val n = input.read(buf)
              if (n < 0) break
              out.write(buf, 0, n)
              done += n
              if (done > u.apk.size) throw IllegalStateException("The download was damaged. Try again.")
              if (done - lastShown > 256 * 1024) {
                lastShown = done
                runOnUiThread {
                  progress.progress = (done * 1000 / u.apk.size).toInt()
                  status.text = "Updating to ${u.version} (${mb(done)} of ${mb(u.apk.size)})"
                }
              }
            }
          }
        }
      } finally {
        c.disconnect()
      }
      if (file.length() == u.apk.size && sha256(file) == u.apk.sha256) return file
      runOnUiThread { status.text = "The download was damaged. Trying again." }
    }
    file.delete()
    throw IllegalStateException("The download was damaged twice, so it was not installed. Try again later.")
  }

  /** The file must be this app, a newer build, signed with the same key as the copy on this phone. */
  private fun verify(u: AppUpdater.Update, file: File) {
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
    val info = packageManager.getPackageArchiveInfo(file.path, flags)
    info?.applicationInfo?.let { it.sourceDir = file.path; it.publicSourceDir = file.path }
    @Suppress("DEPRECATION")
    val build = if (info == null) -1L else if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    val mine = AppUpdater.installedSigner(this)
    val theirs = AppUpdater.signerOf(info)
    val problem = when {
      info == null || info.packageName != packageName -> "The download is not this app, so it was not installed."
      build != u.build || build <= AppUpdater.installedBuild(this) -> "The download is not the newer version, so it was not installed."
      mine == null || theirs == null || mine != theirs -> "This update can't replace your copy (it is signed differently). Ask whoever shared the app for a new link."
      else -> null
    }
    if (problem != null) {
      file.delete()
      throw IllegalStateException(problem)
    }
  }

  private fun install(file: File) {
    val installer = packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(packageName)
      if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
      setSize(file.length())
    }
    val id = installer.createSession(params)
    installer.openSession(id).use { session ->
      file.inputStream().use { input ->
        session.openWrite("update.apk", 0, file.length()).use { out ->
          input.copyTo(out)
          session.fsync(out)
        }
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
      val done = PendingIntent.getBroadcast(this, id, Intent(this, InstallReceiver::class.java).setPackage(packageName), flags)
      session.commit(done.intentSender)
    }
  }

  private fun sha256(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }
}
