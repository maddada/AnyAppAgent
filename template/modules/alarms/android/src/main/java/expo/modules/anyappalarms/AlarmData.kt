package expo.modules.anyappalarms

import org.json.JSONObject
import java.util.Calendar

/** One alarm, as stored on the device so it survives the app being closed and reboots. */
data class AlarmData(
  val id: String,
  val at: Long,
  val title: String,
  val body: String?,
  val speak: String?,
  val language: String?,
  val sound: String?,
  val repeat: String?,
) {
  val notificationId: Int get() = ("anyapp-alarm:$id").hashCode()

  val needsPlayback: Boolean get() = !speak.isNullOrBlank() || !sound.isNullOrBlank()

  /** The next time a repeating alarm should fire after [now], or null if it does not repeat. */
  fun nextOccurrence(now: Long): AlarmData? {
    if (repeat != "daily") return null
    val cal = Calendar.getInstance().apply { timeInMillis = at }
    while (cal.timeInMillis <= now) cal.add(Calendar.DAY_OF_YEAR, 1)
    return copy(at = cal.timeInMillis)
  }

  fun toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("at", at)
    put("title", title)
    putOpt("body", body)
    putOpt("speak", speak)
    putOpt("language", language)
    putOpt("sound", sound)
    putOpt("repeat", repeat)
  }

  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "at" to at.toDouble(),
    "title" to title,
    "body" to body,
    "speak" to speak,
    "language" to language,
    "sound" to sound,
    "repeat" to repeat,
  )

  companion object {
    fun fromJson(json: JSONObject) = AlarmData(
      id = json.getString("id"),
      at = json.getLong("at"),
      title = json.optString("title", ""),
      body = json.stringOrNull("body"),
      speak = json.stringOrNull("speak"),
      language = json.stringOrNull("language"),
      sound = json.stringOrNull("sound"),
      repeat = json.stringOrNull("repeat"),
    )

    fun fromJsonString(s: String?): AlarmData? =
      s?.let { runCatching { fromJson(JSONObject(it)) }.getOrNull() }

    fun fromRecord(r: AlarmRecord): AlarmData {
      require(r.id.isNotBlank()) { "alarm.id is required" }
      require(r.at > 0) { "alarm.at must be a Date or a timestamp in milliseconds" }
      require(r.repeat == null || r.repeat == "daily") { "alarm.repeat must be 'daily' or left out" }
      return AlarmData(
        id = r.id,
        at = r.at.toLong(),
        title = r.title,
        body = r.body?.takeIf { it.isNotBlank() },
        speak = r.speak?.takeIf { it.isNotBlank() },
        language = r.language?.takeIf { it.isNotBlank() },
        sound = r.sound?.takeIf { it.isNotBlank() },
        repeat = r.repeat,
      )
    }
  }
}

private fun JSONObject.stringOrNull(key: String): String? =
  if (has(key) && !isNull(key)) getString(key) else null
