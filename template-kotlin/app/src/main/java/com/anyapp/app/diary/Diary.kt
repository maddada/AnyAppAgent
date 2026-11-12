package com.anyapp.app.diary

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The app's diary: a small private log of what the app did ("Asr alarm set for 15:42", "Asr alarm
 * rang"), kept in the app's own storage on the phone. The agent that makes the app reads it (only
 * through Kiwimake, only to the person's own PC) when something did not work.
 *
 * Write what the app did and why. Never personal content: no names, messages, places, health
 * data, or anything the person typed.
 *
 *   Diary.note(context, "Reminder set for 08:00")
 */
object Diary {
  const val FILE = "anyapp-diary.jsonl"
  const val KEEP = 300
  private const val TRIM_AT = 400
  private const val MAX_TEXT = 200
  private val lock = Any()

  fun iso(time: Long = System.currentTimeMillis()): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(time))

  private fun file(context: Context) = File(context.applicationContext.filesDir, FILE)

  /** Adds one note (one line, at most 200 characters). Never throws. */
  fun note(context: Context, text: String) {
    val clean = text.replace(Regex("\\s+"), " ").trim().take(MAX_TEXT)
    if (clean.isEmpty()) return
    try {
      val line = JSONObject().put("at", iso()).put("text", clean).toString()
      synchronized(lock) {
        val f = file(context)
        f.appendText(line + "\n")
        val lines = f.readLines().filter { it.isNotBlank() }
        if (lines.size > TRIM_AT) {
          val tmp = File(f.parentFile, "$FILE.tmp")
          tmp.writeText(lines.takeLast(KEEP).joinToString("\n", postfix = "\n"))
          if (!tmp.renameTo(f)) {
            f.writeText(tmp.readText())
            tmp.delete()
          }
        }
      }
    } catch (_: Exception) {
      // the diary must never break the app
    }
  }

  /** The newest [max] notes, oldest first, as {at, text} objects. */
  fun read(context: Context, max: Int = KEEP): JSONArray {
    val out = JSONArray()
    try {
      val lines = synchronized(lock) { file(context).takeIf { it.exists() }?.readLines() ?: emptyList() }
      for (line in lines.filter { it.isNotBlank() }.takeLast(max)) {
        try {
          val o = JSONObject(line)
          out.put(JSONObject().put("at", o.optString("at")).put("text", o.optString("text")))
        } catch (_: Exception) {
          // a broken line is skipped
        }
      }
    } catch (_: Exception) {
      // unreadable: empty
    }
    return out
  }
}
