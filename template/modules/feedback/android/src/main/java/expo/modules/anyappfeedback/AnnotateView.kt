// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package expo.modules.anyappfeedback

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** One arrow, in fractions of the screenshot (0..1), so it scales to any size. Head at (x2, y2). */
internal data class Arrow(val x1: Float, val y1: Float, val x2: Float, val y2: Float)

/**
 * Draws a numbered arrow: the head points at the thing, the "#n" label sits at the tail where
 * the drag started, so it never hides what is pointed at. [u] is the size of one dp-like unit in
 * pixels; the screen and the saved image use the same drawing at their own scale.
 */
internal class ArrowPainter(private val mono: Typeface) {
  private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = mono
    textAlign = Paint.Align.CENTER
  }

  fun draw(canvas: Canvas, x1: Float, y1: Float, x2: Float, y2: Float, number: Int, u: Float, bounds: RectF) {
    val label = "#$number"
    text.textSize = 13f * u
    val pillH = 24f * u
    val pillW = max(pillH, text.measureText(label) + 16f * u)
    val cx = (x1).coerceIn(bounds.left + pillW / 2, bounds.right - pillW / 2)
    val cy = (y1).coerceIn(bounds.top + pillH / 2, bounds.bottom - pillH / 2)
    val pill = RectF(cx - pillW / 2, cy - pillH / 2, cx + pillW / 2, cy + pillH / 2)

    val angle = atan2(y2 - y1, x2 - x1)
    val length = hypot(x2 - x1, y2 - y1)
    val headLen = min(15f * u, length * 0.6f)
    val headHalf = headLen * 0.5f
    val baseX = x2 - cos(angle) * headLen * 0.8f
    val baseY = y2 - sin(angle) * headLen * 0.8f
    val head = Path().apply {
      moveTo(x2, y2)
      lineTo(x2 - cos(angle) * headLen + sin(angle) * headHalf, y2 - sin(angle) * headLen - cos(angle) * headHalf)
      lineTo(baseX, baseY)
      lineTo(x2 - cos(angle) * headLen - sin(angle) * headHalf, y2 - sin(angle) * headLen + cos(angle) * headHalf)
      close()
    }

    // Halo first, so the arrow reads on light and dark screens alike.
    line.color = Marks.halo
    line.alpha = 235
    line.strokeWidth = 7f * u
    canvas.drawLine(cx, cy, baseX, baseY, line)
    canvas.drawPath(head, line)
    line.alpha = 255
    line.color = Marks.color
    line.strokeWidth = 3.5f * u
    canvas.drawLine(cx, cy, baseX, baseY, line)
    line.strokeWidth = 1.5f * u
    canvas.drawPath(head, line)
    fill.color = Marks.color
    canvas.drawPath(head, fill)

    val r = pillH / 2
    fill.color = Marks.halo
    canvas.drawRoundRect(RectF(pill.left - 2f * u, pill.top - 2f * u, pill.right + 2f * u, pill.bottom + 2f * u), r + 2f * u, r + 2f * u, fill)
    fill.color = Marks.color
    canvas.drawRoundRect(pill, r, r, fill)
    text.color = Marks.label
    val baseline = pill.centerY() - (text.descent() + text.ascent()) / 2
    canvas.drawText(label, pill.centerX(), baseline, text)
  }
}

