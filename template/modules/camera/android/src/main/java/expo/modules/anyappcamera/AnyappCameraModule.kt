package expo.modules.anyappcamera

import android.net.Uri
import com.anyapp.camera.CodeScanner
import com.anyapp.camera.TextReader
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Camera smarts for React Native apps: scan a code, read text from a picture. The same Kotlin
 * core as the Kotlin template (com.anyapp.camera). Each part is compiled in only when app.json
 * switches it on (modules/camera/app.plugin.js); otherwise its stub answers "off".
 */
class AnyappCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AnyappCamera")

    Function("status") { mapOf("codes" to CodeScanner.ON, "text" to TextReader.ON) }

    AsyncFunction("scanCode") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("no_screen", "The app is not on screen", null)
        return@AsyncFunction
      }
      CodeScanner.scan(activity) { r ->
        r.onSuccess { c -> promise.resolve(c?.let { mapOf("value" to it.value, "format" to it.format, "kind" to it.kind) }) }
        r.onFailure { e -> promise.reject("scan_failed", e.message ?: "The scanner did not open", e) }
      }
    }

    AsyncFunction("readCodes") { uri: String, promise: Promise ->
      val ctx = appContext.reactContext ?: return@AsyncFunction promise.reject("no_context", "No context", null)
      CodeScanner.read(ctx, uriOf(uri)) { r ->
        r.onSuccess { list -> promise.resolve(list.map { mapOf("value" to it.value, "format" to it.format, "kind" to it.kind) }) }
        r.onFailure { e -> promise.reject("read_failed", e.message ?: "Could not read the picture", e) }
      }
    }

    AsyncFunction("readText") { uri: String, promise: Promise ->
      val ctx = appContext.reactContext ?: return@AsyncFunction promise.reject("no_context", "No context", null)
      TextReader.read(ctx, uriOf(uri)) { r ->
        r.onSuccess { t -> promise.resolve(mapOf("text" to t.text, "lines" to t.lines, "blocks" to t.blocks)) }
        r.onFailure { e -> promise.reject("read_failed", e.message ?: "Could not read the picture", e) }
      }
    }
  }

  private fun uriOf(s: String): Uri = if (s.startsWith("/")) Uri.fromFile(java.io.File(s)) else Uri.parse(s)
}
