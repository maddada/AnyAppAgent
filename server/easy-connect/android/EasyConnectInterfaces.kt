// Copied from Ghostex apps/mobile/app/modules/ghostex-native/android/src/main/java/expo/modules/
// ghostexnative/GhostexTailcatInterfaces.kt (same owner). Only the package, the bridge's Java
// package (dev.anyappagent, see build-android-bridge.mjs) and the log tag changed. Put it in the
// AnyAppAgent app's native module and change the package line to that module's package.
package dev.anyappagent.easyconnect

import android.util.Log
import dev.anyappagent.tailcatbridge.InterfaceLister
import dev.anyappagent.tailcatbridge.Tailcatbridge
import java.net.NetworkInterface
import java.util.Collections
import org.json.JSONArray
import org.json.JSONObject

/**
 * Enumerates this device's network interfaces on behalf of the Go tailcat bridge.
 *
 * A tailcat client builds a tailscale netmon before it can reach anything, and netmon
 * snapshots the machine's interfaces with Go's `net.Interfaces()`. On Linux that is an
 * `RTM_GETLINK` netlink request, which Android 11 (API 30) forbids apps from making, so the
 * call fails with `route ip+net: netlinkrib: permission denied` and every paired machine
 * looks unreachable. `java.net.NetworkInterface` reads the same data through the framework
 * instead of netlink and keeps working, so Java enumerates and the bridge parses (the same
 * split the Tailscale Android app uses).
 *
 * Failures are propagated, never swallowed: a half-enumerated interface list would make
 * netmon believe the device has a different network than it does.
 */
internal object EasyConnectInterfaces : InterfaceLister {

  /** Installs this lister in the bridge. Must run before anything can open a tailcat forward. */
  fun register() {
    Tailcatbridge.setInterfaceLister(this)
    Log.i(LOG_TAG, "registered the tailcat network interface lister")
  }

  /**
   * Returns a JSON array of interface objects for the bridge's `InterfaceLister` contract:
   * `name`, `index`, `mtu`, the `up`/`broadcast`/`loopback`/`pointToPoint`/`multicast` flags,
   * and `addrs` of `{ip, prefixLen}`. `ip` keeps the `%zone` suffix that IPv6 link-local
   * addresses carry.
   */
  override fun interfacesAsJson(): String {
    val out = JSONArray()
    val interfaces = NetworkInterface.getNetworkInterfaces() ?: return out.toString()
    for (nif in Collections.list(interfaces)) {
      val addrs = JSONArray()
      // Java has no per-interface broadcast flag; an interface supports broadcast exactly
      // when one of its addresses carries a broadcast address.
      var broadcast = false
      for (interfaceAddress in nif.interfaceAddresses) {
        // hostAddress is the stable textual form; InterfaceAddress.toString() is not.
        val host = interfaceAddress.address?.hostAddress ?: continue
        if (interfaceAddress.broadcast != null) broadcast = true
        addrs.put(
          JSONObject()
            .put("ip", host)
            .put("prefixLen", interfaceAddress.networkPrefixLength.toInt())
        )
      }
      out.put(
        JSONObject()
          .put("name", nif.name)
          .put("index", nif.index)
          .put("mtu", nif.mtu)
          .put("up", nif.isUp)
          .put("broadcast", broadcast)
          .put("loopback", nif.isLoopback)
          .put("pointToPoint", nif.isPointToPoint)
          .put("multicast", nif.supportsMulticast())
          .put("addrs", addrs)
      )
    }
    return out.toString()
  }

  private const val LOG_TAG = "AnyAppEasyConnect"
}
