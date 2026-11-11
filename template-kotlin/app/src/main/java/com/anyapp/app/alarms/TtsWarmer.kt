package com.anyapp.app.alarms

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.io.File
import java.util.Locale

/**
 * Warms the text-to-speech engine when spoken alarms are scheduled: binds the engine and
 * synthesizes a short phrase in the alarm's language to a throwaway file. That makes the engine
 * fetch a missing voice now (it can take many seconds the first time) instead of when the alarm
 * fires. At most once per language per app process.
 */
object TtsWarmer {
  private val warmed = mutableSetOf<String>()
  private val main = Handler(Looper.getMainLooper())

  fun warm(context: Context, language: String?) {
    val key = language ?: "default"
    synchronized(warmed) { if (!warmed.add(key)) return }
    val app = context.applicationContext
    main.post {
      var tts: TextToSpeech? = null
      val out = File(app.cacheDir, "anyapp-tts-warmup.wav")
      val shutdown = Runnable {
        tts?.let { runCatching { it.shutdown() } }
        tts = null
        out.delete()
      }
      tts = TextToSpeech(app) { status ->
        val engine = tts
        if (status != TextToSpeech.SUCCESS || engine == null) {
          Log.w(AlarmScheduler.TAG, "Speech warm-up: engine unavailable")
          main.post(shutdown)
          return@TextToSpeech
        }
        language?.let { engine.setLanguage(Locale.forLanguageTag(it)) }
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(id: String?) {}
          override fun onDone(id: String?) {
            Log.i(AlarmScheduler.TAG, "Speech warm-up done ($key)")
            main.post(shutdown)
          }
          @Deprecated("Deprecated in Java")
          override fun onError(id: String?) { main.post(shutdown) }
        })
        engine.synthesizeToFile("Ready.", null, out, "anyapp-warmup")
      }
      main.postDelayed(shutdown, 60_000)
    }
  }
}
