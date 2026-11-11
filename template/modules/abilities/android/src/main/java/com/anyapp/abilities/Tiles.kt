package com.anyapp.abilities

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import org.json.JSONObject

/**
 * Quick Settings tiles (pull down the status bar twice, then the pencil to add one). The app
 * declares up to 4 tiles (services [Tile1] .. [Tile4]) with an android:label, an android:icon and
 * meta-data: `com.anyapp.abilities.tile` (its id), `com.anyapp.abilities.tile.mode`
 * ("run": run the action in the background, "open": open the app with it, "toggle": switch on and
 * off, then run it with data.on) and optionally `com.anyapp.abilities.tile.action` (the action
 * name; default the tile id).
 */
object Tiles {
  private val SLOTS = listOf(Tile1::class.java, Tile2::class.java, Tile3::class.java, Tile4::class.java)

  data class Config(val id: String, val mode: String, val action: String)

  /** Changes what tile [id] shows. Null leaves a field as it is; "" clears the subtitle. */
  fun update(context: Context, id: String, label: String? = null, subtitle: String? = null, on: Boolean? = null) {
    val prefs = Actions.prefs(context)
    val o = runCatching { JSONObject(prefs.getString("tile:$id", "{}")!!) }.getOrDefault(JSONObject())
    label?.let { o.put("label", it) }
    subtitle?.let { o.put("subtitle", it) }
    on?.let { o.put("on", it) }
    prefs.edit().putString("tile:$id", o.toString()).apply()
    slotOf(context, id)?.let { TileService.requestListeningState(context, ComponentName(context, it)) }
  }

  /** Whether toggle tile [id] is on. */
  fun isOn(context: Context, id: String): Boolean = state(context, id).optBoolean("on", false)

  /** The tile ids this app declares. */
  fun ids(context: Context): List<String> = SLOTS.mapNotNull { config(context, it)?.id }

  internal fun state(context: Context, id: String): JSONObject =
    runCatching { JSONObject(Actions.prefs(context).getString("tile:$id", "{}")!!) }.getOrDefault(JSONObject())

  internal fun config(context: Context, cls: Class<*>): Config? = try {
    val info = context.packageManager.getServiceInfo(ComponentName(context, cls), PackageManager.GET_META_DATA)
    val md = info.metaData
    val id = md?.getString("com.anyapp.abilities.tile")
    if (id == null) null else Config(id, md.getString("com.anyapp.abilities.tile.mode") ?: "run", md.getString("com.anyapp.abilities.tile.action") ?: id)
  } catch (_: PackageManager.NameNotFoundException) {
    null
  }

  private fun slotOf(context: Context, id: String): Class<*>? = SLOTS.firstOrNull { config(context, it)?.id == id }
}

open class AbilityTileService : TileService() {
  private val config get() = Tiles.config(this, javaClass)

  override fun onStartListening() {
    super.onStartListening()
    draw()
  }

  private fun draw() {
    val tile = qsTile ?: return
    val c = config ?: return
    val s = Tiles.state(this, c.id)
    s.optString("label").takeIf { it.isNotEmpty() }?.let { tile.label = it }
    if (Build.VERSION.SDK_INT >= 29) tile.subtitle = s.optString("subtitle").takeIf { it.isNotEmpty() }
    tile.state = when {
      c.mode == "toggle" -> if (s.optBoolean("on")) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
      else -> Tile.STATE_INACTIVE
    }
    tile.updateTile()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  override fun onClick() {
    super.onClick()
    val c = config ?: return
    when (c.mode) {
      "open" -> {
        val intent = Actions.openIntent(this, AbilityAction(c.action, "tile", c.id))
        val go = {
          if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or Actions.immutable))
          } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
          }
        }
        if (isLocked) unlockAndRun { go() } else go()
      }
      "toggle" -> {
        val on = !Tiles.isOn(this, c.id)
        Tiles.update(this, c.id, on = on)
        draw()
        Actions.run(this, AbilityAction(c.action, "tile", c.id, JSONObject().put("on", on)))
      }
      else -> {
        qsTile?.let {
          it.state = Tile.STATE_ACTIVE
          it.updateTile()
        }
        Actions.run(this, AbilityAction(c.action, "tile", c.id)) { draw() }
      }
    }
  }
}

class Tile1 : AbilityTileService()
class Tile2 : AbilityTileService()
class Tile3 : AbilityTileService()
class Tile4 : AbilityTileService()
