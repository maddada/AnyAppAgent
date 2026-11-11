package com.anyapp.abilities

import android.app.Activity
import android.os.Bundle

/**
 * App shortcuts (long-press the app icon) start this invisible screen: it runs the shortcut's
 * action in the background, or opens the app with it, and closes at once.
 * Extras: "action" (the action name), "id" (the shortcut id), "open" ("true" opens the app).
 */
class ActionActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val name = intent.getStringExtra("action")
    if (name != null) {
      val action = AbilityAction(name, "shortcut", intent.getStringExtra("id") ?: name)
      val open = intent.getStringExtra("open") == "true" || intent.getBooleanExtra("open", false)
      if (open) startActivity(Actions.openIntent(this, action))
      else Actions.run(this, action)
    }
    finish()
    @Suppress("DEPRECATION")
    overridePendingTransition(0, 0)
  }
}
