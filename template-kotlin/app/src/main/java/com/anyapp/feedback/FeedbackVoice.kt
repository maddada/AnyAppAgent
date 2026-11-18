// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package com.anyapp.feedback

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.EditText
import java.util.Locale

/**
 * Speaking the notes on the feedback screen, with Android's own speech recognition (no library, no
 * service of ours). Tap the mic, the words appear in the notes as they are heard, tap again (or
 * stop talking) to stop. The words go in where the caret was; what was already written, and every
 * earlier stretch of speech, stays (the same rules as Kiwimake's own dictation:
 * shared/chat/dictation.ts in Kiwimake).
 */
internal class FeedbackVoice(
  private val activity: Activity,
  private val notes: EditText,
  private val onState: (State) -> Unit,
) {
  enum class State { IDLE, STARTING, LISTENING }

  /** A plain sentence when something went wrong (shown for a moment by the screen). */
  var onProblem: (String) -> Unit = {}

  /**
   * The words go at the notes' caret only once the person put it there (tapped into the notes);
   * otherwise at the end, after the last "#n " a new arrow added.
   */
  var useCaret = false

  private var recognizer: SpeechRecognizer? = null
  private var text: VoiceText? = null
  private var heard = false
  var state = State.IDLE
    private set

  /** Whether this phone can recognise speech at all (the mic is hidden when it cannot). */
  val available: Boolean
    get() = try {
      SpeechRecognizer.isRecognitionAvailable(activity)
    } catch (_: Exception) {
      false
    }

  fun toggle() {
    when (state) {
      State.IDLE -> start()
      else -> recognizer?.stopListening() ?: finish()
    }
  }

  fun start() {
    if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), PERMISSION_REQUEST)
      return
    }
    listen(onDevice = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(activity))
  }

  /** The screen's onRequestPermissionsResult for [PERMISSION_REQUEST]. */
  fun onPermission(granted: Boolean) {
    if (granted) start() else onProblem("Allow the microphone to speak your notes.")
  }

  fun cancel() {
    release()
    finish()
  }

  private fun listen(onDevice: Boolean) {
    release()
    val r = try {
      if (onDevice && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(activity) else SpeechRecognizer.createSpeechRecognizer(activity)
    } catch (_: Exception) {
      if (onDevice) return listen(false)
      onProblem("This phone has no speech recognition.")
      return finish()
    }
    recognizer = r
    if (text == null) {
      val value = notes.text.toString()
      text = if (useCaret) VoiceText(value, notes.selectionStart, notes.selectionEnd) else VoiceText(value, value.length, value.length)
      heard = false
    }
    setState(State.STARTING)
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
      // A thinking pause should not end it; recognizers may treat these as hints.
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000)
    }
    r.setRecognitionListener(object : RecognitionListener {
      private fun live() = recognizer === r

      override fun onReadyForSpeech(params: Bundle?) {
        if (live()) setState(State.LISTENING)
      }

      override fun onPartialResults(partialResults: Bundle?) {
        if (!live()) return
        val said = firstOf(partialResults)
        if (said.isNotBlank()) heard = true
        put(said, final = false)
      }

      override fun onResults(results: Bundle?) {
        if (!live()) return
        val said = firstOf(results)
        if (said.isNotBlank()) heard = true
        put(said, final = true)
        if (!heard) onProblem("No speech heard.")
        release()
        finish()
      }

      override fun onError(error: Int) {
        if (!live()) return
        // The on-device recognizer cannot do this language (yet): the phone's normal one.
        if (onDevice && !heard && error in setOf(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, SpeechRecognizer.ERROR_CLIENT, SpeechRecognizer.ERROR_SERVER)) {
          release()
          notes.postDelayed({ if (text != null && recognizer == null) listen(false) }, 400)
          return
        }
        val silent = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
        // Words already in the notes stay; "nothing heard" after words is just the end.
        if (!(heard && silent)) onProblem(problemOf(error))
        release()
        finish()
      }

      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(rmsdB: Float) {}
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() {}
      override fun onEvent(eventType: Int, params: Bundle?) {}
    })
    try {
      r.startListening(intent)
    } catch (_: Exception) {
      release()
      onProblem("Speaking stopped. Try again.")
      finish()
    }
  }

  /** Merges a result into the notes as they are now (a change made while listening stays). */
  private fun put(said: String, final: Boolean) {
    val t = text ?: return
    t.sync(notes.text.toString())
    val (value, caret) = if (final) t.final(said) else t.partial(said)
    if (value != notes.text.toString()) {
      notes.setText(value)
      notes.setSelection(caret.coerceIn(0, value.length))
    }
  }

  private fun finish() {
    text = null
    setState(State.IDLE)
  }

  private fun setState(next: State) {
    if (state == next) return
    state = next
    onState(next)
  }

  private fun release() {
    val r = recognizer ?: return
    recognizer = null
    try {
      r.cancel()
    } catch (_: Exception) {}
    try {
      r.destroy()
    } catch (_: Exception) {}
  }

  private fun firstOf(b: Bundle?): String = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim() ?: ""

  private fun problemOf(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Allow the microphone to speak your notes."
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech heard."
    SpeechRecognizer.ERROR_AUDIO -> "The microphone could not be opened. Try again."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The microphone is busy. Try again."
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "The phone's speech service could not be reached. Try again."
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "This phone cannot recognise speech in its language yet."
    else -> "Speaking stopped. Try again."
  }

  companion object {
    const val PERMISSION_REQUEST = 42
  }
}

