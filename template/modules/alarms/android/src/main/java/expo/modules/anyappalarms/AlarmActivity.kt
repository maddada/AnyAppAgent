package expo.modules.anyappalarms

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/**
 * The full-screen alarm shown over the lock screen (via the notification's full-screen intent)
 * while an alarm plays. Being on screen makes the app the top app, which on Android 15+ is what
 * allows it to take audio focus (lower other audio) for an alarm that fired in the background.
 */
class AlarmActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    render(intent)
    current = WeakReference(this)
    Log.i(AlarmScheduler.TAG, "Alarm screen shown")
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    render(intent)
  }

  override fun onResume() {
    super.onResume()
    // Now the app is the top app: playback can take audio focus.
    AlarmService.onAlarmScreenShown()
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

  private fun render(intent: Intent) {
    val dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val bg = if (dark) Color.parseColor("#111214") else Color.parseColor("#F5F5F2")
    val fg = if (dark) Color.parseColor("#ECECEA") else Color.parseColor("#18191B")
    val muted = if (dark) Color.parseColor("#A2A5AB") else Color.parseColor("#5E6167")

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_VERTICAL
      setBackgroundColor(bg)
      setPadding(dp(32), dp(48), dp(32), dp(48))
    }
    root.addView(TextView(this).apply {
      text = intent.getStringExtra(EXTRA_TITLE) ?: ""
      setTextColor(fg)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    intent.getStringExtra(EXTRA_BODY)?.let { body ->
      root.addView(TextView(this).apply {
        text = body
        setTextColor(muted)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        setPadding(0, dp(12), 0, 0)
      }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }
    root.addView(Button(this).apply {
      text = "Stop"
      isAllCaps = false
      setTextColor(bg)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
      background = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(fg)
      }
      setOnClickListener {
        AlarmService.stopPlayback()
        finish()
      }
    }, LinearLayout.LayoutParams(MATCH_PARENT, dp(56)).apply { topMargin = dp(48) })
    setContentView(root)
  }

  companion object {
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    @Volatile private var current: WeakReference<AlarmActivity>? = null

    fun closeIfShown() {
      current?.get()?.let { a -> a.runOnUiThread { a.finish() } }
    }

    fun pendingIntent(c: Context, alarm: AlarmData): PendingIntent {
      val intent = Intent(c, AlarmActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
        .putExtra(EXTRA_TITLE, alarm.title)
        .putExtra(EXTRA_BODY, alarm.body ?: alarm.speak)
      return PendingIntent.getActivity(
        c, alarm.notificationId, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
  }
}
