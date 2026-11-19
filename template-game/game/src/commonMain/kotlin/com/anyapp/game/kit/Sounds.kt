package com.anyapp.game.kit

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.anyapp.game.resources.Res

/**
 * The game's sounds: files in src/commonMain/composeResources/files/sounds/<name>.wav (or .ogg),
 * loaded once and played by name. Short sounds (under 2 s) for effects; keep each file small.
 *
 *   val sounds = rememberSounds("catch", "hit")
 *   sounds.play("catch")
 */
class Sounds(private val host: GameHost) {
  /** The player's sound switch (saved). */
  var on by mutableStateOf(host.loadBoolean("sound", true))
    private set

  fun toggle() {
    on = !on
    host.saveBoolean("sound", on)
  }

  fun play(name: String, volume: Float = 1f) {
    if (on) host.playSound(name, volume)
  }

  internal suspend fun load(name: String) {
    for (ext in listOf("wav", "ogg")) {
      val bytes = runCatching { Res.readBytes("files/sounds/$name.$ext") }.getOrNull() ?: continue
      host.loadSound(name, bytes)
      return
    }
  }
}

@Composable
fun rememberSounds(vararg names: String): Sounds {
  val host = LocalGameHost.current
  val sounds = remember(host) { Sounds(host) }
  LaunchedEffect(sounds) { for (name in names) sounds.load(name) }
  return sounds
}
