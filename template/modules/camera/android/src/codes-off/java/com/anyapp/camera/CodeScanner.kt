package com.anyapp.camera

import android.app.Activity
import android.content.Context
import android.net.Uri

/** Code scanning is off (no "codes" in app.json's modules/camera plugin): nothing is included. */
data class ScannedCode(val value: String, val format: String, val kind: String)

object CodeScanner {
  const val ON = false

  fun scan(activity: Activity, done: (Result<ScannedCode?>) -> Unit) {
    done(Result.failure(IllegalStateException(OFF)))
  }

  fun read(context: Context, uri: Uri, done: (Result<List<ScannedCode>>) -> Unit) {
    done(Result.failure(IllegalStateException(OFF)))
  }

  private const val OFF = "Code scanning is off: add \"codes\": true to modules/camera in app.json"
}
