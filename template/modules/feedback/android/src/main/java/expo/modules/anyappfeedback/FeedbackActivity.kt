// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package expo.modules.anyappfeedback

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import java.util.Date
import kotlin.concurrent.thread

/**
 * The feedback screen: the screenshot, numbered arrows drawn by dragging, a notes box, Save.
 * Save makes one picture, copies it to the clipboard and saves it in the gallery's "Feedback"
 * album, says "Copied and saved" and closes. Nothing else on purpose.
 */
class FeedbackActivity : Activity() {
  private lateinit var palette: FeedbackColors
  private lateinit var fonts: FeedbackFonts
  private lateinit var shot: Bitmap
  private lateinit var canvasView: AnnotateView
  private lateinit var notes: EditText
  private lateinit var undo: LinearLayout
  private lateinit var save: TextView
  private lateinit var toast: LinearLayout
  private var saving = false
  private val dp get() = resources.displayMetrics.density

  override fun onCreate(savedInstanceState: Bundle?) {
    palette = FeedbackColors.of(this)
    setTheme(if (palette.isDark) android.R.style.Theme_Material_NoActionBar else android.R.style.Theme_Material_Light_NoActionBar)
    super.onCreate(savedInstanceState)
    val pending = Feedback.pendingShot
    if (pending == null) { // the process was restarted while this screen was open: nothing to show
      finish()
      return
    }
    shot = pending
    fonts = FeedbackFonts.of(this)
    setContentView(build())
    edgeToEdge() // after setContentView: the window's insets controller needs the decor view
    if (Build.VERSION.SDK_INT >= 33) {
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { close() }
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    if (isFinishing) Feedback.pendingShot = null
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() = close()

  // ---- layout ---------------------------------------------------------------------------------

  private fun build(): View {
    val root = FrameLayout(this).apply { setBackgroundColor(palette.bg) }
    val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    root.addView(column, FrameLayout.LayoutParams(MATCH, MATCH))

    // Top bar: close, title, undo.
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(px(6), px(4), px(12), px(4))
    }
    val closeBtn = ImageView(this).apply {
      setImageDrawable(LucideIcon(LucideIcon.Kind.X, palette.text))
      setPadding(px(12), px(12), px(12), px(12))
      background = ripple(Color.TRANSPARENT, px(24).toFloat())
      contentDescription = "Close"
      setOnClickListener { close() }
    }
    bar.addView(closeBtn, LinearLayout.LayoutParams(px(48), px(48)))
    val title = TextView(this).apply {
      text = "Feedback"
      typeface = fonts.display
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      letterSpacing = -0.02f
      setTextColor(palette.text)
      setPadding(px(6), 0, 0, 0)
    }
    bar.addView(title, LinearLayout.LayoutParams(0, WRAP, 1f))
    undo = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      setPadding(px(14), 0, px(16), 0)
      background = ripple(Color.TRANSPARENT, px(12).toFloat(), stroke = palette.borderStrong)
      contentDescription = "Undo the last arrow"
      setOnClickListener { canvasView.undo() }
      addView(ImageView(context).apply { setImageDrawable(LucideIcon(LucideIcon.Kind.UNDO, palette.text)) }, LinearLayout.LayoutParams(px(18), px(18)))
      addView(TextView(context).apply {
        text = "Undo"
        typeface = fonts.textStrong
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTextColor(palette.text)
        setPadding(px(8), 0, 0, 0)
      })
    }
    bar.addView(undo, LinearLayout.LayoutParams(WRAP, px(44)))
    column.addView(bar, LinearLayout.LayoutParams(MATCH, WRAP))

    // The screenshot with the arrows.
    canvasView = AnnotateView(this, shot, palette, fonts, onChange = { onArrowsChanged() }, onTouchStart = { hideKeyboard() })
    column.addView(canvasView, LinearLayout.LayoutParams(MATCH, 0, 1f))

    // Notes and Save.
    val bottom = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(px(16), px(10), px(16), px(12))
    }
    notes = EditText(this).apply {
      hint = "What should change? Write #1, #2 for the arrows."
      typeface = fonts.text
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      setTextColor(palette.text)
      setHintTextColor(palette.textTertiary)
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      minLines = 3
      maxLines = 5
      gravity = Gravity.TOP or Gravity.START
      setLineSpacing(px(3).toFloat(), 1f)
      setPadding(px(14), px(12), px(14), px(12))
      background = rounded(palette.surface, px(14).toFloat(), palette.border)
      backgroundTintList = null
      highlightColor = (palette.accent and 0x00FFFFFF) or 0x40000000
      if (Build.VERSION.SDK_INT >= 29) {
        textCursorDrawable = GradientDrawable().apply { setColor(palette.accent); setSize(px(2), px(20)) }
      }
      contentDescription = "Notes"
    }
    bottom.addView(notes, LinearLayout.LayoutParams(MATCH, WRAP))
    save = TextView(this).apply {
      text = "Save"
      gravity = Gravity.CENTER
      typeface = fonts.textStrong
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      setTextColor(palette.onAccent)
      background = ripple(palette.accent, px(12).toFloat())
      contentDescription = "Save: copy the picture and save it to the gallery"
      setOnClickListener { onSave() }
    }
    bottom.addView(save, LinearLayout.LayoutParams(MATCH, px(52)).apply { topMargin = px(12) })
    val caption = TextView(this).apply {
      text = "Copies the picture and keeps it in your gallery"
      typeface = fonts.text
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      setTextColor(palette.textTertiary)
      gravity = Gravity.CENTER
      setPadding(0, px(8), 0, 0)
    }
    bottom.addView(caption, LinearLayout.LayoutParams(MATCH, WRAP))
    column.addView(bottom, LinearLayout.LayoutParams(MATCH, WRAP))

