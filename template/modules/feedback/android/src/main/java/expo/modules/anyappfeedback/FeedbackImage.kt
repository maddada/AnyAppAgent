// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package expo.modules.anyappfeedback

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Makes the one picture (screenshot, arrows, notes), copies it and puts it in the gallery. */
internal object FeedbackImage {
  const val ALBUM = "Feedback"
  private const val KEEP = 20 // pictures kept in the app's own folder for pasting

  class Result(val copied: Boolean, val savedToGallery: Boolean)

  fun render(context: Context, shot: Bitmap, arrows: List<Arrow>, notes: String, unit: Float, appName: String, at: Date): Bitmap {
    val fonts = FeedbackFonts.of(context)
    val c = FeedbackColors.light // the saved picture always reads as paper, whatever the phone's mode
    val w = shot.width
    val u = w / 360f
    val pad = 20f * u

    val eyebrow = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = fonts.mono
      textSize = 11f * u
      color = c.textTertiary
      letterSpacing = 0.06f
    }
    // "FEEDBACK · APP NAME" on the left (shortened if long), the date and time on the right.
    val stamp = SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault()).format(at)
    val stampW = eyebrow.measureText(stamp)
    val head = TextUtils.ellipsize(
      "FEEDBACK · ${appName.uppercase(Locale.getDefault())}", eyebrow,
      (w - 2 * pad - stampW - 16f * u).coerceAtLeast(0f), TextUtils.TruncateAt.END,
    ).toString()
    val body = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = fonts.text
      textSize = 16f * u
      color = c.text
    }
    val textWidth = (w - 2 * pad).toInt().coerceAtLeast(1)
    val trimmed = notes.trim()
    val layout = if (trimmed.isEmpty()) null else StaticLayout.Builder
      .obtain(trimmed, 0, trimmed.length, body, textWidth)
      .setAlignment(Layout.Alignment.ALIGN_NORMAL)
      .setLineSpacing(7f * u, 1f)
      .build()
    val eyebrowH = eyebrow.fontMetrics.let { it.descent - it.ascent }
    val panelH = pad + eyebrowH + (layout?.let { 12f * u + it.height } ?: 0f) + pad + 4f * u

    val out = Bitmap.createBitmap(w, shot.height + panelH.toInt(), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(c.surface)
    canvas.drawBitmap(shot, 0f, 0f, null)
    val bounds = RectF(0f, 0f, w.toFloat(), shot.height.toFloat())
    val painter = ArrowPainter(fonts.mono)
    arrows.forEachIndexed { i, a ->
      painter.draw(canvas, a.x1 * w, a.y1 * shot.height, a.x2 * w, a.y2 * shot.height, i + 1, unit, bounds)
    }
    val hair = Paint().apply { color = c.borderStrong; strokeWidth = u.coerceAtLeast(1f) }
    canvas.drawLine(0f, shot.height.toFloat(), w.toFloat(), shot.height.toFloat(), hair)
    var y = shot.height + pad
    canvas.drawText(head, pad, y - eyebrow.fontMetrics.ascent, eyebrow)
    canvas.drawText(stamp, w - pad - stampW, y - eyebrow.fontMetrics.ascent, eyebrow)
    y += eyebrowH
    if (layout != null) {
      y += 12f * u
      canvas.save()
      canvas.translate(pad, y)
      layout.draw(canvas)
      canvas.restore()
    }
    return out
  }

  /** Below Android 10 the gallery needs the storage permission; from 10 on, nothing. */
  fun galleryNeedsPermission(context: Context) =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
      context.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED

  fun save(context: Context, picture: Bitmap, appName: String, at: Date): Result {
    val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(at)
    val slug = appName.lowercase(Locale.US).replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "app" }
    val name = "feedback-$slug-$stamp.png"

    val folder = FeedbackProvider.folder(context)
    val file = File(folder, name)
    FileOutputStream(file).use { picture.compress(Bitmap.CompressFormat.PNG, 100, it) }
    folder.listFiles { f -> f.name.endsWith(".png") }?.sortedByDescending { it.lastModified() }?.drop(KEEP)?.forEach { it.delete() }

    val copied = try {
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newUri(context.contentResolver, "Feedback", FeedbackProvider.uriFor(context, file)))
      true
    } catch (_: Throwable) {
      false
    }
    val saved = try {
      saveToGallery(context, file, name)
    } catch (_: Throwable) {
      false
    }
    return Result(copied, saved)
  }

  private fun saveToGallery(context: Context, file: File, name: String): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val resolver = context.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, name)
        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$ALBUM")
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
      val uri = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values) ?: return false
      try {
        resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } ?: throw IllegalStateException()
        resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
      } catch (e: Throwable) {
        resolver.delete(uri, null, null)
        throw e
      }
      return true
    }
    if (galleryNeedsPermission(context)) return false
    @Suppress("DEPRECATION")
    val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM).apply { mkdirs() }
    val dest = File(dir, name)
    file.copyTo(dest, overwrite = true)
    MediaScannerConnection.scanFile(context, arrayOf(dest.absolutePath), arrayOf("image/png"), null)
    return true
  }
}
