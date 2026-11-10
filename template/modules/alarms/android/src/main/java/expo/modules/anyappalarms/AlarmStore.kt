package expo.modules.anyappalarms

import android.content.Context

/** Scheduled alarms, kept in SharedPreferences so they can be re-armed after a reboot. */
object AlarmStore {
  private const val PREFS = "expo.modules.anyappalarms.alarms"

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun put(c: Context, alarm: AlarmData) {
    prefs(c).edit().putString(alarm.id, alarm.toJson().toString()).commit()
  }

  fun get(c: Context, id: String): AlarmData? = AlarmData.fromJsonString(prefs(c).getString(id, null))

  fun remove(c: Context, id: String) {
    prefs(c).edit().remove(id).commit()
  }

  fun all(c: Context): List<AlarmData> =
    prefs(c).all.values.mapNotNull { AlarmData.fromJsonString(it as? String) }.sortedBy { it.at }
}