    // "Copied and saved", shown for a moment after Save.
    toast = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(px(16), px(12), px(20), px(12))
      background = rounded(palette.overlay, px(14).toFloat(), palette.border)
      elevation = px(6).toFloat()
      visibility = View.GONE
      addView(ImageView(context).apply { setImageDrawable(LucideIcon(LucideIcon.Kind.CHECK, palette.accent)) }, LinearLayout.LayoutParams(px(20), px(20)))
      addView(TextView(context).apply {
        id = View.generateViewId()
        tag = "toastText"
        typeface = fonts.textStrong
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setTextColor(palette.text)
        setPadding(px(10), 0, 0, 0)
      })
    }
    root.addView(toast, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER))

    onArrowsChanged()
    applyInsets(root)
    return root
  }

  private fun applyInsets(root: View) {
    root.setOnApplyWindowInsetsListener { v, insets ->
      if (Build.VERSION.SDK_INT >= 30) {
        val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
        val ime = insets.getInsets(WindowInsets.Type.ime())
        v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      } else {
        @Suppress("DEPRECATION")
        v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
      }
      insets
    }
  }

  @Suppress("DEPRECATION")
  private fun edgeToEdge() {
    val w = window
    w.statusBarColor = Color.TRANSPARENT
    w.navigationBarColor = Color.TRANSPARENT
    w.setBackgroundDrawable(ColorDrawable(palette.bg))
    if (Build.VERSION.SDK_INT >= 30) {
      w.setDecorFitsSystemWindows(false)
      val light = if (palette.isDark) 0 else WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
      w.insetsController?.setSystemBarsAppearance(light, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS)
    } else {
      var flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
      if (!palette.isDark) {
        flags = flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        if (Build.VERSION.SDK_INT >= 26) flags = flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
      }
      w.decorView.systemUiVisibility = flags
    }
  }

  // ---- behaviour ------------------------------------------------------------------------------

  /** A new arrow adds its "#n " line to the notes; undo takes it away again if still empty. */
  private var arrowCount = 0

  private fun onArrowsChanged() {
    val count = canvasView.arrows.size
    if (count > arrowCount) {
      val tag = "#$count"
      val current = notes.text.toString()
      if (!Regex("(^|\\s)${Regex.escape(tag)}(\\s|$)").containsMatchIn(current)) {
        val prefix = if (current.isEmpty() || current.endsWith("\n")) "" else "\n"
        notes.append("$prefix$tag ")
      }
    } else if (count < arrowCount) {
      val removed = "#${arrowCount}"
      val lines = notes.text.toString().split("\n")
      val kept = lines.filterNot { it.trim() == removed }
      if (kept.size != lines.size) notes.setText(kept.joinToString("\n"))
    }
    arrowCount = count
    val can = count > 0
    undo.isEnabled = can
    undo.alpha = if (can) 1f else 0.4f
  }

  private fun hasContent() = canvasView.arrows.isNotEmpty() || notes.text.toString().replace(Regex("#\\d+"), "").isNotBlank()

  private fun close() {
    if (saving) return
    if (!hasContent()) return leave()
    val theme = if (palette.isDark) android.R.style.Theme_DeviceDefault_Dialog_Alert else android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
    AlertDialog.Builder(this, theme)
      .setTitle("Discard this feedback?")
      .setMessage("The arrows and notes will be lost.")
      .setPositiveButton("Discard") { _, _ -> leave() }
      .setNegativeButton("Keep", null)
      .show()
  }

  private fun leave() {
    hideKeyboard()
    finish()
    @Suppress("DEPRECATION")
    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
  }

  private fun hideKeyboard() {
    if (!notes.hasFocus()) return
    (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(notes.windowToken, 0)
    notes.clearFocus()
  }

  private fun onSave() {
    if (saving) return
    if (FeedbackImage.galleryNeedsPermission(this)) { // Android 9 and older only
      requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 41)
      return
    }
    doSave()
  }

  @Deprecated("Deprecated in Java")
  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    @Suppress("DEPRECATION")
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == 41) doSave()
  }

  private fun doSave() {
    saving = true
    hideKeyboard()
    save.alpha = 0.6f
    save.text = "Saving"
    val arrows = canvasView.arrows.toList()
    val text = notes.text.toString()
    val unit = canvasView.exportUnit()
    val appName = applicationInfo.loadLabel(packageManager).toString()
    val now = Date()
    thread(name = "anyapp-feedback-save") {
      val result = try {
        val picture = FeedbackImage.render(this, shot, arrows, text, unit, appName, now)
        FeedbackImage.save(this, picture, appName, now).also { picture.recycle() }
      } catch (_: Throwable) {
        FeedbackImage.Result(copied = false, savedToGallery = false)
      }
      runOnUiThread { done(result) }
    }
  }

  private fun done(result: FeedbackImage.Result) {
    val message = when {
      result.copied && result.savedToGallery -> "Copied and saved"
      result.copied -> "Copied (could not save to the gallery)"
      result.savedToGallery -> "Saved to the gallery"
      else -> "Could not save the picture"
    }
    toast.findViewWithTag<TextView>("toastText").text = message
    toast.alpha = 0f
    toast.visibility = View.VISIBLE
    toast.animate().alpha(1f).setDuration(160).start()
    val ok = result.copied || result.savedToGallery
    toast.postDelayed({
      if (ok) {
        saving = false
        leave()
      } else {
        saving = false
        save.alpha = 1f
        save.text = "Save"
        toast.animate().alpha(0f).setDuration(160).withEndAction { toast.visibility = View.GONE }.start()
      }
    }, if (ok) 1300L else 2200L)
  }

  // ---- drawing helpers ------------------------------------------------------------------------

  private fun px(v: Int) = (v * dp + 0.5f).toInt()

  private fun rounded(fill: Int, radius: Float, stroke: Int? = null) = GradientDrawable().apply {
    setColor(fill)
    cornerRadius = radius
    if (stroke != null) setStroke(px(1), stroke)
  }

  private fun ripple(fill: Int, radius: Float, stroke: Int? = null): RippleDrawable {
    val pressed = if (palette.isDark) 0x33FFFFFF else 0x1F1F1B16
    val content = rounded(fill, radius, stroke)
    val mask = rounded(Color.WHITE, radius)
    return RippleDrawable(ColorStateList.valueOf(pressed), content, mask)
  }

  private companion object {
    const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
  }
}
