package com.anyappagent.nativebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/** Receives PackageInstaller session results (see AnyAppNativeModule.install). */
class InstallResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    val sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
    val packageName = intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME)

    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) {
        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(Intent.EXTRA_INTENT)
      }
      if (confirm == null) {
        InstallEvents.emit(sessionId, "failed", "The installer did not open.", packageName)
        return
      }
      confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      // Prefer the live module (it starts the dialog from the current activity); otherwise start it here.
      if (!InstallEvents.emit(sessionId, "pendingUserAction", null, packageName, confirm)) {
        try {
          context.startActivity(confirm)
        } catch (_: Exception) {
        }
      }
      return
    }

    if (status == PackageInstaller.STATUS_SUCCESS && packageName != null && UpdatesProvider.reopenAfterInstall.remove(packageName)) {
      // The app's Reload popup asked for this install: open it again at once (docs/FAST-LANE.md).
      try {
        context.packageManager.getLaunchIntentForPackage(packageName)?.let {
          context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED))
        }
      } catch (_: Exception) {
      }
    }
    InstallEvents.emit(sessionId, statusName(status), message, packageName)
  }

  companion object {
    fun statusName(status: Int): String = when (status) {
      PackageInstaller.STATUS_SUCCESS -> "success"
      PackageInstaller.STATUS_FAILURE_ABORTED -> "cancelled"
      PackageInstaller.STATUS_FAILURE_CONFLICT -> "conflict"
      PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "incompatible"
      PackageInstaller.STATUS_FAILURE_STORAGE -> "storage"
      PackageInstaller.STATUS_FAILURE_BLOCKED -> "blocked"
      PackageInstaller.STATUS_FAILURE_INVALID -> "invalid"
      else -> "failed"
    }
  }
}
