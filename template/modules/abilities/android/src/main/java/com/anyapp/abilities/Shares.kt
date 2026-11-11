package com.anyapp.abilities

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** A file someone shared into the app, already copied into the app's own storage. */
data class SharedFile(val path: String, val mimeType: String, val name: String, val size: Long) {
  val uri: String get() = Uri.fromFile(File(path)).toString()
  fun toJson(): JSONObject = JSONObject().put("uri", uri).put("path", path).put("mimeType", mimeType).put("name", name).put("size", size)
}

/** What someone shared into the app from another app's share sheet. */
data class Share(val text: String?, val subject: String?, val url: String?, val files: List<SharedFile>, val mimeType: String?) {
  fun toJson(): JSONObject = JSONObject()
    .put("text", text ?: JSONObject.NULL)
    .put("subject", subject ?: JSONObject.NULL)
    .put("url", url ?: JSONObject.NULL)
    .put("mimeType", mimeType ?: JSONObject.NULL)
    .put("files", JSONArray(files.map { it.toJson() }))
}

/**
 * Receiving shares: the app's main activity gets intent filters for ACTION_SEND and
 * ACTION_SEND_MULTIPLE, and calls [take] with its intent (in onCreate and onNewIntent).
 * Files are copied into `files/shared/` at once (the sender's permission to read them ends with
 * the screen), so their paths stay valid until the app deletes them.
 */
object Shares {
  private const val DONE = "com.anyapp.abilities.SHARE_TAKEN"
  private const val MAX_FILES = 20
  private const val MAX_BYTES = 50L * 1024 * 1024
  private val URL = Regex("""https?://[^\s<>"']+""")

  /** The share in [intent], or null. Each share is returned once (a second call gives null). */
  fun take(context: Context, intent: Intent?): Share? {
    if (intent == null) return null
    val action = intent.action
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return null
    if (intent.getBooleanExtra(DONE, false)) return null
    intent.putExtra(DONE, true)

    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
    val uris = mutableListOf<Uri>()
    if (action == Intent.ACTION_SEND) streamOne(intent)?.let { uris += it }
    else streamMany(intent)?.let { uris += it }
    if (uris.isEmpty()) intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris += it } }

    val files = uris.distinct().take(MAX_FILES).mapNotNull { copy(context, it, intent.type) }
    val url = text?.let { URL.find(it)?.value?.trimEnd('.', ',', ')', ']') }
    if (text == null && files.isEmpty()) return null
    return Share(text, subject, url, files, intent.type)
  }

  /** Deletes a shared file copy the app no longer needs (only files under files/shared/). */
  fun delete(context: Context, path: String): Boolean {
    val f = File(path.removePrefix("file://")).canonicalFile
    val dir = File(context.filesDir, "shared").canonicalFile
    return f.path.startsWith(dir.path + File.separator) && f.delete()
  }

  @Suppress("DEPRECATION")
  private fun streamOne(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streamMany(intent: Intent): List<Uri>? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)

  private fun copy(context: Context, uri: Uri, fallbackType: String?): SharedFile? {
    var target: File? = null
    return try {
      val resolver = context.contentResolver
      val type = resolver.getType(uri) ?: fallbackType?.takeIf { !it.contains('*') } ?: "application/octet-stream"
      var name: String? = null
      if (uri.scheme == "content") {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          if (c.moveToFirst()) name = c.getString(0)
        }
      }
      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(type)
      val base = (name ?: uri.lastPathSegment ?: "shared").replace(Regex("""[^\w.\-]+"""), "_").take(80)
      val fileName = if (ext != null && !base.contains('.')) "$base.$ext" else base
      val dir = File(context.filesDir, "shared").apply { mkdirs() }
      val out = File(dir, "${System.currentTimeMillis()}-$fileName").also { target = it }
      val input = resolver.openInputStream(uri) ?: return null
      var total = 0L
      input.use { from ->
        out.outputStream().use { to ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = from.read(buf)
            if (n < 0) break
            total += n
            if (total > MAX_BYTES) throw IllegalStateException("shared file is over 50 MB")
            to.write(buf, 0, n)
          }
        }
      }
      SharedFile(out.path, type, name ?: fileName, total)
    } catch (e: Throwable) {
      Log.w(Actions.TAG, "Could not copy a shared file", e)
      target?.delete()
      null
    }
  }
}
