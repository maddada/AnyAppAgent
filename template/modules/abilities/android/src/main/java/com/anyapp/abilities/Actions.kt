package com.anyapp.abilities

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import org.json.JSONObject

/**
 * Phone abilities (widgets, Quick Settings tiles, app shortcuts, shares) are one Kotlin core used
 * by both templates: the Kotlin template compiles it into the app, the React Native template wraps
 * it as an Expo module (modules/abilities). Keep the two copies the same.
 *
 * An action is a name the app chose ("log-glass"), started from a widget button, a tile or a
 * shortcut. It either runs in the background (the app's [ActionRunner] does the work, the app
 * stays closed) or opens the app, which then reads it with [Actions.takeOpened].
 */
data class AbilityAction(
  /** The app's own name for it, for example "log-glass". */
  val name: String,
  /** "widget", "tile" or "shortcut". */
  val source: String,
  /** The widget, tile or shortcut id it came from. */
  val from: String,
  /** Extra values (a toggle tile adds "on"). */
  val data: JSONObject = JSONObject(),
) {
  fun toJson(): JSONObject = JSONObject().put("name", name).put("source", source).put("from", from).put("data", data)

  companion object {
    fun fromJson(o: JSONObject) = AbilityAction(
      o.optString("name"), o.optString("source"), o.optString("from"), o.optJSONObject("data") ?: JSONObject(),
    )
  }
}

/**
 * Runs actions in the background. The app names its runner in the manifest:
 * `<meta-data android:name="com.anyapp.abilities.runner" android:value="<class name>" />`
 * inside `<application>`. [done] takes an optional short message, shown as a toast.
 */
interface ActionRunner {
  fun run(context: Context, action: AbilityAction, done: (message: String?) -> Unit)
}

object Actions {
  const val TAG = "AnyappAbilities"
  private const val EXTRA = "com.anyapp.abilities.ACTION"
  private const val RUNNER_KEY = "com.anyapp.abilities.runner"
  private val main = Handler(Looper.getMainLooper())

  /** Runs [action] with the app's runner; [finished] is called once, on the main thread. */
  fun run(context: Context, action: AbilityAction, finished: () -> Unit = {}) {
    val app = context.applicationContext
    var over = false
    val end = { message: String? ->
      main.post {
        if (!over) {
          over = true
          if (!message.isNullOrBlank()) Toast.makeText(app, message, Toast.LENGTH_SHORT).show()
          finished()
        }
      }
      Unit
    }
    val runner = runner(app)
    if (runner == null) {
      Log.w(TAG, "No action runner declared; ignoring ${action.name}")
      end(null)
      return
    }
    main.post {
      try {
        runner.run(app, action) { end(it) }
      } catch (e: Throwable) {
        Log.e(TAG, "Action ${action.name} failed", e)
        end(null)
      }
    }
  }

  private var cached: ActionRunner? = null

  private fun runner(context: Context): ActionRunner? {
    cached?.let { return it }
    return try {
      val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
      val name = info.metaData?.getString(RUNNER_KEY) ?: return null
      (Class.forName(name).getDeclaredConstructor().newInstance() as ActionRunner).also { cached = it }
    } catch (e: Throwable) {
      Log.e(TAG, "Could not load the action runner", e)
      null
    }
  }

  /** The intent that opens the app (its launcher activity), carrying [action] if given. */
  fun openIntent(context: Context, action: AbilityAction?): Intent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (action != null) {
      intent.putExtra(EXTRA, action.toJson().toString())
      // A distinct data URI so Android does not merge two pending intents with different actions.
      intent.data = android.net.Uri.parse("anyapp-action://${context.packageName}/${action.source}/${action.from}/${action.name}")
    }
    return intent
  }

  /** The action that opened the app through [intent], or null. Reading it removes it, so it is handled once. */
  fun takeOpened(intent: Intent?): AbilityAction? {
    val raw = intent?.getStringExtra(EXTRA) ?: return null
    intent.removeExtra(EXTRA)
    if (intent.data?.scheme == "anyapp-action") intent.data = null
    return try { AbilityAction.fromJson(JSONObject(raw)) } catch (_: Throwable) { null }
  }

  internal fun prefs(context: Context) = context.applicationContext.getSharedPreferences("anyapp_abilities", Context.MODE_PRIVATE)

  /** A resource id by name, from the app's merged resources (shared by both templates, so no R class). */
  internal fun res(context: Context, name: String, type: String): Int =
    context.resources.getIdentifier(name, type, context.packageName)

  internal val immutable = if (Build.VERSION.SDK_INT >= 23) android.app.PendingIntent.FLAG_IMMUTABLE else 0
}
