// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package com.anyapp.feedback

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
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
 * The feedback screen: the screenshot, numbered arrows drawn by dragging, a notes box, and what to
 * do with the picture (one picture: the screenshot, the arrows and the notes):
 * - Send to Kiwimake (only on the phone of the person who made the app, see [KiwimakeLink]): it
 *   lands in this app's chat on their PC; the screen says so and closes.
 * - Save: copies it to the clipboard and keeps it in the gallery's "Feedback" album.
 * - Share: Android's share sheet (WhatsApp to the app's maker, for example).
 */
class FeedbackActivity : Activity() {
  private lateinit var palette: FeedbackColors
  private lateinit var fonts: FeedbackFonts
  private lateinit var shot: Bitmap
  private lateinit var canvasView: AnnotateView
  private lateinit var notes: EditText
  private lateinit var undo: LinearLayout
  private lateinit var save: TextView
  private lateinit var share: TextView
  private lateinit var send: TextView
  private lateinit var caption: TextView
  private lateinit var toast: LinearLayout
  private var saving = false
  private var canSend = false
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
    // Send to Kiwimake shows once Kiwimake says this app is one of the person's own (a quick IPC).
    thread(name = "anyapp-feedback-host") {
      val yes = KiwimakeLink.canSend(this)
      runOnUiThread { if (yes && !isFinishing) showSend() }
    }
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
    // Send to Kiwimake: the main button, shown only on the owner's phone (showSend).
    send = button("Send to Kiwimake", primary = true, description = "Send to Kiwimake: put the picture and notes in this app's chat") { onSend() }
    send.visibility = View.GONE
    bottom.addView(send, LinearLayout.LayoutParams(MATCH, px(52)).apply { topMargin = px(12) })
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    save = button("Save", primary = true, description = "Save: copy the picture and save it to the gallery") { onSave() }
    share = button("Share", primary = false, description = "Share the picture with another app") { onShare() }
    row.addView(save, LinearLayout.LayoutParams(0, px(52), 1f))
    row.addView(share, LinearLayout.LayoutParams(0, px(52), 1f).apply { marginStart = px(10) })
    bottom.addView(row, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = px(10) })
    caption = TextView(this).apply {
      text = "Save keeps it in your gallery. Share sends it to anyone."
      typeface = fonts.text
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      setTextColor(palette.textTertiary)
      gravity = Gravity.CENTER
      setPadding(0, px(8), 0, 0)
    }
    bottom.addView(caption, LinearLayout.LayoutParams(MATCH, WRAP))
    column.addView(bottom, LinearLayout.LayoutParams(MATCH, WRAP))

    // "Copied and saved" or "Sent to ...'s chat", shown for a moment; some carry an action.
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
      }, LinearLayout.LayoutParams(0, WRAP, 1f))
      addView(TextView(context).apply {
        tag = "toastAction"
        typeface = fonts.textStrong
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setTextColor(palette.accent)
        setPadding(px(16), px(6), 0, px(6))
        visibility = View.GONE
      })
    }
    root.addView(toast, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.CENTER).apply { leftMargin = px(24); rightMargin = px(24) })

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

  /** Send to Kiwimake is the main action: Save and Share become the quiet ones. */
  private fun showSend() {
    canSend = true
    send.visibility = View.VISIBLE
    style(save, primary = false)
    caption.text = "Send puts it in this app's chat in Kiwimake. Share sends it to anyone."
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

  /** Makes the one picture off the main thread, then runs [then] there with it (null: it failed). */
  private fun makePicture(pressed: TextView, busyLabel: String, then: (Bitmap?) -> Unit) {
    saving = true
    hideKeyboard()
    pressed.alpha = 0.6f
    pressed.text = busyLabel
    val arrows = canvasView.arrows.toList()
    val text = notes.text.toString()
    val unit = canvasView.exportUnit()
    val now = Date()
    thread(name = "anyapp-feedback-picture") {
      val picture = try {
        FeedbackImage.render(this, shot, arrows, text, unit, appName(), now)
      } catch (_: Throwable) {
        null
      }
      then(picture)
    }
  }

  private fun appName() = applicationInfo.loadLabel(packageManager).toString()

  private fun ready() {
    saving = false
    for ((b, label) in listOf(save to "Save", share to "Share", send to "Send to Kiwimake")) {
      b.alpha = 1f
      b.text = label
    }
  }

  private fun doSave() {
    makePicture(save, "Saving") { picture ->
      val result = try {
        if (picture == null) FeedbackImage.Result(copied = false, savedToGallery = false)
        else FeedbackImage.save(this, picture, appName(), Date()).also { picture.recycle() }
      } catch (_: Throwable) {
        FeedbackImage.Result(copied = false, savedToGallery = false)
      }
      runOnUiThread {
        val message = when {
          result.copied && result.savedToGallery -> "Saved to your gallery and copied"
          result.copied -> "Copied (could not save to the gallery)"
          result.savedToGallery -> "Saved to your gallery"
          else -> "Could not save the picture"
        }
        val ok = result.copied || result.savedToGallery
        showToast(message, ok)
        toast.postDelayed({ if (ok) leave() else { ready(); hideToast() } }, if (ok) 1800L else 2200L)
      }
    }
  }

  private fun onShare() {
    if (saving) return
    makePicture(share, "Preparing") { picture ->
      val file = try {
        picture?.let { FeedbackImage.write(this, it, appName(), Date()).also { _ -> it.recycle() } }
      } catch (_: Throwable) {
        null
      }
      runOnUiThread {
        ready()
        if (file == null) return@runOnUiThread flash("Could not make the picture")
        val uri = FeedbackProvider.uriFor(this, file)
        val text = notes.text.toString().trim()
        val intent = Intent(Intent.ACTION_SEND).apply {
          type = "image/png"
          putExtra(Intent.EXTRA_STREAM, uri)
          if (text.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, "${appName()}: $text")
          clipData = ClipData.newUri(contentResolver, "Feedback", uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
          startActivity(Intent.createChooser(intent, "Share feedback"))
        } catch (_: Exception) {
          flash("No app to share with")
        }
      }
    }
  }

  private fun onSend() {
    if (saving) return
    makePicture(send, "Sending") { picture ->
      val file = try {
        picture?.let { FeedbackImage.write(this, it, appName(), Date()) }
      } catch (_: Throwable) {
        null
      }
      val width = picture?.width ?: 0
      val height = picture?.height ?: 0
      picture?.recycle()
      runOnUiThread {
        if (file == null) {
          ready()
          return@runOnUiThread flash("Could not make the picture")
        }
        KiwimakeLink.send(this, file, width, height, notes.text.toString().trim(), Feedback.pendingScreen) { code -> sent(code) }
      }
    }
  }

  private fun sent(code: Int) {
    if (isFinishing) return
    when (code) {
      KiwimakeLink.SENT -> {
        showToast("Sent to ${appName()}'s chat", ok = true, action = "Open chat") { openKiwimake() }
        toast.postDelayed({ if (!isFinishing) leave() }, 2600L)
      }
      KiwimakeLink.WAITING -> {
        showToast("Kept in Kiwimake: it sends when Kiwimake opens", ok = true, action = "Open Kiwimake") { openKiwimake() }
        toast.postDelayed({ if (!isFinishing) leave() }, 5000L)
      }
      else -> {
        ready()
        flash(if (code == KiwimakeLink.NOT_YOURS) "Kiwimake did not take it. Try Save or Share." else "Could not reach Kiwimake. Try Save or Share.")
      }
    }
  }

  /** Kiwimake, on this app's chat (sending what waits for it when it opens). */
  private fun openKiwimake() {
    val host = KiwimakeLink.host(this) ?: return leave()
    try {
      startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse("anyappagent://?chat=" + Uri.encode(packageName))).setPackage(host).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (_: Exception) {
      packageManager.getLaunchIntentForPackage(host)?.let { startActivity(it) }
    }
    leave()
  }

  private fun showToast(message: String, ok: Boolean, action: String? = null, onAction: (() -> Unit)? = null) {
    toast.findViewWithTag<TextView>("toastText").text = message
    val act = toast.findViewWithTag<TextView>("toastAction")
    act.text = action ?: ""
    act.visibility = if (action != null) View.VISIBLE else View.GONE
    act.setOnClickListener { onAction?.invoke() }
    (toast.getChildAt(0) as ImageView).visibility = if (ok) View.VISIBLE else View.GONE
    toast.alpha = 0f
    toast.visibility = View.VISIBLE
    toast.animate().alpha(1f).setDuration(160).start()
  }

  private fun hideToast() {
    toast.animate().alpha(0f).setDuration(160).withEndAction { toast.visibility = View.GONE }.start()
  }

  /** A short note that something did not work; the screen stays as it was. */
  private fun flash(message: String) {
    showToast(message, ok = false)
    toast.postDelayed({ hideToast() }, 2600L)
  }

  // ---- drawing helpers ------------------------------------------------------------------------

  private fun px(v: Int) = (v * dp + 0.5f).toInt()

  private fun button(label: String, primary: Boolean, description: String, onClick: () -> Unit) = TextView(this).apply {
    text = label
    gravity = Gravity.CENTER
    typeface = fonts.textStrong
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    contentDescription = description
    setOnClickListener { onClick() }
    style(this, primary)
  }

  /** The main button is filled with the accent; the others are outlined. */
  private fun style(view: TextView, primary: Boolean) {
    view.setTextColor(if (primary) palette.onAccent else palette.text)
    view.background = if (primary) ripple(palette.accent, px(12).toFloat()) else ripple(Color.TRANSPARENT, px(12).toFloat(), stroke = palette.borderStrong)
  }

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
