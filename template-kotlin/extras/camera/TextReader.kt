package com.anyapp.camera

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.google.android.gms.common.api.OptionalModuleApi
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/** Text read from a picture: all of it, and line by line (top to bottom, as ML Kit found them). */
data class ReadText(val text: String, val lines: List<String>, val blocks: List<String>)

/**
 * Reads printed text (Latin script: English, French, ...) from a picture, on the phone, with
 * ML Kit. No internet and no cost. Camera smarts core (com.anyapp.camera), the same in both templates.
 */
object TextReader {
  const val ON = true
  private val main = Handler(Looper.getMainLooper())

  /** Reads the picture at [uri] (file:// or content://). */
  fun read(context: Context, uri: Uri, done: (Result<ReadText>) -> Unit) {
    val image = try {
      InputImage.fromFilePath(context, uri)
    } catch (e: Throwable) {
      done(Result.failure(e))
      return
    }
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    var tries = 0
    fun attempt() {
      recognizer.process(image)
        .addOnSuccessListener { t ->
          val lines = t.textBlocks.flatMap { b -> b.lines.map { it.text } }
          done(Result.success(ReadText(t.text, lines, t.textBlocks.map { it.text })))
        }
        .addOnFailureListener { e ->
          // With the Google Play services model, the first use on a phone waits for its download.
          if (e is MlKitException && e.errorCode == MlKitException.UNAVAILABLE && tries++ < 30) main.postDelayed({ attempt() }, 2_000)
          else done(Result.failure(e))
        }
    }
    val api = recognizer as? OptionalModuleApi
    if (api == null) {
      attempt()
      return
    }
    val installer = ModuleInstall.getClient(context)
    installer.areModulesAvailable(api)
      .addOnSuccessListener { r ->
        if (r.areModulesAvailable()) attempt()
        else installer.installModules(ModuleInstallRequest.newBuilder().addApi(api).build())
          .addOnSuccessListener { attempt() }
          .addOnFailureListener { attempt() }
      }
      .addOnFailureListener { attempt() }
  }
}