/**
 * One stretch of speaking into the notes: where the words go and how running results merge
 * (the Kotlin twin of DictationText in Kiwimake's shared/chat/dictation.ts; keep them alike).
 */
internal class VoiceText(value: String, selectionStart: Int, selectionEnd: Int) {
  private var before: String
  private var after: String
  private var kept = ""
  private var live = ""
  private var skip = ""
  private var written = value
  private var done = false

  init {
    val s = if (selectionStart in 0..value.length) selectionStart else value.length
    val e = if (selectionEnd in s..value.length) selectionEnd else s
    before = value.substring(0, s)
    after = value.substring(e)
  }

  fun sync(current: String) {
    if (current == written) return
    val end = if (after.isNotEmpty() && current.endsWith(after)) current.length - after.length else current.length
    if (end == current.length) after = ""
    before = current.substring(0, end)
    skip = joinWords(skip, live)
    kept = ""
    live = ""
    written = current
  }

  fun partial(text: String): Pair<String, Int> {
    if (done) return write()
    val t = unskip(text.trim())
    if (live.isNotEmpty() && isNewStretch(live, t)) {
      kept = joinWords(kept, live)
      live = ""
    }
    live = t
    return write()
  }

  fun final(text: String): Pair<String, Int> {
    if (done) return write()
    val t = unskip(text.trim())
    if (t.isNotEmpty()) {
      if (kept.isNotEmpty() && holdsAll(t, kept)) kept = ""
      live = t
    }
    kept = joinWords(kept, live)
    live = ""
    done = true
    return write()
  }

  private fun unskip(text: String): String {
    if (skip.isEmpty()) return text
    val s = words(skip)
    val t = words(text)
    if (s.isNotEmpty() && t.size >= s.size && s.indices.all { t[it] == s[it] }) {
      var rest = text
      repeat(s.size) { rest = rest.replaceFirst(Regex("^\\s*\\S+"), "") }
      return rest.trim()
    }
    skip = ""
    return text
  }

  private fun write(): Pair<String, Int> {
    val spoken = joinWords(kept, live)
    if (spoken.isEmpty()) {
      written = before + after
      return written to before.length
    }
    val lead = if (before.isNotEmpty() && !before.last().isWhitespace() && !".,!?;:)".contains(spoken.first())) " " else ""
    val trail = if (after.isNotEmpty() && !after.first().isWhitespace() && !".,!?;:)".contains(after.first())) " " else ""
    written = before + lead + spoken + trail + after
    return written to before.length + lead.length + spoken.length
  }

  companion object {
    fun words(s: String): List<String> =
      s.lowercase().replace(Regex("[.,!?;:\"()\\[\\]{}…،؟]"), " ").split(Regex("\\s+")).filter { it.isNotEmpty() }

    fun joinWords(a: String, b: String): String = when {
      b.isEmpty() -> a
      a.isEmpty() -> b
      a.last().isWhitespace() || b.first().isWhitespace() || ".,!?;:)".contains(b.first()) -> a + b
      else -> "$a $b"
    }

    /** A new stretch of speech rather than a better guess at the last one (see DictationText). */
    fun isNewStretch(prev: String, next: String): Boolean {
      val p = words(prev)
      val n = words(next)
      if (p.isEmpty() || n.isEmpty() || n.size >= p.size || p[0] == n[0]) return false
      val seen = p.toSet()
      val shared = n.count { it in seen }
      return shared.toDouble() / n.size < 0.5 || n.size * 2 <= p.size
    }

    private fun holdsAll(text: String, heard: String): Boolean {
      val t = words(text)
      val h = words(heard)
      if (h.isEmpty()) return true
      if (t.size < h.size) return false
      return (0 until minOf(3, h.size)).all { t[it] == h[it] }
    }
  }
}
