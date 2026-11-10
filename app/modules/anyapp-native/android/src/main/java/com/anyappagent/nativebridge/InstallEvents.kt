package com.anyappagent.nativebridge

import android.content.Intent

/**
 * Bridge between the manifest-declared [InstallResultReceiver] and the live module instance.
 * The receiver runs whenever PackageInstaller reports on a session; the module (if alive)
 * resolves the matching JS promise.
 */
object InstallEvents {
  /** (sessionId, status, message, packageName, confirmIntent) */
  @Volatile
  var listener: ((Int, String, String?, String?, Intent?) -> Unit)? = null

  fun emit(sessionId: Int, status: String, message: String?, packageName: String?, confirm: Intent? = null): Boolean {
    val l = listener ?: return false
    l(sessionId, status, message, packageName, confirm)
    return true
  }
}