@SuppressLint("ViewConstructor")
internal class AnnotateView(
  context: Context,
  private val shot: Bitmap,
  private val colors: FeedbackColors,
  fonts: FeedbackFonts,
  private val onChange: () -> Unit,
  private val onTouchStart: () -> Unit,
) : View(context) {
  val arrows = mutableListOf<Arrow>()
  private val density = resources.displayMetrics.density
  private val painter = ArrowPainter(fonts.mono)
  private val image = RectF()
  private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val hintBg = Paint(Paint.ANTI_ALIAS_FLAG)
  private val hintText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = fonts.textStrong
    textAlign = Paint.Align.CENTER
  }
  private val clip = Path()
  private var downX = 0f
  private var downY = 0f
  private var curX = 0f
  private var curY = 0f
  private var dragging = false

  init {
    contentDescription = "Screenshot. Drag to draw a numbered arrow."
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    val padX = 16f * density
    val padY = 8f * density
    val availW = w - 2 * padX
    val availH = h - 2 * padY
    val scale = min(availW / shot.width, availH / shot.height)
    val iw = shot.width * scale
    val ih = shot.height * scale
    image.set((w - iw) / 2, (h - ih) / 2, (w + iw) / 2, (h + ih) / 2)
    clip.reset()
    val r = 14f * density
    clip.addRoundRect(image, r, r, Path.Direction.CW)
  }

  override fun onDraw(canvas: Canvas) {
    if (image.isEmpty) return
    canvas.save()
    canvas.clipPath(clip)
    canvas.drawBitmap(shot, null, image, bitmapPaint)
    canvas.restore()
    frame.color = colors.borderStrong
    frame.strokeWidth = density
    val r = 14f * density
    canvas.drawRoundRect(image, r, r, frame)

    val u = density
    arrows.forEachIndexed { i, a ->
      painter.draw(canvas, px(a.x1), py(a.y1), px(a.x2), py(a.y2), i + 1, u, image)
    }
    if (dragging && hypot(curX - downX, curY - downY) > 4 * density) {
      painter.draw(canvas, downX, downY, curX, curY, arrows.size + 1, u, image)
    }
    if (arrows.isEmpty() && !dragging) drawHint(canvas)
  }

  private fun drawHint(canvas: Canvas) {
    val label = "Drag to point at something"
    hintText.textSize = 14f * density
    hintText.color = colors.onAccent
    val w = hintText.measureText(label) + 32f * density
    val h = 40f * density
    val cx = image.centerX()
    val top = image.top + 16f * density
    val rect = RectF(cx - w / 2, top, cx + w / 2, top + h)
    hintBg.color = colors.accent
    hintBg.alpha = 240
    canvas.drawRoundRect(rect, h / 2, h / 2, hintBg)
    canvas.drawText(label, cx, rect.centerY() - (hintText.descent() + hintText.ascent()) / 2, hintText)
  }

  private fun px(f: Float) = image.left + f * image.width()
  private fun py(f: Float) = image.top + f * image.height()
  private fun clampX(x: Float) = x.coerceIn(image.left, image.right)
  private fun clampY(y: Float) = y.coerceIn(image.top, image.bottom)

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        onTouchStart()
        downX = clampX(event.x); downY = clampY(event.y)
        curX = downX; curY = downY
        dragging = true
        parent?.requestDisallowInterceptTouchEvent(true)
        invalidate()
      }
      MotionEvent.ACTION_MOVE -> {
        if (!dragging) return false
        curX = clampX(event.x); curY = clampY(event.y)
        invalidate()
      }
      MotionEvent.ACTION_UP -> {
        if (!dragging) return false
        dragging = false
        curX = clampX(event.x); curY = clampY(event.y)
        if (hypot(curX - downX, curY - downY) >= 28f * density) {
          arrows += Arrow(
            (downX - image.left) / image.width(), (downY - image.top) / image.height(),
            (curX - image.left) / image.width(), (curY - image.top) / image.height(),
          )
          performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
          onChange()
        }
        invalidate()
      }
      MotionEvent.ACTION_CANCEL -> {
        dragging = false
        invalidate()
      }
    }
    return true
  }

  fun undo() {
    if (arrows.isEmpty()) return
    arrows.removeAt(arrows.size - 1)
    invalidate()
    onChange()
  }

  /** Pixels of the screenshot per unit, so the saved image matches what was on screen. */
  fun exportUnit(): Float = if (image.width() > 0) density * shot.width / image.width() else shot.width / 360f
}
