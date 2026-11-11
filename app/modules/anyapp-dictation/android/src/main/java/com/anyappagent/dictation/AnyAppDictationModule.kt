package com.anyappagent.dictation

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/**
 * Dictation into the phone app's prompt boxes with Android's own speech recognition
 * (android.speech.SpeechRecognizer). No library, no cloud service of ours, no key.
 *
 * - On Android 12+ the on-device recognizer is used when the phone has one; when it cannot do the
 *   phone's language (no language pack yet) it falls back to the phone's normal recognizer, asked
 *   to stay offline (EXTRA_PREFER_OFFLINE). Only when that has no language pack either is the
 *   phone's recognizer used as it normally works (which may use the phone maker's online service).
 * - The language is the phone's (Locale.getDefault()), so an Arabic phone dictates Arabic.
 * - One listening session at a time. Everything happens on the main thread, as SpeechRecognizer
 *   requires. Every callback carries the session number, so a late callback from an old
 *   session never reaches the new one.
 *
 * One event, "onDictation", with `type`:
 *   start   listening began (`onDevice`: the on-device recognizer; `offline`: offline was asked for)
 *   level   the voice level, 0..1, about 15 times a second
 *   partial the words heard so far in this session (`text`), replacing the previous partial
 *   final   the finished words (`text`, may be "")
 *   error   `code` (see codeOf) and `message` (Android's code name, for the log)
 *   end     the session is over (always last)
 */
class AnyAppDictationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var session = 0
  private var heardAnything = false
  private var lastLevelAt = 0L

  override fun definition() = ModuleDefinition {
    Name("AnyAppDictation")

    Events("onDictation")

    /** Whether this phone can dictate at all, and whether it can on the phone itself. */
    Function("availability") {
      val ctx = context
      mapOf(
        "available" to SpeechRecognizer.isRecognitionAvailable(ctx),
        "onDevice" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)),
        "language" to Locale.getDefault().toLanguageTag(),
      )
    }

    /** Starts listening. `language` overrides the phone's language (a BCP 47 tag), else null. */
    Function("start") { language: String? ->
      val ctx = context
      main.post { begin(ctx, language) }
      true
    }

    /** Stops listening; the words heard so far arrive as "final". */
    Function("stop") {
      main.post {
        val r = recognizer
        if (r != null) r.stopListening() else endSession() // between two rungs of the ladder
      }
      true
    }

    /** Drops the session: no "final", just "end". */
    Function("cancel") {
      main.post { endSession() }
      true
    }

    OnDestroy { main.post { release() } }
  }

  private fun begin(ctx: Context, language: String?) {
    release()
    val id = ++session
    heardAnything = false
    if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
      emit(id, "error", "code" to "unavailable", "message" to "no recognition service")
      emit(id, "end")
      return
    }
    val onDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)
    listen(ctx, id, language, onDevice)
  }

  /**
   * The ladder: the on-device recognizer (Android 12+, when the phone has one), then the phone's
   * recognizer asked to stay offline, then (only when the offline attempt has no language pack
   * for the phone's language) the phone's recognizer as it normally works.
   */
  private fun listen(ctx: Context, id: Int, language: String?, onDevice: Boolean, preferOffline: Boolean = true) {
    val r = try {
      if (onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx)
      else SpeechRecognizer.createSpeechRecognizer(ctx)
    } catch (e: Exception) {
      if (onDevice) return listen(ctx, id, language, false, preferOffline)
      emit(id, "error", "code" to "unavailable", "message" to (e.message ?: "createSpeechRecognizer failed"))
      emit(id, "end")
      return
    }
    recognizer = r
    val tag = language ?: Locale.getDefault().toLanguageTag()
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      if (preferOffline) putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
      // A thinking pause should not end it; recognizers may treat these as hints.
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000)
    }
    r.setRecognitionListener(object : RecognitionListener {
      private fun live() = id == session && recognizer === r

      override fun onReadyForSpeech(params: Bundle?) {
        if (live()) emit(id, "start", "onDevice" to onDevice, "offline" to preferOffline, "language" to tag)
      }

      override fun onBeginningOfSpeech() {}

      override fun onRmsChanged(rmsdB: Float) {
        if (!live()) return
        val now = SystemClock.uptimeMillis()
        if (now - lastLevelAt < 66) return
        lastLevelAt = now
        // Android reports roughly -2 dB (quiet) to 10 dB (loud).
        emit(id, "level", "level" to ((rmsdB + 2f) / 12f).coerceIn(0f, 1f).toDouble())
      }

      override fun onBufferReceived(buffer: ByteArray?) {}

      override fun onEndOfSpeech() {}

      override fun onPartialResults(partialResults: Bundle?) {
        if (!live()) return
        val text = firstOf(partialResults)
        if (text.isNotBlank()) heardAnything = true
        emit(id, "partial", "text" to text)
      }

      override fun onResults(results: Bundle?) {
        if (!live()) return
        val text = firstOf(results)
        release()
        emit(id, "final", "text" to text)
        emit(id, "end")
      }

      override fun onError(error: Int) {
        if (!live()) return
        val code = codeOf(error)
        // The on-device recognizer cannot do this language (yet), or failed before a word:
        // try the phone's normal recognizer, still asked to stay offline.
        if (onDevice && !heardAnything && code in setOf("language", "client", "server", "busy")) {
          retry { listen(ctx, id, language, false, preferOffline) }
          return
        }
        // Offline was asked for but the phone has no language pack for it yet (seen on the
        // emulator: Google's offline engine, error 13): once more, without asking for offline.
        if (!onDevice && preferOffline && !heardAnything && code == "language") {
          retry { listen(ctx, id, language, false, false) }
          return
        }
        // Still no language pack: ask the phone to fetch it (Android 13+), for the next try.
        if (code == "language" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          val asked = try {
            r.triggerModelDownload(intent)
            true
          } catch (_: Exception) {
            false
          }
          recognizer = null
          main.postDelayed({ drop(r) }, 3000) // let the download request reach the service first
          emit(id, "error", "code" to if (asked) "downloading" else code, "message" to nameOf(error))
          emit(id, "end")
          return
        }
        release()
        emit(id, "error", "code" to code, "message" to nameOf(error))
        emit(id, "end")
      }

      override fun onEvent(eventType: Int, params: Bundle?) {}
    })
    try {
      r.startListening(intent)
    } catch (e: Exception) {
      release()
      emit(id, "error", "code" to "client", "message" to (e.message ?: "startListening failed"))
      emit(id, "end")
    }
  }

  /** Ends the session now (also one waiting for its next rung, which then never starts). */
  private fun endSession() {
    release()
    emit(session, "end")
    session++
  }

  /**
   * The next rung of the ladder, a moment after this recognizer is gone: the system keeps one
   * connection to the speech service, and an old recognizer's late teardown cancelled a new one
   * started straight away (seen on the emulator).
   */
  private fun retry(next: () -> Unit) {
    release()
    val id = session
    main.postDelayed({ if (id == session && recognizer == null) next() }, 400)
  }

  private fun release() {
    val r = recognizer ?: return
    recognizer = null
    drop(r)
  }

  private fun drop(r: SpeechRecognizer) {
    try {
      r.cancel()
    } catch (_: Exception) {}
    try {
      r.destroy()
    } catch (_: Exception) {}
  }

  private fun emit(id: Int, type: String, vararg extra: Pair<String, Any?>) {
    if (id != session) return
    sendEvent("onDictation", mapOf("type" to type, "session" to id, *extra))
  }

  private fun firstOf(b: Bundle?): String = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim() ?: ""

  /** Android's error codes, folded into what the app says about them. */
  private fun codeOf(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "silence"
    SpeechRecognizer.ERROR_AUDIO -> "audio"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language"
    SpeechRecognizer.ERROR_CLIENT -> "client"
    else -> "server" // ERROR_SERVER, ERROR_SERVER_DISCONNECTED, ERROR_TOO_MANY_REQUESTS, ERROR_CANNOT_*
  }

  private fun nameOf(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "ERROR_NETWORK_TIMEOUT"
    SpeechRecognizer.ERROR_NETWORK -> "ERROR_NETWORK"
    SpeechRecognizer.ERROR_AUDIO -> "ERROR_AUDIO"
    SpeechRecognizer.ERROR_SERVER -> "ERROR_SERVER"
    SpeechRecognizer.ERROR_CLIENT -> "ERROR_CLIENT"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ERROR_SPEECH_TIMEOUT"
    SpeechRecognizer.ERROR_NO_MATCH -> "ERROR_NO_MATCH"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "ERROR_RECOGNIZER_BUSY"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "ERROR_INSUFFICIENT_PERMISSIONS"
    SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "ERROR_TOO_MANY_REQUESTS"
    SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "ERROR_SERVER_DISCONNECTED"
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "ERROR_LANGUAGE_NOT_SUPPORTED"
    SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "ERROR_LANGUAGE_UNAVAILABLE"
    else -> "ERROR_$error"
  }
}
