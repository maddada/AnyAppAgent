package expo.modules.appwinautomate

import android.content.Context
import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/** Speaks on the alarm stream, so it is heard in Do Not Disturb (priority) too. One voice at a time. */
object Speaker {
  private var tts: TextToSpeech? = null
  private val main = Handler(Looper.getMainLooper())

  fun speak(c: Context, text: String, language: String?, done: (String?) -> Unit) {
    val app = c.applicationContext
    var finished = false
    val finish = { problem: String? ->
      if (!finished) {
        finished = true
        main.post { done(problem) }
      }
    }
    main.post {
      var engine: TextToSpeech? = null
      engine = TextToSpeech(app) { status ->
        val e = engine
        if (status != TextToSpeech.SUCCESS || e == null) {
          finish("Speech is not available on this phone")
          return@TextToSpeech
        }
        tts?.shutdown()
        tts = e
        e.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        if (language != null) e.language = Locale.forLanguageTag(language)
        e.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {}
          override fun onDone(utteranceId: String?) = finish(null)
          @Deprecated("old API")
          override fun onError(utteranceId: String?) = finish("Speech failed")
          override fun onStop(utteranceId: String?, interrupted: Boolean) = finish(null)
        })
        val params = Bundle()
        val r = e.speak(text, TextToSpeech.QUEUE_FLUSH, params, "automate-" + System.nanoTime())
        if (r != TextToSpeech.SUCCESS) finish("Speech failed")
      }
      // Never wait for ever: a long text is at most a minute.
      main.postDelayed({ finish(null) }, 60_000)
    }
  }

  fun stop() {
    main.post {
      try {
        tts?.stop()
      } catch (e: Exception) {
        Log.w(Automate.TAG, "Could not stop speech", e)
      }
    }
  }
}
