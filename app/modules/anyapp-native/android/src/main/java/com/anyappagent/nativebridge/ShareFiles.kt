package com.anyappagent.nativebridge

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File

/**
 * Files in and out of Kiwimake through Android's share sheet.
 * - In ("Like this, but mine"): a screenshot, a picture or a link shared from another app. The
 *   pictures are copied into Kiwimake's cache while the grant Android gave the activity lasts.
 * - Out ("Send app"): the installed APK of an app made with Kiwimake, copied under the app's
 *   own name ("Kettle Timer.apk") and handed to the share sheet. Only that one file, read only.
 */
object ShareFiles {
  /** At most this many pictures are taken from one share (the chat sends at most 6). */
  private const val MAX_PICTURES = 6
  /** A shared picture larger than this is skipped (a screenshot is a few MB). */
  private const val MAX_PICTURE_BYTES = 30L * 1024 * 1024
  private const val TAKEN = "com.anyappagent.action.SHARE_TAKEN"

  fun isShare(intent: Intent?): Boolean =
    intent != null && (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE)

  /**
   * What was shared, or null when the intent is not a share (or was already taken): text (often a
   * link), subject, pictures as cached files with their size, and how many could not be read.
   * Marks the intent as taken, so it is not read twice.
   */
  fun take(context: Context, intent: Intent?): Map<String, Any?>? {
    if (intent == null || !isShare(intent)) return null
    intent.action = TAKEN
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()?.takeIf { it.isNotEmpty() }
    val uris = LinkedHashSet<Uri>()
    streams(intent).forEach { uris.add(it) }
    // A link's share (text/plain) often carries the page's preview image in its ClipData, only for
    // the share sheet to show: that is not something the person shared, so it is left out.
    if (intent.type?.startsWith("image/") == true) {
      intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) } }
    }

    val dir = File(context.cacheDir, "shared-in")
    dir.mkdirs()
    // Pictures from earlier shares are not needed any more once they were sent or dropped.
    dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 60 * 60 * 1000) it.delete() }
    val pictures = mutableListOf<Map<String, Any?>>()
    var skipped = 0
    val stamp = System.currentTimeMillis()
    for ((i, uri) in uris.withIndex()) {
      if (pictures.size >= MAX_PICTURES) {
        skipped++
        continue
      }
      val mime = (try { context.contentResolver.getType(uri) } catch (_: Exception) { null }) ?: intent.type ?: ""
      if (!mime.startsWith("image/")) {
        skipped++
        continue
      }
      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "img"
      val out = File(dir, "$stamp-$i.$ext")
      try {
        var copied = 0L
        context.contentResolver.openInputStream(uri)?.use { input ->
          out.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val n = input.read(buffer)
              if (n < 0) break
              copied += n
              if (copied > MAX_PICTURE_BYTES) throw IllegalStateException("too large")
              output.write(buffer, 0, n)
            }
          }
        } ?: throw IllegalStateException("no stream")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(out.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalStateException("not a picture")
        pictures.add(mapOf("uri" to Uri.fromFile(out).toString(), "mimeType" to mime, "width" to bounds.outWidth, "height" to bounds.outHeight))
      } catch (_: Exception) {
        out.delete()
        skipped++
      }
    }
    if (text == null && subject == null && pictures.isEmpty() && skipped == 0) return null
    return mapOf("text" to text, "subject" to subject, "pictures" to pictures, "skipped" to skipped)
  }

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> = try {
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
      else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
    } else {
      val one = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      listOfNotNull(one)
    }
  } catch (_: Exception) {
    emptyList()
  }

  /** "Kettle Timer" -> "Kettle Timer.apk", without characters a file name cannot hold. */
  fun apkName(appName: String): String {
    val clean = appName.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), " ").replace(Regex("\\s+"), " ").trim().take(60)
    return "${clean.ifEmpty { "App" }}.apk"
  }

  class SendException(val code: String, message: String) : Exception(message)

  /**
   * Copies the installed APK of `packageName` to the cache as "<name>.apk" and returns the share
   * intent (a chooser) for it. Refuses an app split into several APKs: one file would not install.
   * Throws [SendException] with a plain sentence.
   */
  fun apkShareIntent(context: Context, packageName: String, appName: String, title: String): Intent {
    val out = copyApk(context, packageName, appName)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.anyapp.fileprovider", out)
    val send = Intent(Intent.ACTION_SEND)
      .setType(APK_TYPE)
      .putExtra(Intent.EXTRA_STREAM, uri)
      .putExtra(Intent.EXTRA_TITLE, out.name)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    send.clipData = ClipData.newRawUri(out.name, uri)
    return Intent.createChooser(send, title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }

  const val APK_TYPE = "application/vnd.android.package-archive"

  /** Android's "save as" screen for the APK copied by [copyApk] (Files, Downloads, a USB stick). */
  fun saveIntent(file: File): Intent =
    Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(APK_TYPE).putExtra(Intent.EXTRA_TITLE, file.name)

  /** The installed APK of `packageName`, copied to the cache as "<appName>.apk". */
  fun copyApk(context: Context, packageName: String, appName: String): File {
    val info: ApplicationInfo = try {
      if (Build.VERSION.SDK_INT >= 33) context.packageManager.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
      else @Suppress("DEPRECATION") context.packageManager.getApplicationInfo(packageName, 0)
    } catch (_: PackageManager.NameNotFoundException) {
      throw SendException("not_installed", "This app is not on this phone.")
    }
    if (!info.splitSourceDirs.isNullOrEmpty()) throw SendException("split", "This app is installed in parts, so it cannot be sent as one file.")
    val source = File(info.sourceDir)
    if (!source.canRead()) throw SendException("unreadable", "Android did not let Kiwimake read this app.")
    val dir = File(context.cacheDir, "send-app")
    dir.deleteRecursively()
    dir.mkdirs()
    val out = File(dir, apkName(appName))
    source.inputStream().use { input -> out.outputStream().use { input.copyTo(it, 256 * 1024) } }
    return out
  }
}
