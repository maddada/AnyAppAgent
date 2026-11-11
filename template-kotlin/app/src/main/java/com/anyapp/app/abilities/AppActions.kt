package com.anyapp.app.abilities

import android.content.Context
import com.anyapp.abilities.AbilityAction
import com.anyapp.abilities.ActionRunner

/**
 * The app's background actions: what a widget button, a Quick Settings tile or an app shortcut
 * does while the app stays closed (see "Phone abilities" in AGENTS.md). Android starts it by the
 * name in AndroidManifest.xml (`com.anyapp.abilities.runner`), so keep the class name.
 *
 * Runs on the main thread: do quick work here, or start a coroutine and call [done] at the end
 * (within about 9 seconds). [done] takes a short message to show as a toast (shown only when the
 * app may post notifications), or null.
 */
class AppActions : ActionRunner {
  override fun run(context: Context, action: AbilityAction, done: (message: String?) -> Unit) {
    when (action.name) {
      // "log-glass" -> { Water.log(context); done("Glass logged") }
      // "widget-update" -> { showWidget(context, action.from); done(null) }   // a new widget asks to be filled in
      else -> done(null)
    }
  }
}
