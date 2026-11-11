package com.anyapp.camera

import android.content.Context
import android.net.Uri

/** Text reading is off (no "text" in app.json's modules/camera plugin): nothing is included. */
data class ReadText(val text: String, val lines: List<String>, val blocks: List<String>)

object TextReader {
  const val ON = false

  fun read(context: Context, uri: Uri, done: (Result<ReadText>) -> Unit) {
    done(Result.failure(IllegalStateException("Reading text is off: add \"text\": true to modules/camera in app.json")))
  }
}
