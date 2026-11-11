// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package com.anyapp.feedback

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * Two small jobs. It starts the shake watcher when the app process starts (Android creates
 * providers before any activity, so no app code has to call anything). And it serves the saved
 * feedback images read only, so the clipboard can hand them to whatever app the person pastes
 * into (`content://<package>.anyappfeedback/<file>.png`, granted per paste by Android).
 */
class FeedbackProvider : ContentProvider() {
  companion object {
    const val DIR = "anyapp-feedback"
    fun authority(context: Context) = "${context.packageName}.anyappfeedback"
    fun folder(context: Context) = File(context.filesDir, DIR).apply { mkdirs() }
    fun uriFor(context: Context, file: File): Uri = Uri.Builder()
      .scheme("content").authority(authority(context)).appendPath(file.name).build()
  }

  override fun onCreate(): Boolean {
    context?.let { Feedback.install(it) }
    return true
  }

  private fun fileFor(uri: Uri): File {
    val ctx = context ?: throw FileNotFoundException()
    val name = uri.lastPathSegment ?: throw FileNotFoundException()
    if (name.contains('/') || name.contains("..") || !name.endsWith(".png")) throw FileNotFoundException()
    val file = File(folder(ctx), name)
    if (!file.isFile) throw FileNotFoundException()
    return file
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw SecurityException("read only")
    return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun getType(uri: Uri): String = "image/png"

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
    val file = fileFor(uri)
    val cols = projection?.filter { it == OpenableColumns.DISPLAY_NAME || it == OpenableColumns.SIZE }?.toTypedArray()
      ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
    val cursor = MatrixCursor(cols)
    cursor.addRow(cols.map { if (it == OpenableColumns.SIZE) file.length() else file.name })
    return cursor
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
}
