package expo.modules.anyappalarms

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Notes for the app's diary (modules/diary, src/lib/diary.ts) from the alarms, which run while the
 * app is closed: set, rang, could not ring on time. Same file and format as modules/diary's Diary.
 */
internal object AlarmDiary {
  private const val FILE = "anyapp-diary.jsonl"
  private val lock = Any()

  fun time(at: Long): String {
    val day = SimpleDateFormat("yyyyMMdd", Locale.US)
    val sameDay = day.format(Date(at)) == day.format(Date())
    return SimpleDateFormat(if (sameDay) "HH:mm" else "MMM d HH:mm", Locale.US).format(Date(at))
  }

  fun note(context: Context, text: String) {
    try {
      val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
      val line = JSONObject().put("at", iso).put("text", text.replace(Regex("\\s+"), " ").trim().take(200)).toString()
      synchronized(lock) {
        val f = File(context.applicationContext.filesDir, FILE)
        f.appendText(line + "\n")
        val lines = f.readLines().filter { it.isNotBlank() }
        if (lines.size > 400) f.writeText(lines.takeLast(300).joinToString("\n", postfix = "\n"))
      }
    } catch (_: Exception) {
      // the diary must never break an alarm
    }
  }
}
