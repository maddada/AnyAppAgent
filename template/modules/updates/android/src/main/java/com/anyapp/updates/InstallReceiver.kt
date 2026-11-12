package com.anyapp.updates

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/**
 * PackageInstaller's answer for an update (AppUpdater). Android's own confirmation, when it asks
 * for one, is shown from here. Same file in every Kiwimake template.
 */
class InstallReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      @Suppress("DEPRECATION")
      val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)
      confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let { runCatching { ctx.startActivity(it) } }
      UpdateActivity.post(ctx, "Tap Update in Android's box to finish.")
      return
    }
    if (status == PackageInstaller.STATUS_SUCCESS) return // this app is replaced: the process ends
    val why = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
    val text = when (status) {
      PackageInstaller.STATUS_FAILURE_ABORTED -> "The update was cancelled. Tap Update to try again."
      PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
        "This update can't replace your copy (it is signed differently). Ask whoever shared the app for a new link."
      PackageInstaller.STATUS_FAILURE_STORAGE -> "Not enough space on the phone for the update."
      else -> "The update could not be installed${if (why.isNotBlank()) " ($why)" else ""}."
    }
    UpdateActivity.post(ctx, text)
  }
}
