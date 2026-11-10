package com.anyappagent.nativebridge

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
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
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

class InstallException(message: String) : CodedException("ERR_INSTALL", message, null)

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

  override fun definition() = ModuleDefinition {
    Name("AnyAppNative")

    Events("onInstallStatus")

    OnCreate {
      InstallEvents.listener = { sessionId, status, message, packageName, confirm -> onInstallEvent(sessionId, status, message, packageName, confirm) }
    }

    OnDestroy {
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
     */
    AsyncFunction("install") { path: String, promise: Promise ->
      try {
        startInstall(path, promise)
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
    Function("notify") { id: Int, title: String, body: String, url: String? ->
      val ctx = context
      if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return@Function false
      Notifications.ensureChannels(ctx)
      val notification = NotificationCompat.Builder(ctx, Notifications.CHANNEL_READY)
        .setSmallIcon(R.drawable.ic_anyapp_notification)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
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

    Function("startKeepAlive") { text: String ->
      val intent = Intent(context, KeepAliveService::class.java).putExtra(KeepAliveService.EXTRA_TEXT, text)
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
  }

  private fun startInstall(path: String, promise: Promise) {
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
    } catch (e: Exception) {
      pending.remove(sessionId)
      try {
        installer.abandonSession(sessionId)
      } catch (_: Exception) {
      }
      throw InstallException("Couldn't start the install: ${e.message}")
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
        val activity = appContext.currentActivity
        try {
          if (activity != null) activity.startActivity(confirm) else context.startActivity(confirm)
        } catch (e: Exception) {
          pending.remove(sessionId)?.resolve(mapOf("status" to "failed", "message" to "The installer did not open."))
          return
        }
      }
      sendEvent("onInstallStatus", mapOf("sessionId" to sessionId, "status" to status, "packageName" to packageName))
      return
    }
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
