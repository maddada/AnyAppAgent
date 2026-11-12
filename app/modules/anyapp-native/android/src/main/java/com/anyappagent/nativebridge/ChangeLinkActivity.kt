package com.anyappagent.nativebridge

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * "Change this app" (docs/CHANGE-THIS-APP.md). An app made with Kiwimake opens
 * anyappagent://change?... with the action com.anyappagent.action.CHANGE, which only Kiwimake
 * versions that know the change screen declare (older copies on the phone are skipped). This hands
 * the link to the main activity as an ordinary view link, which the router opens at /change.
 */
class ChangeLinkActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val data = intent?.data
    if (data != null && data.scheme == "anyappagent" && data.host == "change") {
      val open = Intent(Intent.ACTION_VIEW, data)
        .setPackage(packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      runCatching { startActivity(open) }
    }
    finish()
  }
}
