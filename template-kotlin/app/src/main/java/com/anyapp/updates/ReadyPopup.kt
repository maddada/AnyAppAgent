package com.anyapp.updates

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

/**
 * The Reload popup (AnyAppAgent docs/FAST-LANE.md). Same file in every AnyAppAgent template: do not
 * edit it in an app.
 *
 * While the person is in this app and AnyAppAgent has a new version of it ready, a small card at
 * the bottom says "Version 7 is ready" with Later and Reload:
 * - a quick update (React Native only): Reload starts the new JavaScript in place, in about a second;
 * - a new APK: Reload hands the install to AnyAppAgent, which installs it and opens the app again.
 * It checks when an activity comes to the front and when AnyAppAgent says something is ready
 * ([ReadyReceiver]). It also tells AnyAppAgent whether the app is on screen, so AnyAppAgent does not
 * install an APK over the app while the person uses it.
 */
object ReadyPopup : Application.ActivityLifecycleCallbacks {
  private const val TAG = "AnyAppUpdate"
  private const val VIEW_TAG = "anyapp-ready-popup"

  /** Set by the React Native module: reloads the JavaScript in place. Null in a Kotlin app. */
  @Volatile var reloadInPlace: ((Activity) -> Boolean)? = null

  private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "anyapp-ready").apply { isDaemon = true } }
  private val main = Handler(Looper.getMainLooper())
  private var installed = false
  private var front: WeakReference<Activity>? = null
  @Volatile private var laterFor = 0L
  private var shownFor = 0L

  private data class Offer(val kind: String, val build: Long, val host: String?)

  /** Call once, from Application.onCreate or the first activity's onCreate. */
  fun install(app: Application) {
    synchronized(this) {
      if (installed) return
      installed = true
    }
    app.registerActivityLifecycleCallbacks(this)
  }

  override fun onActivityResumed(activity: Activity) {
    front = WeakReference(activity)
    val ctx = activity.applicationContext
    io.execute {
      runCatching { HostLink.presence(ctx, true) }
      refresh(ctx)
    }
  }

  override fun onActivityPaused(activity: Activity) {
    if (front?.get() === activity) front = null
    val ctx = activity.applicationContext
    io.execute {
      // Another activity of this app may be on screen a moment later: only report "gone" if none is.
      if (front?.get() == null) runCatching { HostLink.presence(ctx, false) }
    }
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
  override fun onActivityStarted(activity: Activity) {}
  override fun onActivityStopped(activity: Activity) {}
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
  override fun onActivityDestroyed(activity: Activity) {}

  /** Something may be ready (AnyAppAgent's broadcast, or this app came to the front). Background thread. */
  fun refresh(ctx: Context) {
    val offer = runCatching { findOffer(ctx) }.onFailure { Log.w(TAG, "ready check failed", it) }.getOrNull()
    main.post { show(offer) }
  }

  fun refreshAsync(ctx: Context, done: (() -> Unit)? = null) {
    io.execute {
      refresh(ctx)
      done?.invoke()
    }
  }

  private fun findOffer(ctx: Context): Offer? {
    val ready = HostLink.ready(ctx)
    val reload = reloadInPlace
    // A quick update AnyAppAgent holds: fetch and check it now (it is small), before offering it,
    // also when the app is not open (the next start runs it). Only builds that can run one have a
    // native fingerprint (React Native apps).
    if (ready != null && ready.kind == "ota" && Ota.runtime(ctx).isNotEmpty() && ready.build > Ota.runningBuild(ctx) && !Ota.isBad(ctx, ready.build) && Ota.stagedBuild(ctx) < ready.build) {
      try {
        val input = HostLink.openOta(ctx, ready.host) ?: throw Ota.Refused("AnyAppAgent did not hand it over")
        Ota.stage(ctx, input)
      } catch (e: Ota.Refused) {
        Ota.refuse(ctx, ready.build, e.message ?: "refused")
      } catch (e: Exception) {
        Log.w(TAG, "could not fetch quick update ${ready.build}", e)
      }
    }
    val staged = if (reload != null) Ota.stagedBuild(ctx) else 0
    if (staged > 0) return Offer("ota", staged, null)
    if (ready != null && ready.kind == "apk" && ready.build > Ota.runningBuild(ctx)) return Offer("apk", ready.build, ready.host)
    return null
  }

  // ---------------------------------------------------------------- the card

  private fun show(offer: Offer?) {
    val activity = front?.get() ?: return
    val decor = activity.window?.decorView as? ViewGroup ?: return
    val old = decor.findViewWithTag<View>(VIEW_TAG)
    if (offer == null || offer.build == laterFor) {
      if (old != null) decor.removeView(old)
      shownFor = 0
      return
    }
    if (old != null && shownFor == offer.build) return
    if (old != null) decor.removeView(old)
    shownFor = offer.build
    decor.addView(card(activity, offer))
  }

  private fun dp(ctx: Context, v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics).toInt()

  private class Palette(val surface: Int, val border: Int, val text: Int, val muted: Int, val accent: Int, val onAccent: Int)

  // AnyAppAgent's Workbench colours (shared/theme/tokens.ts): warm paper, graphite, bottle green.
  private fun palette(ctx: Context): Palette {
    val dark = (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    return if (dark) {
      Palette(Color.parseColor("#28241F"), Color.parseColor("#4B443B"), Color.parseColor("#EEE8DD"), Color.parseColor("#BDB3A5"), Color.parseColor("#6DBB8F"), Color.parseColor("#0E2117"))
    } else {
      Palette(Color.parseColor("#FDFCF8"), Color.parseColor("#DED6C8"), Color.parseColor("#1F1B16"), Color.parseColor("#575046"), Color.parseColor("#1D6A4A"), Color.parseColor("#F7F4EC"))
    }
  }

  private fun card(activity: Activity, offer: Offer): View {
    val p = palette(activity)
    val pad = dp(activity, 16f)
    val box = LinearLayout(activity).apply {
      tag = VIEW_TAG
      orientation = LinearLayout.VERTICAL
      setPadding(pad, dp(activity, 14f), pad, dp(activity, 12f))
      background = GradientDrawable().apply {
        setColor(p.surface)
        cornerRadius = dp(activity, 16f).toFloat()
        setStroke(dp(activity, 1f), p.border)
      }
      elevation = dp(activity, 6f).toFloat()
      isClickable = true // touches on the card never reach the app under it
      contentDescription = "Version ${offer.build} is ready"
    }
    box.addView(TextView(activity).apply {
      text = "Version ${offer.build} is ready"
      setTextColor(p.text)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    })
    box.addView(TextView(activity).apply {
      text = if (offer.kind == "ota") "New changes came in over the air. Reload to see them, no install needed."
      else "A new install is ready. Reload installs it and opens the app again."
      setTextColor(p.muted)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setLineSpacing(0f, 1.2f)
      setPadding(0, dp(activity, 4f), 0, dp(activity, 10f))
    })
    val row = LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END or Gravity.CENTER_VERTICAL
    }
    val later = TextView(activity).apply {
      text = "Later"
      setTextColor(p.muted)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      setPadding(dp(activity, 14f), dp(activity, 10f), dp(activity, 14f), dp(activity, 10f))
      setOnClickListener {
        laterFor = offer.build
        show(null)
      }
    }
    val reload = TextView(activity).apply {
      text = "Reload"
      setTextColor(p.onAccent)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      setPadding(dp(activity, 20f), dp(activity, 10f), dp(activity, 20f), dp(activity, 10f))
      background = GradientDrawable().apply {
        setColor(p.accent)
        cornerRadius = dp(activity, 10f).toFloat()
      }
      setOnClickListener { onReload(activity, offer, this) }
    }
    row.addView(later)
    row.addView(reload, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(activity, 8f) })
    box.addView(row)

    val margin = dp(activity, 12f)
    val lp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM)
    lp.setMargins(margin, 0, margin, margin + bottomInset(activity))
    box.layoutParams = lp
    return box
  }

  @Suppress("DEPRECATION")
  private fun bottomInset(activity: Activity): Int {
    val insets = activity.window?.decorView?.rootWindowInsets ?: return dp(activity, 24f)
    return if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime()).bottom else insets.systemWindowInsetBottom
  }

  private fun onReload(activity: Activity, offer: Offer, button: TextView) {
    button.isEnabled = false
    button.text = if (offer.kind == "ota") "Reloading…" else "Opening…"
    val ok = when (offer.kind) {
      "ota" -> reloadInPlace?.invoke(activity) ?: false
      else -> offer.host?.let { HostLink.openInstall(activity, it) } ?: false
    }
    if (ok) {
      shownFor = 0
      (activity.window?.decorView as? ViewGroup)?.findViewWithTag<View>(VIEW_TAG)?.let { (it.parent as? ViewGroup)?.removeView(it) }
    } else {
      button.isEnabled = true
      button.text = "Reload"
      Log.w(TAG, "reload of ${offer.kind} ${offer.build} did not start")
    }
  }
}

/**
 * AnyAppAgent's "something is ready for you" (action com.anyapp.updates.READY, sent only to this
 * package). A quick update is fetched and checked at once, so the next start already runs it; if the
 * app is on screen, the Reload popup appears.
 */
class ReadyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val pending = goAsync()
    val app = context.applicationContext
    ReadyPopup.refreshAsync(app) { pending.finish() }
  }
}
