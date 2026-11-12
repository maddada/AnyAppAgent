// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package com.anyapp.feedback

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable

/**
 * Kiwimake's Workbench look (shared/theme/tokens.ts): warm paper, graphite ink, bottle green,
 * Bricolage Grotesque and IBM Plex Mono. The feedback screen is Kiwimake's own tool inside the
 * app, so it keeps this look whatever the app's own colours are.
 */
internal class FeedbackColors(
  val bg: Int,
  val surface: Int,
  val sunken: Int,
  val overlay: Int,
  val text: Int,
  val textSecondary: Int,
  val textTertiary: Int,
  val border: Int,
  val borderStrong: Int,
  val accent: Int,
  val accentPressed: Int,
  val onAccent: Int,
  val isDark: Boolean,
) {
  companion object {
    val light = FeedbackColors(
      bg = c("#F3EFE7"), surface = c("#FBF9F4"), sunken = c("#E9E3D7"), overlay = c("#FDFCF8"),
      text = c("#1F1B16"), textSecondary = c("#575046"), textTertiary = c("#696155"),
      border = c("#DED6C8"), borderStrong = c("#C2B7A5"),
      accent = c("#1D6A4A"), accentPressed = c("#165A3D"), onAccent = c("#F7F4EC"), isDark = false,
    )
    val dark = FeedbackColors(
      bg = c("#181613"), surface = c("#211E1A"), sunken = c("#2C2824"), overlay = c("#28241F"),
      text = c("#EEE8DD"), textSecondary = c("#BDB3A5"), textTertiary = c("#9B9184"),
      border = c("#332F29"), borderStrong = c("#4B443B"),
      accent = c("#6DBB8F"), accentPressed = c("#5DA87E"), onAccent = c("#0E2117"), isDark = true,
    )

    fun of(context: Context): FeedbackColors {
      val night = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
      return if (night == Configuration.UI_MODE_NIGHT_YES) dark else light
    }

    private fun c(hex: String) = Color.parseColor(hex)
  }
}

/** The marks drawn on the screenshot: one signal colour with a paper halo, readable on any screen. */
internal object Marks {
  val color = Color.parseColor("#D9481C")
  val halo = Color.parseColor("#FBF9F4")
  val label = Color.parseColor("#FFFAF3")
}

internal class FeedbackFonts(context: Context) {
  private fun load(context: Context, name: String, fallback: Typeface) = try {
    Typeface.createFromAsset(context.assets, "${FeedbackProvider.DIR}/$name.ttf")
  } catch (_: Throwable) {
    fallback
  }

  val display = load(context, "BricolageGrotesque-Display-ExtraBold", Typeface.DEFAULT_BOLD)
  val text = load(context, "BricolageGrotesque-Text-Regular", Typeface.DEFAULT)
  val textStrong = load(context, "BricolageGrotesque-Text-SemiBold", Typeface.DEFAULT_BOLD)
  val mono = load(context, "IBMPlexMono-Medium", Typeface.MONOSPACE)

  companion object {
    @Volatile private var cached: FeedbackFonts? = null
    fun of(context: Context): FeedbackFonts =
      cached ?: FeedbackFonts(context.applicationContext).also { cached = it }
  }
}

/** Lucide icons (stroke 1.75 on a 24 grid), drawn as paths so no resources are needed. */
internal class LucideIcon(private val kind: Kind, private var color: Int) : Drawable() {
  enum class Kind { X, UNDO, CHECK }

  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }

  fun setColor(value: Int) {
    color = value
    invalidateSelf()
  }

  override fun draw(canvas: Canvas) {
    val b = bounds
    val s = b.width() / 24f
    paint.color = color
    paint.strokeWidth = 1.75f * s
    val p = Path()
    fun m(x: Float, y: Float) = p.moveTo(b.left + x * s, b.top + y * s)
    fun l(x: Float, y: Float) = p.lineTo(b.left + x * s, b.top + y * s)
    when (kind) {
      Kind.X -> { m(18f, 6f); l(6f, 18f); m(6f, 6f); l(18f, 18f) }
      Kind.CHECK -> { m(20f, 6f); l(9f, 17f); l(4f, 12f) }
      Kind.UNDO -> {
        // lucide "undo-2": M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11
        m(9f, 14f); l(4f, 9f); l(9f, 4f)
        m(4f, 9f); l(14.5f, 9f)
        p.arcTo(RectF(b.left + 9f * s, b.top + 9f * s, b.left + 20f * s, b.top + 20f * s), -90f, 180f, false)
        l(11f, 20f)
      }
    }
    canvas.drawPath(p, paint)
  }

  override fun setAlpha(alpha: Int) { paint.alpha = alpha }
  override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter }
  @Deprecated("Deprecated in Java")
  override fun getOpacity() = PixelFormat.TRANSLUCENT
}
