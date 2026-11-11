package expo.modules.anyappabilities

import android.content.Context
import android.content.Intent
import com.anyapp.abilities.Actions
import com.anyapp.abilities.Shares
import com.anyapp.abilities.Tiles
import com.anyapp.abilities.Widgets
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Phone abilities for React Native apps: widgets, Quick Settings tiles, app shortcuts and shares.
 * The same Kotlin core as the Kotlin template (com.anyapp.abilities). The TypeScript API is in
 * the .ts files of modules/abilities; what an app offers is declared in app.json (app.plugin.js).
 */
class AnyappAbilitiesModule : Module() {
  private val ctx: Context get() = appContext.reactContext ?: throw IllegalStateException("no context")
  private var pendingAction: String? = null
  private var pendingShare: String? = null

  override fun definition() = ModuleDefinition {
    Name("AnyappAbilities")
    Events("onOpenAction", "onShare")

    OnNewIntent { intent -> take(intent, emit = true) }

    // ---- actions
    Function("takeOpenedAction") {
      appContext.currentActivity?.intent?.let { take(it, emit = false) }
      pendingAction.also { pendingAction = null }
    }
    Function("setMessage") { text: String -> message = text }

    // ---- widgets
    Function("setWidget") { id: String, json: String -> Widgets.updateJson(ctx, id, json) }
    Function("widgetIds") { Widgets.ids(ctx) }
    Function("isWidgetPlaced") { id: String -> Widgets.isPlaced(ctx, id) }
    Function("pinWidget") { id: String -> Widgets.requestPin(ctx, id) }

    // ---- tiles
    Function("updateTile") { id: String, label: String?, subtitle: String?, on: Boolean? -> Tiles.update(ctx, id, label, subtitle, on) }
    Function("isTileOn") { id: String -> Tiles.isOn(ctx, id) }
    Function("tileIds") { Tiles.ids(ctx) }

    // ---- shares
    Function("takeShare") {
      appContext.currentActivity?.intent?.let { take(it, emit = false) }
      pendingShare.also { pendingShare = null }
    }
    Function("deleteSharedFile") { path: String -> Shares.delete(ctx, path) }
  }

  /** Keeps what [intent] carries until JavaScript takes it; [emit] tells JavaScript to come and take it. */
  private fun take(intent: Intent, emit: Boolean) {
    Actions.takeOpened(intent)?.let { a ->
      pendingAction = a.toJson().toString()
      if (emit) sendEvent("onOpenAction", mapOf<String, Any>())
    }
    val c = appContext.reactContext ?: return
    Shares.take(c, intent)?.let { s ->
      pendingShare = s.toJson().toString()
      if (emit) sendEvent("onShare", mapOf<String, Any>())
    }
  }

  companion object {
    @Volatile private var message: String? = null

    /** The message the last JavaScript action left (shown as a toast), once. */
    fun takeMessage(): String? = message.also { message = null }
  }
}
