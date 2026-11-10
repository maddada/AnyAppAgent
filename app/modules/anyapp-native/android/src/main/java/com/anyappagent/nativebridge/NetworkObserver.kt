package com.anyappagent.nativebridge

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper

/**
 * Tells JS when the phone's network changes (Wi-Fi to mobile data and back), so Easy Connect
 * can redial at once instead of waiting for the old tunnel to time out. Copied from Ghostex's
 * GhostexNetworkObserver.kt: every internet network (VPNs included), onAvailable and onLost,
 * debounced 750 ms on the main thread.
 */
class NetworkObserver(private val context: Context, private val onChange: () -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private val fire = Runnable { onChange() }
  private var callback: ConnectivityManager.NetworkCallback? = null

  fun start() {
    if (callback != null) return
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
    val request = NetworkRequest.Builder()
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
      .build()
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = debounce()
      override fun onLost(network: Network) = debounce()
    }
    try {
      cm.registerNetworkCallback(request, cb)
      callback = cb
    } catch (_: Exception) {
    }
  }

  fun stop() {
    val cb = callback ?: return
    callback = null
    handler.removeCallbacks(fire)
    try {
      (context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)?.unregisterNetworkCallback(cb)
    } catch (_: Exception) {
    }
  }

  private fun debounce() {
    handler.removeCallbacks(fire)
    handler.postDelayed(fire, 750)
  }
}
