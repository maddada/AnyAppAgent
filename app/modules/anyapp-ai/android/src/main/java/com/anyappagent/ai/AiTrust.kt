package com.anyappagent.ai

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import java.security.MessageDigest

/**
 * Who may use the AI key: apps signed with the same certificate as an app Kiwimake installed
 * itself. Every app the PC makes is signed with the PC's one signing key, so this means "apps
 * made with Kiwimake", and nothing else on the phone (another app cannot be signed with that
 * key without the PC's private key).
 *
 * How Kiwimake learns the certificate: the first time an app calls, if Android says
 * Kiwimake is the app that installed it (install source, recorded by the system and not
 * settable by the app), its certificate is remembered. From then on any app with that
 * certificate is allowed, however it was installed (a later update, adb during development).
 * A second PC (another key) is learned the same way.
 *
 * The caller is identified by the UID that the system attaches to every Binder message
 * (Message.sendingUid), so it cannot be faked by the caller.
 */
object AiTrust {
  sealed class Result {
    data class Allowed(val packageName: String) : Result()
    data class Refused(val reason: String) : Result()
  }

  fun check(ctx: Context, uid: Int): Result {
    if (uid < 0) return Result.Refused("unknown sender")
    if (uid == Process.myUid()) return Result.Refused("self")
    val pm = ctx.packageManager
    val packages = pm.getPackagesForUid(uid)?.toList().orEmpty()
    if (packages.isEmpty()) return Result.Refused("unknown app")
    val trusted = AiStore.trustedSigners(ctx)
    for (pkg in packages) {
      val signer = signer(ctx, pkg) ?: continue
      if (signer in trusted) return Result.Allowed(pkg)
    }
    // An app moved to its own key (docs/DISTRIBUTION.md) and updated by its own updater: its key
    // history still holds the trusted key it was signed with before (Android proved the rotation).
    for (pkg in packages) {
      val signer = signer(ctx, pkg) ?: continue
      if (history(ctx, pkg).any { it in trusted }) {
        AiStore.addTrustedSigner(ctx, signer)
        return Result.Allowed(pkg)
      }
    }
    for (pkg in packages) {
      val signer = signer(ctx, pkg) ?: continue
      if (installedByUs(ctx, pkg)) {
        AiStore.addTrustedSigner(ctx, signer)
        return Result.Allowed(pkg)
      }
    }
    return Result.Refused("not made with Kiwimake")
  }

  /** SHA-256 of the app's one signing certificate; null if it has several signers or none. */
  fun signer(ctx: Context, pkg: String): String? {
    return try {
      val pm = ctx.packageManager
      val certs = if (Build.VERSION.SDK_INT >= 28) {
        val info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
        val si = info.signingInfo ?: return null
        if (si.hasMultipleSigners()) return null
        si.apkContentsSigners
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures
      }
      if (certs == null || certs.size != 1) return null
      MessageDigest.getInstance("SHA-256").digest(certs[0].toByteArray()).joinToString("") { "%02x".format(it) }
    } catch (_: Exception) {
      null
    }
  }

  /** SHA-256s of every certificate in the app's signing history (Android 9+: key rotation), oldest first. */
  private fun history(ctx: Context, pkg: String): List<String> {
    if (Build.VERSION.SDK_INT < 28) return emptyList()
    return try {
      val si = ctx.packageManager.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo ?: return emptyList()
      if (si.hasMultipleSigners()) return emptyList()
      si.signingCertificateHistory.orEmpty().map { c -> MessageDigest.getInstance("SHA-256").digest(c.toByteArray()).joinToString("") { "%02x".format(it) } }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun installedByUs(ctx: Context, pkg: String): Boolean {
    val me = ctx.packageName
    return try {
      val pm = ctx.packageManager
      if (Build.VERSION.SDK_INT >= 30) {
        val src = pm.getInstallSourceInfo(pkg)
        src.installingPackageName == me || src.initiatingPackageName == me
      } else {
        @Suppress("DEPRECATION")
        pm.getInstallerPackageName(pkg) == me
      }
    } catch (_: Exception) {
      false
    }
  }

  fun label(ctx: Context, pkg: String): String? = try {
    val pm = ctx.packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (_: Exception) {
    null
  }
}
