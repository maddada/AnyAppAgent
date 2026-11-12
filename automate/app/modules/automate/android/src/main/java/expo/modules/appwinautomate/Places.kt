package expo.modules.appwinautomate

import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * M4: arrive at and leave a place. While an automation that is on watches a place, the listener
 * service (ListenerService, "Listening for ... places") asks Android for a balanced location about
 * once a minute and decides itself when the phone crossed a place's edge. Android's own proximity
 * alerts were tried first: they checked only every 30 minutes on the emulator, too late for
 * "when I leave work". Needs Location, all the time (asked on the card).
 *
 * Each place remembers "in" or "out". The first location only sets it (being there already is not
 * an arrival), and a 30 m margin at the edge keeps a phone standing on the line from flickering.
 */
object Places {
  private const val PREFS = "appwin_automate_places"
  private const val MARGIN_M = 30.0

  private fun lm(c: Context) = c.getSystemService(Context.LOCATION_SERVICE) as LocationManager

  fun canWatch(c: Context) = c.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  /** Replaces the watched places: [{ id, name, lat, lon, radius }]. */
  fun update(c: Context, json: String) {
    val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if ((p.getString("places", "[]") ?: "[]") == json) return
    val keep = names(json)
    val edit = p.edit().putString("places", json)
    for (k in p.all.keys) if (k.startsWith("in:") && k.removePrefix("in:") !in keep) edit.remove(k)
    edit.apply()
  }

  fun watched(c: Context): JSONArray = try {
    JSONArray(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("places", "[]") ?: "[]")
  } catch (e: Exception) {
    JSONArray()
  }

  private fun names(json: String): Set<String> = try {
    val a = JSONArray(json)
    (0 until a.length()).map { a.getJSONObject(it).getString("name").lowercase() }.toSet()
  } catch (e: Exception) {
    emptySet()
  }

  fun state(c: Context, name: String): String? = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("in:" + name.lowercase(), null)

  private fun setState(c: Context, name: String, state: String) {
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("in:" + name.lowercase(), state).apply()
  }

  /** A new location: every place whose side changed starts the runner. */
  fun check(c: Context, here: Location) {
    if (Automate.isStopped(c)) return
    val places = watched(c)
    for (i in 0 until places.length()) {
      val o = places.getJSONObject(i)
      val name = o.getString("name")
      val d = FloatArray(1)
      Location.distanceBetween(here.latitude, here.longitude, o.getDouble("lat"), o.getDouble("lon"), d)
      val radius = o.getDouble("radius")
      val now = when {
        d[0] <= radius -> "in"
        d[0] >= radius + MARGIN_M -> "out"
        else -> continue
      }
      val before = state(c, name)
      if (before == now) continue
      setState(c, name, now)
      if (before == null) continue
      val entering = now == "in"
      Log.i(Automate.TAG, "Place event: ${if (entering) "arrived at" else "left"} $name")
      val event = JSONObject().put("kind", "place").put("name", name).put("entering", entering)
      AutomateTaskService.start(c, JSONObject().put("event", event).toString(), if (entering) "arrived at $name" else "left $name")
    }
  }

  /** Location updates for the listener service; returns the listener to remove later, or null. */
  fun start(c: Context): LocationListener? {
    if (!canWatch(c)) return null
    val listener = LocationListener { loc -> check(c, loc) }
    val lm = lm(c)
    val providers = if (Build.VERSION.SDK_INT >= 31 && lm.hasProvider(LocationManager.FUSED_PROVIDER)) {
      listOf(LocationManager.FUSED_PROVIDER)
    } else {
      listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
    }
    return try {
      for (p in providers) lm.requestLocationUpdates(p, 60_000L, 25f, listener, Looper.getMainLooper())
      listOf(LocationManager.FUSED_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
        .maxByOrNull { it.time }
        ?.let { check(c, it) }
      listener
    } catch (e: SecurityException) {
      Log.w(Automate.TAG, "No location permission for places", e)
      null
    }
  }

  fun stop(c: Context, listener: LocationListener?) {
    if (listener != null) runCatching { lm(c).removeUpdates(listener) }
  }
}
