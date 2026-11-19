package com.anyapp.app.game

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.VibrationEffect
import android.os.Vibrator
import com.anyapp.app.ai.Ai
import com.anyapp.app.ai.AiError
import com.anyapp.game.kit.GameAiException
import com.anyapp.game.kit.GameHost
import java.io.File

/**
 * The game's phone abilities on Android (GameHost in game/.../kit/GameHost.kt). The game itself
 * never touches Android: anything new it needs from the phone gets a method in GameHost and its
 * Android version here.
 */
class AndroidGameHost(private val context: Context, private val onOpenSettings: () -> Unit) : GameHost {
  private val pool = SoundPool.Builder()
    .setMaxStreams(8)
    .setAudioAttributes(
      AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
    )
    .build()
  private val soundIds = mutableMapOf<String, Int>()
  private val loaded = mutableSetOf<Int>()
  private val prefs = context.getSharedPreferences("game", Context.MODE_PRIVATE)

  init {
    pool.setOnLoadCompleteListener { _, id, status -> if (status == 0) synchronized(loaded) { loaded += id } }
  }

  override fun loadSound(name: String, bytes: ByteArray) {
    if (name in soundIds) return
    // SoundPool reads files, so each sound is written once to the app's cache.
    val file = File(context.cacheDir, "game-sounds/$name")
    file.parentFile?.mkdirs()
    file.writeBytes(bytes)
    soundIds[name] = pool.load(file.path, 1)
  }

  override fun playSound(name: String, volume: Float) {
    val id = soundIds[name] ?: return
    if (synchronized(loaded) { id in loaded }) pool.play(id, volume, volume, 1, 0, 1f)
  }

  override fun vibrate(millis: Int) {
    val vibrator = context.getSystemService(Vibrator::class.java) ?: return
    if (vibrator.hasVibrator()) vibrator.vibrate(VibrationEffect.createOneShot(millis.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
  }

  override fun save(key: String, value: String) {
    prefs.edit().putString(key, value).apply()
  }

  override fun load(key: String): String? = prefs.getString(key, null)

  override suspend fun askAi(prompt: String, system: String?): String =
    try {
      Ai.ask(context, prompt, system = system)
    } catch (e: AiError) {
      throw GameAiException(e.message ?: "AI did not answer.")
    }

  override fun openSettings() = onOpenSettings()

  fun release() = pool.release()
}
