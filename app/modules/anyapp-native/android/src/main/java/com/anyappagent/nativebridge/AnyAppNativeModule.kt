package com.anyappagent.nativebridge

import android.app.Activity
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Request codes for Android's install prompts (startActivityForResult): this + (session id and 0xff). */
private const val PROMPT_REQUEST_BASE = 0x4100

class InstallException(message: String) : CodedException("ERR_INSTALL", message, null)

class EasyConnectException(message: String) : CodedException("ERR_EASY_CONNECT", message, null)

/**
 * AnyAppAgent's own native bridge: everything about other apps on this phone.
 * - installing an APK (PackageInstaller session, with a system-intent fallback)
 * - is a package installed and which versionCode, launching it, opening its settings
 * - notifications ("Prayer Alarm is ready") and the keep-alive service
 */
class AnyAppNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** PackageInstaller session id -> the JS promise waiting for its final result. */
  private val pending = ConcurrentHashMap<Int, Promise>()

  /** PackageInstaller session id -> Android's prompt for it, while it waits for the person. */
  private val prompts = ConcurrentHashMap<Int, Intent>()

  /**
   * Prompts opened inside AnyAppAgent's own task with startActivityForResult: session id ->
   * (the activity that opened it, its request code), so finishActivity can close exactly that
   * prompt when its session ends or times out (an abandoned session's prompt otherwise stayed on
   * screen and covered the next app's prompt).
   */
  private val shownPrompts = ConcurrentHashMap<Int, Pair<WeakReference<Activity>, Int>>()

  /** Easy Connect's bridge calls, one at a time, off the JS and main threads. */
  private val easyConnectExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "anyapp-easyconnect").apply { isDaemon = true } }

  @Volatile private var easyConnectInitError: String? = null

  private var networkObserver: NetworkObserver? = null

  override fun definition() = ModuleDefinition {
    Name("AnyAppNative")

    Events("onInstallStatus", "onNetworkChanged")

    OnCreate {
      InstallEvents.listener = { sessionId, status, message, packageName, confirm -> onInstallEvent(sessionId, status, message, packageName, confirm) }
      networkObserver = NetworkObserver(context) { sendEvent("onNetworkChanged", mapOf<String, Any>()) }.also { it.start() }
      // Easy Connect: the interface lister and the client key, before JS can ask for a tunnel.
      easyConnectExecutor.execute {
        easyConnectInitError = try {
          EasyConnect.init(context)
          null
        } catch (e: Throwable) {
          e.message ?: e.toString()
        }
      }
    }

    OnDestroy {
      networkObserver?.stop()
      networkObserver = null
      InstallEvents.listener = null
    }

    // ---------- other apps

    Function("getPackageInfo") { packageName: String ->
      packageInfo(packageName)
    }

    Function("getPackagesInfo") { packageNames: List<String> ->
      packageNames.associateWith { packageInfo(it) }
    }

    Function("launch") { packageName: String ->
      val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: return@Function false
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(intent)
    }

    Function("openAppSettings") { packageName: String ->
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(intent)
    }

    Function("requestUninstall") { packageName: String ->
      @Suppress("DEPRECATION")
      val intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:$packageName"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(intent)
    }

    // ---------- installing

    /**
     * Shows Android's install prompt again for a session still waiting for the person (Android
     * blocks it when AnyAppAgent is not in front, and another prompt can cover it). True when one
     * was opened. Called when AnyAppAgent comes back to the front.
     */
    Function("reopenInstallPrompt") {
      val sessionId = pending.keys.firstOrNull { prompts.containsKey(it) } ?: return@Function false
      val confirm = prompts[sessionId] ?: return@Function false
      // On the main thread, in order: close the copy that may be open, then open it again
      // (never two copies of the same prompt).
      mainHandler.post {
        try {
          shownPrompts.remove(sessionId)?.let { (ref, requestCode) -> ref.get()?.finishActivity(requestCode) }
          showPrompt(sessionId, confirm)
        } catch (_: Exception) {
        }
      }
      true
    }

    /** The ABIs this phone runs, best first (Build.SUPPORTED_ABIS), to pick the smallest APK. */
    Function("supportedAbis") {
      Build.SUPPORTED_ABIS.toList()
    }

    Function("canInstallPackages") {
      if (Build.VERSION.SDK_INT >= 26) context.packageManager.canRequestPackageInstalls() else true
    }

    Function("openInstallPermissionSettings") {
      val intent = if (Build.VERSION.SDK_INT >= 26) {
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
      } else {
        Intent(Settings.ACTION_SECURITY_SETTINGS)
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(intent)
    }

    AsyncFunction("sha256File") { path: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(toFile(path)).use { input ->
        val buffer = ByteArray(1 shl 16)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          digest.update(buffer, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Installs the APK at [path] with a PackageInstaller session. Resolves with
     * { status, message } once Android reports the final result: status is "success",
     * "cancelled", "conflict" (signed differently from the installed app), "incompatible",
     * "storage", "blocked", "invalid" or "failed". While the user is asked to confirm,
     * an "onInstallStatus" event with status "pendingUserAction" is sent.
     *
     * [answerWithinMs]: how long to wait for Android's final answer after the commit (a
     * confirmation nobody sees, for example one Android blocked while AnyAppAgent was in the
     * background, used to keep the install queue waiting for good). Past it the session is
     * abandoned and the promise resolves with status "timeout".
     */
    AsyncFunction("install") { path: String, answerWithinMs: Double, promise: Promise ->
      try {
        startInstall(path, promise, debugInstallTimeoutMs() ?: answerWithinMs.toLong())
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(InstallException("Couldn't start the install: ${e.message}"))
      }
    }

    /** Fallback: hands the APK to the system installer screen. Resolves once it is open. */
    Function("installWithIntent") { path: String ->
      installWithIntent(path)
    }

    // ---------- notifications

    Function("notificationsEnabled") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    Function("openNotificationSettings") {
      val intent = if (Build.VERSION.SDK_INT >= 26) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(intent)
    }

    /** Posts a "ready" notification; tapping it opens AnyAppAgent with [url]. */
    Function("notify") { id: Int, title: String, body: String, url: String?, color: String? ->
      val ctx = context
      if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return@Function false
      Notifications.ensureChannels(ctx)
      val notification = NotificationCompat.Builder(ctx, Notifications.CHANNEL_READY)
        .setSmallIcon(R.drawable.ic_stat_anyappagent)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .apply { Notifications.tint(color)?.let { setColor(it) } }
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .setContentIntent(Notifications.openAppIntent(ctx, id, url))
        .build()
      try {
        NotificationManagerCompat.from(ctx).notify(id, notification)
        true
      } catch (_: SecurityException) {
        false
      }
    }

    Function("cancelNotification") { id: Int ->
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.cancel(id)
    }

    // ---------- keep the connection alive while the PC works

    Function("startKeepAlive") { text: String, color: String? ->
      val intent = Intent(context, KeepAliveService::class.java)
        .putExtra(KeepAliveService.EXTRA_TEXT, text)
        .putExtra(KeepAliveService.EXTRA_COLOR, color)
      try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (_: Exception) {
        // Android refuses to start it from the background; the app catches up when reopened.
        false
      }
    }

    Function("stopKeepAlive") {
      context.stopService(Intent(context, KeepAliveService::class.java))
    }

    // ---------- Easy Connect (docs/EASY-CONNECT.md 4.2). Every bridge call runs on one
    // background thread: a cold StartForward blocks in Go for up to ~20 s.

    AsyncFunction("easyConnectClientKey") { promise: Promise ->
      easyConnectExecutor.execute {
        try {
          EasyConnect.init(context)
          promise.resolve(EasyConnect.clientKey(context))
        } catch (e: Throwable) {
          promise.reject(EasyConnectException(e.message ?: "Easy Connect is not available."))
        }
      }
    }

    AsyncFunction("easyConnectStart") { address: String, port: Int, promise: Promise ->
      easyConnectExecutor.execute {
        try {
          EasyConnect.init(context)
          promise.resolve(mapOf("localPort" to EasyConnect.start(address, port)))
        } catch (e: Throwable) {
          val detail = (e.message ?: "").ifBlank { EasyConnect.lastError() }
          promise.reject(EasyConnectException(detail.ifBlank { "tailcat: cannot reach paired machine" }))
        }
      }
    }

    AsyncFunction("easyConnectStop") { promise: Promise ->
      easyConnectExecutor.execute {
        try {
          EasyConnect.stop()
        } catch (_: Throwable) {
        }
        promise.resolve(null)
      }
    }

    /** {"path":"relay"|"direct",...} or "" (never contains the address). */
    Function("easyConnectPath") {
      try {
        EasyConnect.path()
      } catch (_: Throwable) {
        ""
      }
    }

    Function("easyConnectAvailable") {
      easyConnectInitError == null
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  /** Development only: `adb shell setprop debug.anyapp.install.timeout_s 20` shortens the wait. */
  private fun debugInstallTimeoutMs(): Long? = try {
    val p = Runtime.getRuntime().exec(arrayOf("getprop", "debug.anyapp.install.timeout_s"))
    p.inputStream.bufferedReader().readText().trim().toLongOrNull()?.takeIf { it > 0 }?.times(1000)
  } catch (_: Exception) {
    null
  }

  private fun startInstall(path: String, promise: Promise, answerWithinMs: Long) {
    val file = toFile(path)
    if (!file.exists()) throw InstallException("The downloaded file is missing.")
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setSize(file.length())
    if (Build.VERSION.SDK_INT >= 31) {
      // Updates to apps this phone got from AnyAppAgent install without asking again.
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
    if (Build.VERSION.SDK_INT >= 26) {
      params.setInstallReason(PackageManager.INSTALL_REASON_USER)
    }
    if (Build.VERSION.SDK_INT >= 33) {
      params.setPackageSource(PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE)
    }
    val sessionId = try {
      installer.createSession(params)
    } catch (e: Exception) {
      throw InstallException("Couldn't start the install: ${e.message}")
    }
    try {
      installer.openSession(sessionId).use { session ->
        FileInputStream(file).use { input ->
          session.openWrite("base.apk", 0, file.length()).use { output ->
            input.copyTo(output, 1 shl 16)
            session.fsync(output)
          }
        }
        pending[sessionId] = promise
        val callback = Intent(context, InstallResultReceiver::class.java)
          .setPackage(context.packageName)
          .setAction("com.anyappagent.INSTALL_RESULT")
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        val pendingIntent = PendingIntent.getBroadcast(context, sessionId, callback, flags)
        session.commit(pendingIntent.intentSender)
      }
      if (answerWithinMs > 0) {
        mainHandler.postDelayed({
          val waiting = pending.remove(sessionId) ?: return@postDelayed
          closePrompt(sessionId)
          try {
            installer.abandonSession(sessionId)
          } catch (_: Exception) {
          }
          waiting.resolve(mapOf("status" to "timeout", "message" to "No answer from Android within ${answerWithinMs / 1000} s", "packageName" to null))
        }, answerWithinMs)
      }
    } catch (e: Exception) {
      pending.remove(sessionId)
      try {
        installer.abandonSession(sessionId)
      } catch (_: Exception) {
      }
      throw InstallException("Couldn't start the install: ${e.message}")
    }
  }

  /**
   * Opens Android's prompt for a session. From an activity it opens in AnyAppAgent's own task (no
   * NEW_TASK) with startActivityForResult, so [closePrompt] can finish it; without one, in its own task.
   */
  private fun showPrompt(sessionId: Int, confirm: Intent) {
    val activity = appContext.currentActivity
    if (activity == null) {
      context.startActivity(confirm)
      return
    }
    val inOurTask = Intent(confirm).apply { flags = flags and Intent.FLAG_ACTIVITY_NEW_TASK.inv() }
    val requestCode = PROMPT_REQUEST_BASE + (sessionId and 0xff)
    activity.startActivityForResult(inOurTask, requestCode)
    shownPrompts[sessionId] = WeakReference(activity) to requestCode
  }

  /** Closes the prompt this module opened for a session, if it is still on screen. */
  private fun closePrompt(sessionId: Int) {
    prompts.remove(sessionId)
    val (ref, requestCode) = shownPrompts.remove(sessionId) ?: return
    mainHandler.post {
      try {
        ref.get()?.finishActivity(requestCode)
      } catch (_: Exception) {
      }
    }
  }

  private fun installWithIntent(path: String): Boolean {
    val file = toFile(path)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.anyapp.fileprovider", file)
    @Suppress("DEPRECATION")
    val intent = Intent(Intent.ACTION_INSTALL_PACKAGE)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      .putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
    return startActivity(intent)
  }

  private fun onInstallEvent(sessionId: Int, status: String, message: String?, packageName: String?, confirm: Intent?) {
    if (status == "pendingUserAction") {
      if (confirm != null) {
        prompts[sessionId] = confirm
        try {
          showPrompt(sessionId, confirm)
        } catch (e: Exception) {
          pending.remove(sessionId)?.resolve(mapOf("status" to "failed", "message" to "The installer did not open."))
          return
        }
      }
      sendEvent("onInstallStatus", mapOf("sessionId" to sessionId, "status" to status, "packageName" to packageName))
      return
    }
    closePrompt(sessionId)
    sendEvent("onInstallStatus", mapOf("sessionId" to sessionId, "status" to status, "message" to message, "packageName" to packageName))
    pending.remove(sessionId)?.resolve(mapOf("status" to status, "message" to message, "packageName" to packageName))
  }

  private fun packageInfo(packageName: String): Map<String, Any?>? {
    val pm = context.packageManager
    return try {
      val info = if (Build.VERSION.SDK_INT >= 33) {
        pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(packageName, 0)
      }
      val installer = try {
        if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(packageName).installingPackageName
        else @Suppress("DEPRECATION") pm.getInstallerPackageName(packageName)
      } catch (_: Exception) {
        null
      }
      mapOf(
        "packageName" to packageName,
        "versionCode" to PackageInfoCompat.getLongVersionCode(info).toDouble(),
        "versionName" to info.versionName,
        "installer" to installer,
        "launchable" to (pm.getLaunchIntentForPackage(packageName) != null),
      )
    } catch (_: PackageManager.NameNotFoundException) {
      null
    }
  }

  private fun startActivity(intent: Intent): Boolean {
    return try {
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent)
      }
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  private fun toFile(path: String): File {
    val clean = if (path.startsWith("file://")) Uri.parse(path).path ?: path.removePrefix("file://") else path
    return File(clean)
  }
}
