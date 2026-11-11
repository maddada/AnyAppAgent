// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package expo.modules.anyappfeedback

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The feedback screen opens by itself when the phone is shaken (FeedbackProvider starts it).
 * This module only lets JavaScript open it from a button too: `openFeedback()` in
 * modules/feedback/index.ts.
 */
class AnyappFeedbackModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AnyappFeedback")

    Function("open") {
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread { Feedback.open(activity) }
      true
    }
  }
}
