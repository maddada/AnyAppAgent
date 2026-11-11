package com.anyapp.app.alarms

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
  /** Show a full-screen alarm over the lock screen (and take audio focus there). */
  val fullScreen: Boolean = true,
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
    put("fullScreen", fullScreen)
  }

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
      fullScreen = json.optBoolean("fullScreen", true),
    )

    fun fromJsonString(s: String?): AlarmData? =
      s?.let { runCatching { fromJson(JSONObject(it)) }.getOrNull() }

  }
}

private fun JSONObject.stringOrNull(key: String): String? =
  if (has(key) && !isNull(key)) getString(key) else null
