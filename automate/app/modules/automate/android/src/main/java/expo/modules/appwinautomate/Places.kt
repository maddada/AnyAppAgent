package expo.modules.appwinautomate

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * M4: arrive at and leave a place. Android's proximity alerts (no Play services needed), one per
 * watched place, kept in SharedPreferences so they come back after a reboot. Needs Location, all
 * the time (asked on the card). Each crossing starts the runner with { event: { kind: "place" } }.
 */
object Places {
  private const val PREFS = "appwin_automate_places"
  const val ACTION = "expo.modules.appwinautomate.PLACE"

  private fun lm(c: Context) = c.getSystemService(Context.LOCATION_SERVICE) as LocationManager

  fun canWatch(c: Context) = c.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  /** Replaces the watched places: [{ id, name, lat, lon, radius }]. */
  fun update(c: Context, json: String) {
    val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    unarm(c, p.getString("places", "[]") ?: "[]")
    p.edit().putString("places", json).apply()
    arm(c, json)
  }

  fun rearm(c: Context) {
    arm(c, c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("places", "[]") ?: "[]")
  }

  private fun arm(c: Context, json: String) {
    if (!canWatch(c) || Automate.isStopped(c)) return
    val a = try { JSONArray(json) } catch (e: Exception) { JSONArray() }
    for (i in 0 until a.length()) {
      val o = a.getJSONObject(i)
      try {
        lm(c).addProximityAlert(o.getDouble("lat"), o.getDouble("lon"), o.getDouble("radius").toFloat(), -1, intent(c, o.getString("id"), o.getString("name")))
      } catch (e: SecurityException) {
        Log.w(Automate.TAG, "No location permission for places", e)
      } catch (e: Exception) {
        Log.w(Automate.TAG, "Could not watch place ${o.optString("name")}", e)
      }
    }
  }

  private fun unarm(c: Context, json: String) {
    val a = try { JSONArray(json) } catch (e: Exception) { JSONArray() }
    for (i in 0 until a.length()) {
      val o = a.getJSONObject(i)
      try {
        lm(c).removeProximityAlert(intent(c, o.getString("id"), o.getString("name")))
      } catch (e: Exception) {
      }
    }
  }

  fun unarmAll(c: Context) = unarm(c, c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("places", "[]") ?: "[]")

  private fun intent(c: Context, id: String, name: String): PendingIntent {
    val i = Intent(c, PlaceReceiver::class.java).setAction(ACTION).setData(Uri.parse("appwin-automate://place/" + Uri.encode(id)))
      .putExtra("name", name)
    // Mutable: Android adds KEY_PROXIMITY_ENTERING to it when it fires.
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    return PendingIntent.getBroadcast(c, 0, i, flags)
  }
}

class PlaceReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (Automate.isStopped(context)) return
    val name = intent.getStringExtra("name") ?: return
    val entering = intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false)
    Log.i(Automate.TAG, "Place event: ${if (entering) "arrived at" else "left"} $name")
    val event = JSONObject().put("kind", "place").put("name", name).put("entering", entering)
    AutomateTaskService.start(context, JSONObject().put("event", event).toString(), if (entering) "arrived at $name" else "left $name")
  }
}
