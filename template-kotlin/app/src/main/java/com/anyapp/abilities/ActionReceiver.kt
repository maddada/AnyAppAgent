package com.anyapp.abilities

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * Widget buttons (an action that runs without opening the app) and the widget timeline ticks.
 * Declared in the manifest, not exported: only the app's own pending intents reach it.
 */
class ActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      REFRESH -> Widgets.refresh(context, intent.getStringExtra(EXTRA_WIDGET) ?: return)
      RUN -> {
        val action = try {
          AbilityAction.fromJson(JSONObject(intent.getStringExtra(EXTRA_ACTION) ?: return))
        } catch (_: Throwable) {
          return
        }
        val pending = goAsync()
        val main = Handler(Looper.getMainLooper())
        var done = false
        val finish = Runnable {
          if (!done) {
            done = true
            pending.finish()
          }
        }
        // A receiver may work about 10 s; the app's action gets 9 of them.
        main.postDelayed(finish, 9_000)
        Actions.run(context, action) { main.post(finish) }
      }
    }
  }

  companion object {
    const val RUN = "com.anyapp.abilities.RUN"
    const val REFRESH = "com.anyapp.abilities.REFRESH"
    const val EXTRA_ACTION = "action"
    const val EXTRA_WIDGET = "widget"
  }
}
