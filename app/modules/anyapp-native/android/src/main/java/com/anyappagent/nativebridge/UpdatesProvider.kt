package com.anyappagent.nativebridge

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Build

/**
 * "AnyAppAgent first" (docs/DISTRIBUTION.md, stage 5). An app made with AnyAppAgent asks
 * content://<this package>.updates/handles/<its package> before it shows an update of its own; a 1
 * means AnyAppAgent handles that app's updates here, so the app stays silent and there is one
 * notification and one install, from AnyAppAgent.
 *
 * AnyAppAgent handles an app it installed itself (the owner's phone: every build arrives from the
 * PC) and any app the person follows in AnyAppAgent ([setFollowed]). It answers only the app that
 * asks about itself, so no app can learn anything about another one.
 */
class UpdatesProvider : ContentProvider() {
  companion object {
    private const val PREFS = "anyapp_updates_host"
    private const val FOLLOWED = "followed"

    fun followed(ctx: Context): Set<String> = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(FOLLOWED, emptySet()) ?: emptySet()

    /** Apps the person added in AnyAppAgent from someone's share link: AnyAppAgent updates them. */
    fun setFollowed(ctx: Context, packages: Collection<String>) {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(FOLLOWED, packages.toSet()).apply()
    }

    fun handles(ctx: Context, pkg: String): Boolean = installedByUs(ctx, pkg) || pkg in followed(ctx)

    private fun installedByUs(ctx: Context, pkg: String): Boolean = try {
      if (Build.VERSION.SDK_INT >= 30) {
        ctx.packageManager.getInstallSourceInfo(pkg).installingPackageName == ctx.packageName
      } else {
        @Suppress("DEPRECATION")
        ctx.packageManager.getInstallerPackageName(pkg) == ctx.packageName
      }
    } catch (_: Exception) {
      false
    }
  }

  override fun onCreate(): Boolean = true

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? {
    val ctx = context ?: return null
    val segments = uri.pathSegments
    if (segments.size != 2 || segments[0] != "handles") return null
    val pkg = segments[1]
    val answer = if (callingPackage == pkg && handles(ctx, pkg)) 1 else 0
    return MatrixCursor(arrayOf("handles")).apply { addRow(arrayOf(answer)) }
  }

  override fun getType(uri: Uri): String? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}

/** Lets apps made with AnyAppAgent find it (action com.anyappagent.action.UPDATES). Nothing binds to it. */
class UpdatesHostService : android.app.Service() {
  override fun onBind(intent: android.content.Intent?): android.os.IBinder? = null
}
