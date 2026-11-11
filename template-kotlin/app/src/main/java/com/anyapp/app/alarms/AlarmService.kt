package com.anyapp.app.alarms

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.core.app.ServiceCompat
import java.util.Locale

/**
 * A short-lived foreground service that plays an alarm's sound and speaks its text, then stops.
 * Started by AlarmReceiver, so it works while the app is closed.
 *
 * Audio focus on Android 15+: an app may only take audio focus while it is the top app or runs a
 * foreground service that was started while it was visible ("while-in-use"). A service started by
 * an alarm in the background is not, whatever its type, so the request is refused. The alarm's
 * full-screen intent shows AlarmActivity when the phone is locked or the screen is off; once it is
 * on screen the app is the top app and [onAlarmScreenShown] takes focus. While the user is using
 * the phone the alarm shows as a heads-up instead, and plays without lowering other audio.
 */
class AlarmService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val queue = ArrayDeque<AlarmData>()
  private var playing = false
  private var tts: TextToSpeech? = null
  private var ttsReady: Boolean? = null // null while the engine is starting
  private var ttsStartedAt = 0L
  private var afterTtsInit: (() -> Unit)? = null
  private var player: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var focusRequest: AudioFocusRequest? = null
  private var focusGranted = false
  private var foregroundId = 0
  private var foregroundNotification: Notification? = null
  private val timeout = Runnable {
    Log.w(TAG, "Alarm playback took too long; stopping")
    finish()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val alarm = AlarmData.fromJsonString(intent?.getStringExtra(EXTRA_ALARM))
    if (foregroundNotification == null) {
      val first = alarm ?: AlarmData("playback", System.currentTimeMillis(), "Alarm", null, null, null, null, null, false)
      foregroundId = first.notificationId
      foregroundNotification = AlarmNotifications.build(this, first, quiet = true)
    }
    // Same id and notification every time: keeps the first alarm's notification as the
    // foreground one instead of replacing (and removing) it.
    ServiceCompat.startForeground(
      this,
      foregroundId,
      foregroundNotification!!,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
    )
    if (alarm == null) {
      if (!playing && queue.isEmpty()) finish()
      return START_NOT_STICKY
    }
    acquireWakeLock()
    // Start the speech engine right away, in parallel with the sound, so speech is not late.
    if (!alarm.speak.isNullOrBlank()) startTts()
    handler.removeCallbacks(timeout)
    handler.postDelayed(timeout, MAX_PLAYBACK_MS)
    queue.addLast(alarm)
    if (!playing) playNext()
    return START_NOT_STICKY
  }

  private fun playNext() {
    val alarm = queue.removeFirstOrNull()
    if (alarm == null) {
      finish()
      return
    }
    playing = true
    requestFocus()
    playSound(alarm) { speak(alarm) { playNext() } }
  }

  private fun attributes(contentType: Int): AudioAttributes =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(contentType)
      .build()

  private fun playSound(alarm: AlarmData, then: () -> Unit) {
    val name = alarm.sound
    if (name.isNullOrBlank()) return then()
    val resId = resources.getIdentifier(name, "raw", packageName)
    if (resId == 0) {
      Log.w(TAG, "Sound '$name' not found: put $name.mp3 in app/src/main/res/raw/")
      return then()
    }
    val done = once(then)
    try {
      val mp = MediaPlayer()
      mp.setAudioAttributes(attributes(AudioAttributes.CONTENT_TYPE_SONIFICATION))
      resources.openRawResourceFd(resId).use { afd ->
        mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
      }
      mp.setOnCompletionListener {
        Log.i(TAG, "Finished sound '$name' for alarm ${alarm.id}")
        releasePlayer(); done()
      }
      mp.setOnErrorListener { _, what, extra ->
        Log.w(TAG, "Sound '$name' failed ($what/$extra)")
        releasePlayer(); done(); true
      }
      mp.prepare()
      mp.start()
      player = mp
      Log.i(TAG, "Playing sound '$name' for alarm ${alarm.id}")
    } catch (e: Exception) {
      Log.e(TAG, "Could not play sound '$name'", e)
      releasePlayer()
      done()
    }
  }

  private fun startTts() {
    if (tts != null) return
    ttsReady = null
    ttsStartedAt = SystemClock.elapsedRealtime()
    tts = TextToSpeech(applicationContext) { status ->
      handler.post {
        ttsReady = status == TextToSpeech.SUCCESS
        Log.i(TAG, "Speech engine ready=${ttsReady} in ${SystemClock.elapsedRealtime() - ttsStartedAt} ms")
        afterTtsInit?.let { afterTtsInit = null; it() }
      }
    }
  }

  private fun speak(alarm: AlarmData, then: () -> Unit) {
    val text = alarm.speak
    if (text.isNullOrBlank()) return then()
    val done = once(then)
    val start = start@{
      val engine = tts
      if (ttsReady != true || engine == null) {
        Log.w(TAG, "Text to speech is not available on this device")
        done()
        return@start
      }
      alarm.language?.let { lang ->
        val result = engine.setLanguage(Locale.forLanguageTag(lang))
        if (result < TextToSpeech.LANG_AVAILABLE) Log.w(TAG, "Language '$lang' not available for speech ($result)")
      }
      engine.setAudioAttributes(attributes(AudioAttributes.CONTENT_TYPE_SPEECH))
      val utteranceId = "anyapp-${alarm.id}-${System.nanoTime()}"
      engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) {
          if (id == utteranceId) Log.i(TAG, "Speech audio started for alarm ${alarm.id}")
        }
        override fun onDone(id: String?) {
          if (id == utteranceId) handler.post { Log.i(TAG, "Finished speaking alarm ${alarm.id}"); done() }
        }
        @Deprecated("Deprecated in Java")
        override fun onError(id: String?) {
          if (id == utteranceId) handler.post { Log.w(TAG, "Speech failed for alarm ${alarm.id}"); done() }
        }
        override fun onError(id: String?, errorCode: Int) {
          if (id == utteranceId) handler.post { Log.w(TAG, "Speech failed for alarm ${alarm.id} ($errorCode)"); done() }
        }
      })
      val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f) }
      Log.i(TAG, "Speaking alarm ${alarm.id}: $text")
      if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId) != TextToSpeech.SUCCESS) {
        Log.w(TAG, "Speech could not start for alarm ${alarm.id}")
        done()
      }
    }
    startTts()
    if (ttsReady == null) afterTtsInit = start else start()
  }

  private fun once(f: () -> Unit): () -> Unit {
    var called = false
    return { if (!called) { called = true; f() } }
  }

  /** Asks to lower other audio while the alarm plays. See the class comment for Android 15+. */
  private fun requestFocus() {
    if (focusGranted || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      .setAudioAttributes(attributes(AudioAttributes.CONTENT_TYPE_SPEECH))
      .build()
    focusRequest = req
    focusGranted = am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    Log.i(
      TAG,
      if (focusGranted) "Audio focus granted"
      else "Audio focus not granted yet (app in background); it is taken when the alarm screen shows"
    )
  }

  private fun acquireWakeLock() {
    if (wakeLock != null) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "anyapp:alarm").apply {
      setReferenceCounted(false)
      acquire(MAX_PLAYBACK_MS + 5_000)
    }
  }

  private fun releasePlayer() {
    player?.let { runCatching { it.release() } }
    player = null
  }

  private fun finish() {
    handler.removeCallbacks(timeout)
    queue.clear()
    playing = false
    releasePlayer()
    tts?.let { runCatching { it.stop(); it.shutdown() } }
    tts = null
    ttsReady = null
    afterTtsInit = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { (getSystemService(Context.AUDIO_SERVICE) as AudioManager).abandonAudioFocusRequest(it) }
    }
    focusRequest = null
    focusGranted = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    AlarmActivity.closeIfShown()
    // Keep the alarm's notification on screen after the service stops.
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
    stopSelf()
  }

  override fun onDestroy() {
    if (playing || tts != null || player != null) finish()
    if (instance === this) instance = null
    super.onDestroy()
  }

  companion object {
    const val TAG = AlarmScheduler.TAG
    private const val EXTRA_ALARM = "alarm"
    private const val MAX_PLAYBACK_MS = 3 * 60_000L

    @Volatile private var instance: AlarmService? = null

    fun intent(c: Context, alarm: AlarmData): Intent =
      Intent(c, AlarmService::class.java).putExtra(EXTRA_ALARM, alarm.toJson().toString())

    /** Called by AlarmActivity when it is on screen: the app is now allowed to take audio focus. */
    fun onAlarmScreenShown() {
      val s = instance ?: return
      s.handler.post { if (s.playing) s.requestFocus() }
    }

    /** The alarm screen's Stop button. */
    fun stopPlayback() {
      val s = instance ?: return
      s.handler.post { Log.i(TAG, "Alarm stopped by the user"); s.finish() }
    }
  }
}
