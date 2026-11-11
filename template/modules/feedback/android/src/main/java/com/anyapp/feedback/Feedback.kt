// "Point at it": shake the phone, draw numbered arrows on a screenshot, write notes, Save.
// Built into every app AnyAppAgent makes; keep it. One Kotlin core in both templates
// (template-kotlin/app/src/main/java/com/anyapp/feedback and
// template/modules/feedback/android/src/main/java/com/anyapp/feedback): byte for byte the same,
// checked by builder/test/feedback-copies.test.mjs.
package com.anyapp.feedback

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.PixelCopy

/**
 * Starts by itself ([FeedbackProvider] calls [install] when the app process starts): while an
 * activity of the app is in front, the accelerometer is watched for a deliberate shake. A shake
 * takes a screenshot of that activity and opens [FeedbackActivity] over it.
 */
object Feedback {
  @Volatile private var installed = false
  private val main = Handler(Looper.getMainLooper())
  private var resumed: Activity? = null
  private var sensors: SensorManager? = null
  private var opening = false
  private val shake = ShakeDetector { onShake() }

  /** The screenshot waiting for [FeedbackActivity] (too big for an Intent extra). */
  @Volatile internal var pendingShot: Bitmap? = null
  @Volatile internal var pendingScreen: String = ""

  fun install(context: Context) {
    if (installed) return
    val app = context.applicationContext as? Application ?: return
    installed = true
    sensors = app.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityResumed(activity: Activity) {
        if (!watches(activity)) return
        resumed = activity
        startListening()
      }
      override fun onActivityPaused(activity: Activity) {
        if (resumed === activity) {
          resumed = null
          stopListening()
        }
      }
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
      override fun onActivityStarted(activity: Activity) {}
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
  }

  /** Opens the feedback screen over [activity] now, as a shake would. */
  fun open(activity: Activity) {
    if (opening || activity is FeedbackActivity || activity.isFinishing) return
    opening = true
    capture(activity) { shot ->
      opening = false
      if (shot == null || activity.isFinishing) return@capture
      pendingShot = shot
      pendingScreen = activity.javaClass.simpleName
      activity.startActivity(Intent(activity, FeedbackActivity::class.java))
      @Suppress("DEPRECATION")
      activity.overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }
  }

  // The feedback screen itself and full-screen alarms (shaken while ringing) never open it.
  private fun watches(activity: Activity) =
    activity !is FeedbackActivity && !activity.javaClass.simpleName.contains("Alarm")

  private fun startListening() {
    val sm = sensors ?: return
    val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
    shake.reset()
    sm.unregisterListener(shake)
    sm.registerListener(shake, accel, SensorManager.SENSOR_DELAY_GAME, main)
  }

  private fun stopListening() {
    sensors?.unregisterListener(shake)
  }

  private fun onShake() {
    val activity = resumed ?: return
    if (!activity.hasWindowFocus()) return // a dialog, the keyboard picker or a permission prompt is on top
    activity.window?.decorView?.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    open(activity)
  }

  private fun capture(activity: Activity, done: (Bitmap?) -> Unit) {
    val window = activity.window
    val decor = window?.decorView
    if (decor == null || decor.width <= 0 || decor.height <= 0) return done(null)
    val bitmap = try {
      Bitmap.createBitmap(decor.width, decor.height, Bitmap.Config.ARGB_8888)
    } catch (_: Throwable) {
      return done(null)
    }
    val fallback = {
      try {
        decor.draw(Canvas(bitmap))
        done(bitmap)
      } catch (_: Throwable) {
        done(null)
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        // PixelCopy reads what is really on screen (GPU layers, video, maps); drawing the view
        // tree is the fallback.
        PixelCopy.request(window, bitmap, { result ->
          if (result == PixelCopy.SUCCESS) done(bitmap) else fallback()
        }, main)
      } catch (_: Throwable) {
        fallback()
      }
    } else {
      fallback()
    }
  }
}
