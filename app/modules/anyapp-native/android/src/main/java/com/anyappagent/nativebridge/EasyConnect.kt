// The phone side of Easy Connect, as Ghostex's GhostexNativeModule.kt does it (same owner):
// register the interface lister and load the phone's client key once, before any tunnel exists;
// then StartForward per connection attempt, off the main thread (a cold rendezvous blocks for
// seconds). Wrap these three calls in the AnyAppAgent app's Expo module:
//
//   AsyncFunction("easyConnectClientKey") { promise -> background { promise.resolve(EasyConnect.clientKey(context)) } }
//   AsyncFunction("easyConnectStart") { address: String, port: Int, promise -> background {
//       promise.resolve(mapOf("localPort" to EasyConnect.start(address, port))) } }
//   AsyncFunction("easyConnectStop") { promise -> EasyConnect.stop(); promise.resolve(null) }
//
// and call EasyConnect.init(context) from the module's OnCreate. See docs/EASY-CONNECT.md.
package com.anyappagent.nativebridge

import android.content.Context
import dev.anyappagent.tailcatbridge.Tailcatbridge
import java.io.File

object EasyConnect {
  /** One id: the app talks to one PC. */
  private const val FORWARD_ID = "pc"

  @Volatile private var ready = false

  /** Call once, early (module OnCreate): the lister, then the client key, before any tunnel. */
  fun init(context: Context) {
    if (ready) return
    EasyConnectInterfaces.register()
    clientKey(context)
    ready = true
  }

  /** This phone's tailcat client public key ("nodekey:…"), created on first use and kept for good. */
  fun clientKey(context: Context): String {
    val dir = File(context.filesDir, "tailcat")
    dir.mkdirs()
    return Tailcatbridge.useClientKeyFile(File(dir, "client.key").absolutePath)
  }

  /**
   * Opens (or reuses, after probing it) the tunnel to the PC and returns the 127.0.0.1 port that
   * reaches the companion. Blocking: call it off the main thread. Throws when the PC is not
   * reachable or this phone's key is not on its allow-list.
   */
  fun start(address: String, port: Int): Int = Tailcatbridge.startForward(FORWARD_ID, address, port.toLong()).toInt()

  fun stop() = Tailcatbridge.stopForward(FORWARD_ID)

  /** The last per-connection dial error, or "". */
  fun lastError(): String = Tailcatbridge.lastError(FORWARD_ID)

  /** {"path":"relay"|"direct","route":"lan"|"internet","relay":"…","latencyMs":n}, or "". */
  fun path(): String = Tailcatbridge.forwardPath(FORWARD_ID)
}
