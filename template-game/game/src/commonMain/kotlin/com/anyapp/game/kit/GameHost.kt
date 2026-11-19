package com.anyapp.game.kit

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Everything the game asks of the phone. The game never calls Android itself: on Android the app
 * module fills this in (app/src/main/java/com/anyapp/app/game/AndroidGameHost.kt). When the game
 * moves to iPhone or the web, only this interface is written again for them.
 *
 * Need something new from the phone (Bluetooth play, the camera, a share)? Add a method here, fill
 * it in AndroidGameHost.kt, and add a do-nothing version to QuietHost below.
 */
interface GameHost {
  /** Hands the host a sound's bytes once (a WAV or OGG file, see Sounds). */
  fun loadSound(name: String, bytes: ByteArray)

  /** Plays a loaded sound; volume from 0 to 1. Unknown or not yet loaded sounds are skipped. */
  fun playSound(name: String, volume: Float = 1f)

  /** A short buzz, in milliseconds. */
  fun vibrate(millis: Int = 30)

  /** Saved values (high scores, settings, progress): they survive restarts and updates. */
  fun save(key: String, value: String)

  /** A saved value, or null. */
  fun load(key: String): String?

  /**
   * One question to the AI, through Kiwimake on the phone (it holds the key). Throws
   * GameAiException with a sentence for the player when AI is not set up or fails.
   */
  suspend fun askAi(prompt: String, system: String? = null): String

  /** Opens the app's Settings screen (Change this app, the version). */
  fun openSettings()
}

/** AI could not answer. message is a sentence the player can read. */
class GameAiException(message: String) : Exception(message)

/**
 * A host that does nothing (saves are kept in memory). For a new platform before its real host
 * exists, and for trying the game without a phone.
 */
open class QuietHost : GameHost {
  private val saved = mutableMapOf<String, String>()
  override fun loadSound(name: String, bytes: ByteArray) {}
  override fun playSound(name: String, volume: Float) {}
  override fun vibrate(millis: Int) {}
  override fun save(key: String, value: String) { saved[key] = value }
  override fun load(key: String): String? = saved[key]
  override suspend fun askAi(prompt: String, system: String?): String = throw GameAiException("AI is not available here.")
  override fun openSettings() {}
}

/** The host of the game on screen: `val host = LocalGameHost.current`. */
val LocalGameHost = staticCompositionLocalOf<GameHost> { QuietHost() }

/**
 * What happens around the game: the app going to the background, and the back gesture. The app
 * sets these; the game reads them (pause when hidden, back pauses or leaves a menu).
 */
class GameEvents {
  /** True while the app is not on screen (another app, the phone locked). Pause the game. */
  var hidden by mutableStateOf(false)

  /**
   * Set it true while the game wants the back gesture (while playing or in a menu). When false,
   * back leaves the game as in any app.
   */
  var wantsBack by mutableStateOf(false)

  /** Goes up by one on every back gesture the game asked for. */
  var backPresses by mutableIntStateOf(0)
    private set

  fun back() { backPresses++ }
}

val LocalGameEvents = staticCompositionLocalOf { GameEvents() }

/** Small helpers for saved numbers and switches. */
fun GameHost.loadInt(key: String, default: Int): Int = load(key)?.toIntOrNull() ?: default
fun GameHost.saveInt(key: String, value: Int) = save(key, value.toString())
fun GameHost.loadBoolean(key: String, default: Boolean): Boolean = load(key)?.toBooleanStrictOrNull() ?: default
fun GameHost.saveBoolean(key: String, value: Boolean) = save(key, value.toString())
