package expo.modules.appwinautomate

import android.app.Service
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiInfo
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONArray
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject

/**
 * Listens for the charger, Wi-Fi and Bluetooth while an automation that is on needs it (the runtime
 * says which with listen()). A foreground service of type connectedDevice with a small notice and
 * Stop all; each event starts the headless runner (AutomateTaskService) with { event: {...} }.
 */
class ListenerService : Service() {
  private var kinds: Set<String> = emptySet()
  private var power: BroadcastReceiver? = null
  private var bluetooth: BroadcastReceiver? = null
  private var wifi: ConnectivityManager.NetworkCallback? = null
  private var wifiSince = 0L
  private val wifiNames = HashMap<Network, String?>()

  // M5: the app in front, from usage events, polled only while an automation needs it.
  private val main = Handler(Looper.getMainLooper())
  private var polling = false
  private var frontPkg: String? = null
  private var frontSince = 0L
  private var lastPoll = 0L
  private val sentMinutes = HashSet<Int>()
  private var places: android.location.LocationListener? = null
  private val poll = object : Runnable {
    override fun run() {
      try {
        pollFront()
      } catch (e: Exception) {
        Log.w(Automate.TAG, "App in front: poll failed", e)
      }
      if (polling) main.postDelayed(this, 10_000)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    kinds = wanted(this)
    if (kinds.isEmpty() || Automate.isStopped(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    val notice = Notices.listening(this, kinds)
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(Notices.LISTENING_ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      } else {
        startForeground(Notices.LISTENING_ID, notice)
      }
    } catch (e: Exception) {
      Log.w(Automate.TAG, "Could not start listening", e)
      stopSelf()
      return START_NOT_STICKY
    }
    register()
    return START_STICKY
  }

  private fun register() {
    if ("charging" in kinds && power == null) {
      power = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
          emit(JSONObject().put("kind", "charging").put("plugged", i.action == Intent.ACTION_POWER_CONNECTED), "charger")
        }
      }
      registerReceiver(power, IntentFilter().apply {
        addAction(Intent.ACTION_POWER_CONNECTED)
        addAction(Intent.ACTION_POWER_DISCONNECTED)
      })
    } else if ("charging" !in kinds) unregister(power).also { power = null }

    if ("bluetooth" in kinds && bluetooth == null) {
      bluetooth = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
          val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= 33) {
            i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
          } else {
            @Suppress("DEPRECATION") i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
          }
          val name = try {
            if (Build.VERSION.SDK_INT < 31 || checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) device?.name else null
          } catch (e: SecurityException) {
            null
          }
          emit(
            JSONObject().put("kind", "bluetooth").put("connected", i.action == BluetoothDevice.ACTION_ACL_CONNECTED).put("device", name ?: JSONObject.NULL),
            "Bluetooth"
          )
        }
      }
      registerReceiver(bluetooth, IntentFilter().apply {
        addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
        addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
      })
    } else if ("bluetooth" !in kinds) unregister(bluetooth).also { bluetooth = null }

    if ("wifi" in kinds && wifi == null) {
      val cm = getSystemService(ConnectivityManager::class.java)
      val cb = if (Build.VERSION.SDK_INT >= 31) object : ConnectivityManager.NetworkCallback(FLAG_INCLUDE_LOCATION_INFO) {
        override fun onCapabilitiesChanged(n: Network, caps: NetworkCapabilities) = seen(n, caps)
        override fun onLost(n: Network) = lost(n)
      } else object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(n: Network, caps: NetworkCapabilities) = seen(n, caps)
        override fun onLost(n: Network) = lost(n)
      }
      wifiSince = SystemClock.elapsedRealtime()
      cm.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), cb)
      wifi = cb
    } else if ("wifi" !in kinds && wifi != null) {
      try {
        getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(wifi!!)
      } catch (e: Exception) {
      }
      wifi = null
    }

    if ("place" in kinds && places == null) {
      places = Places.start(this)
    } else if ("place" !in kinds && places != null) {
      Places.stop(this, places)
      places = null
    }

    if ("app" in kinds && !polling) {
      polling = true
      lastPoll = System.currentTimeMillis() - 15_000
      main.post(poll)
    } else if ("app" !in kinds && polling) {
      polling = false
      main.removeCallbacks(poll)
    }
  }

  /** The newest app that came to the front, and minutes marks for the apps automations watch. */
  private fun pollFront() {
    if (!usageAccess(this)) return
    val usm = getSystemService(UsageStatsManager::class.java)
    val now = System.currentTimeMillis()
    val events = usm.queryEvents(lastPoll, now)
    lastPoll = now
    var newest: String? = null
    val e = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      if (e.eventType == UsageEvents.Event.ACTIVITY_RESUMED) newest = e.packageName
    }
    if (newest != null && newest != frontPkg) {
      frontPkg = newest
      frontSince = now
      sentMinutes.clear()
    }
    val pkg = frontPkg ?: return
    if (pkg == packageName) return
    val label = try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (ex: Exception) {
      pkg
    }
    val elapsed = ((now - frontSince) / 60_000).toInt()
    for ((app, marks) in appWatches(this)) {
      if (!(label.lowercase().contains(app) || pkg.lowercase() == app)) continue
      for (m in marks) {
        if (m <= elapsed && m !in sentMinutes) {
          sentMinutes.add(m)
          emit(JSONObject().put("kind", "app").put("app", label).put("package", pkg).put("minutes", m), label)
        }
      }
    }
  }

  private fun ssid(caps: NetworkCapabilities): String? {
    val info = if (Build.VERSION.SDK_INT >= 29) caps.transportInfo as? WifiInfo else null
    val raw = info?.ssid ?: return null
    if (raw == WifiManagerUnknown || raw.isBlank()) return null
    return raw.trim('"')
  }

  @Synchronized
  private fun seen(n: Network, caps: NetworkCapabilities) {
    if (wifiNames.containsKey(n)) {
      if (wifiNames[n] == null) wifiNames[n] = ssid(caps)
      return
    }
    val name = ssid(caps)
    wifiNames[n] = name
    // The network the phone is already on when listening starts is not a new connection.
    if (SystemClock.elapsedRealtime() - wifiSince < 3_000) return
    emit(JSONObject().put("kind", "wifi").put("connected", true).put("network", name ?: JSONObject.NULL), "Wi-Fi")
  }

  @Synchronized
  private fun lost(n: Network) {
    if (!wifiNames.containsKey(n)) return
    val name = wifiNames.remove(n)
    emit(JSONObject().put("kind", "wifi").put("connected", false).put("network", name ?: JSONObject.NULL), "Wi-Fi")
  }

  private fun emit(event: JSONObject, label: String) {
    if (Automate.isStopped(this)) return
    Log.i(Automate.TAG, "Event $event")
    AutomateTaskService.start(this, JSONObject().put("event", event).toString(), label)
  }

  private fun unregister(r: BroadcastReceiver?) {
    if (r == null) return
    try {
      unregisterReceiver(r)
    } catch (e: Exception) {
    }
  }

  override fun onDestroy() {
    Places.stop(this, places)
    places = null
    polling = false
    main.removeCallbacks(poll)
    unregister(power)
    unregister(bluetooth)
    wifi?.let {
      try {
        getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it)
      } catch (e: Exception) {
      }
    }
    super.onDestroy()
  }

  companion object {
    private const val PREFS = "appwin_automate_listen"
    private const val WifiManagerUnknown = "<unknown ssid>"

    fun wanted(c: Context): Set<String> =
      c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet("kinds", emptySet())?.toSet() ?: emptySet()

    private const val APPS = "appwin_automate_apps"

    /** Watched apps: lowercase name or package to the minute marks that matter (0: when it opens). */
    fun appWatches(c: Context): Map<String, List<Int>> {
      val raw = c.getSharedPreferences(APPS, Context.MODE_PRIVATE).getString("watches", "[]") ?: "[]"
      return try {
        val a = JSONArray(raw)
        (0 until a.length()).associate { i ->
          val o = a.getJSONObject(i)
          val marks = o.getJSONArray("minutes")
          o.getString("app").lowercase() to (0 until marks.length()).map { marks.getInt(it) }
        }
      } catch (e: Exception) {
        emptyMap()
      }
    }

    fun setAppWatches(c: Context, json: String) {
      c.getSharedPreferences(APPS, Context.MODE_PRIVATE).edit().putString("watches", json).apply()
    }

    fun usageAccess(c: Context): Boolean {
      val ops = c.getSystemService(AppOpsManager::class.java)
      val mode = if (Build.VERSION.SDK_INT >= 29) {
        ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), c.packageName)
      } else {
        @Suppress("DEPRECATION") ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), c.packageName)
      }
      return mode == AppOpsManager.MODE_ALLOWED
    }

    /** Remembers what to listen for and starts, updates or stops the listener. */
    fun update(c: Context, kinds: Set<String>) {
      c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet("kinds", kinds).apply()
      restart(c)
    }

    fun restart(c: Context) {
      val intent = Intent(c, ListenerService::class.java)
      if (wanted(c).isEmpty() || Automate.isStopped(c)) {
        c.stopService(intent)
        return
      }
      try {
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(intent) else c.startService(intent)
      } catch (e: Exception) {
        Log.w(Automate.TAG, "Could not start the listener", e)
      }
    }
  }
}
