package expo.modules.anyappupdates

import android.content.Intent
import com.anyapp.updates.AppUpdater
import com.anyapp.updates.ChangeThisApp
import com.anyapp.updates.UpdateActivity
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Updates for people the app is shared with, for React Native apps: the same Kotlin core as the
 * Kotlin template (com.anyapp.updates). It starts by itself when the app opens; JavaScript only
 * needs it for an "update" line or a Check now button (modules/updates/index.ts).
 */
class AnyappUpdatesModule : Module() {
  private val ctx get() = appContext.reactContext ?: throw IllegalStateException("no context")

  override fun definition() = ModuleDefinition {
    Name("AnyappUpdates")

    OnCreate { appContext.reactContext?.let { AppUpdater.onAppStart(it) } }

    // JSON: { state: "off" | "up-to-date" | "anyappagent" | "available" | "problem", version?, notes?, message? }
    AsyncFunction("check") {
      val json = JSONObject()
      when (val s = AppUpdater.check(ctx)) {
        is AppUpdater.State.Off -> json.put("state", "off")
        is AppUpdater.State.UpToDate -> json.put("state", "up-to-date")
        is AppUpdater.State.HandledByAnyAppAgent -> json.put("state", "anyappagent")
        is AppUpdater.State.Available -> json.put("state", "available").put("version", s.update.version).put("notes", s.update.notes).put("build", s.update.build)
        is AppUpdater.State.Problem -> json.put("state", "problem").put("message", s.message)
      }
      json.toString()
    }

    Function("open") {
      ctx.startActivity(Intent(ctx, UpdateActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(UpdateActivity.EXTRA_START, true))
    }

    Function("isOn") { AppUpdater.isOn(ctx) }
    Function("channel") { AppUpdater.channel(ctx) }
    Function("setChannel") { channel: String -> AppUpdater.setChannel(ctx, channel) }

    // "Change this app" (AnyAppAgent docs/CHANGE-THIS-APP.md): whether the row shows here (the
    // owner's phone always; others unless the owner hid it), and its tap.
    AsyncFunction("changeVisible") { ChangeThisApp.visible(ctx) }
    Function("changeOwner") { ChangeThisApp.owner(ctx) }
    Function("openChange") { screen: String? ->
      val activity = appContext.currentActivity ?: throw IllegalStateException("no activity")
      ChangeThisApp.open(activity, screen)
    }
  }
}
