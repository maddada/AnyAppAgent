package com.anyapp.updates

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * "Change this app" when AnyAppAgent is not on this phone (AnyAppAgent docs/CHANGE-THIS-APP.md).
 * Same file in every AnyAppAgent template: do not edit it in an app.
 *
 * A bottom sheet drawn by the app itself, so it works offline: what AnyAppAgent is, honestly what an
 * own version needs (a Windows PC and a Claude plan), Get AnyAppAgent (its latest release on
 * GitHub), and Suggest a change to the owner (a short text through Android's share menu).
 */
class ChangeSheet : Activity() {
  private class Palette(
    val bg: Int, val surface: Int, val border: Int, val strong: Int, val text: Int, val muted: Int, val faint: Int,
    val accent: Int, val onAccent: Int,
  )

  private lateinit var p: Palette
  private var suggesting = false
  private var nameField: EditText? = null
  private var textField: EditText? = null

  private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

  private fun isDark() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  // AnyAppAgent's Workbench colours (shared/theme/tokens.ts): warm paper, graphite, bottle green.
  private fun palette(): Palette = if (isDark()) {
    Palette(c("#181613"), c("#211E1A"), c("#332F29"), c("#4B443B"), c("#EEE8DD"), c("#BDB3A5"), c("#9B9184"), c("#6DBB8F"), c("#0E2117"))
  } else {
    Palette(c("#FDFCF8"), c("#FBF9F4"), c("#DED6C8"), c("#C2B7A5"), c("#1F1B16"), c("#575046"), c("#696155"), c("#1D6A4A"), c("#F7F4EC"))
  }

  private fun c(hex: String) = Color.parseColor(hex)

  private fun font(name: String, fallback: Int): Typeface =
    runCatching { Typeface.createFromAsset(assets, "anyapp-feedback/$name.ttf") }.getOrElse { Typeface.create(Typeface.DEFAULT, fallback) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    suggesting = savedInstanceState?.getBoolean("suggesting") ?: false
    draw()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putBoolean("suggesting", suggesting)
  }

  private fun draw() {
    p = palette()
    val keepName = nameField?.text?.toString()
    val keepText = textField?.text?.toString()
    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.argb(115, 0, 0, 0))
      setOnClickListener { finish() }
    }
    val sheet = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      isClickable = true
      background = GradientDrawable().apply {
        setColor(p.bg)
        val r = dp(20f).toFloat()
        cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
        setStroke(dp(1f), p.border)
      }
      setPadding(dp(20f), dp(10f), dp(20f), dp(16f))
    }
    sheet.addView(View(this).apply {
      background = GradientDrawable().apply { setColor(p.strong); cornerRadius = dp(4f).toFloat() }
    }, LinearLayout.LayoutParams(dp(36f), dp(4f)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(14f) })

    val app = ChangeThisApp.appName(this)
    val owner = ChangeThisApp.owner(this)
    val ownerName = owner.ifEmpty { "whoever made it" }
    val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    body.addView(text("Change this app", 22f, p.text, font("BricolageGrotesque-Display-ExtraBold", Typeface.BOLD)))
    if (!suggesting) {
      body.addView(text(
        "$app was made with AnyAppAgent. You describe a change in plain words (\"bigger text\", \"add a reminder\") and an AI agent rebuilds the app for you.",
        15f, p.muted, font("BricolageGrotesque-Text-Regular", Typeface.NORMAL), top = 8f,
      ))
      body.addView(text("To make your own version you need:", 15f, p.text, font("BricolageGrotesque-Text-SemiBold", Typeface.BOLD), top = 16f))
      for (need in listOf("This phone", "A Windows PC that stays on while it works", "A Claude account (Pro or higher)", "About 20 minutes to set up")) {
        body.addView(bullet(need))
      }
      body.addView(text(
        "No PC? A way to change apps without one, using cloud credits, is planned. Until then you can suggest a change to $ownerName.",
        13f, p.faint, font("BricolageGrotesque-Text-Regular", Typeface.NORMAL), top = 14f,
      ))
      body.addView(button("Get AnyAppAgent", primary = true, top = 18f) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(ChangeThisApp.GET_ANYAPPAGENT_URL))) }
      })
      body.addView(button(if (owner.isEmpty()) "Suggest a change" else "Suggest a change to $owner", primary = false, top = 8f) {
        suggesting = true
        draw()
      })
      body.addView(button("Not now", primary = false, quiet = true, top = 4f) { finish() })
    } else {
      body.addView(text(
        "Say what you would like changed. It goes to $ownerName as a message (WhatsApp, SMS or email), and they decide.",
        15f, p.muted, font("BricolageGrotesque-Text-Regular", Typeface.NORMAL), top = 8f,
      ))
      val prefs = getSharedPreferences("anyapp_change", Context.MODE_PRIVATE)
      nameField = field("Your name (so they know who it is from)", keepName ?: prefs.getString("name", "") ?: "", lines = 1, top = 16f)
      textField = field("What should change?", keepText ?: "", lines = 4, top = 10f)
      body.addView(nameField)
      body.addView(textField)
      body.addView(button("Send suggestion", primary = true, top = 16f) {
        val words = textField?.text?.toString()?.trim().orEmpty()
        if (words.isEmpty()) {
          textField?.error = "Write what should change first"
          return@button
        }
        val name = nameField?.text?.toString()?.trim().orEmpty()
        prefs.edit().putString("name", name).apply()
        ChangeThisApp.shareSuggestion(this, name, words)
        finish()
      })
      body.addView(button("Back", primary = false, quiet = true, top = 4f) {
        suggesting = false
        draw()
      })
    }
    sheet.addView(ScrollView(this).apply { addView(body) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    root.addView(sheet, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    // Clear of the gesture bar and the keyboard.
    root.setOnApplyWindowInsetsListener { _, insets ->
      val bottom = if (Build.VERSION.SDK_INT >= 30) {
        insets.getInsets(WindowInsets.Type.navigationBars() or WindowInsets.Type.ime()).bottom
      } else {
        @Suppress("DEPRECATION") insets.systemWindowInsetBottom
      }
      sheet.setPadding(dp(20f), dp(10f), dp(20f), dp(16f) + bottom)
      insets
    }
    setContentView(root)
    if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    draw()
  }

  private fun text(s: String, size: Float, color: Int, face: Typeface, top: Float = 0f) = TextView(this).apply {
    text = s
    setTextColor(color)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    typeface = face
    setLineSpacing(0f, 1.2f)
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
  }

  private fun bullet(s: String) = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8f) }
    addView(View(this@ChangeSheet).apply {
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(p.accent) }
    }, LinearLayout.LayoutParams(dp(6f), dp(6f)).apply { marginEnd = dp(10f) })
    addView(text(s, 15f, p.text, font("BricolageGrotesque-Text-Regular", Typeface.NORMAL)))
  }

  private fun field(hint: String, value: String, lines: Int, top: Float) = EditText(this).apply {
    this.hint = hint
    setText(value)
    setTextColor(p.text)
    setHintTextColor(p.faint)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
    typeface = font("BricolageGrotesque-Text-Regular", Typeface.NORMAL)
    minLines = lines
    gravity = Gravity.TOP or Gravity.START
    inputType = if (lines > 1) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
    else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
    setPadding(dp(14f), dp(12f), dp(14f), dp(12f))
    background = GradientDrawable().apply { setColor(p.surface); cornerRadius = dp(12f).toFloat(); setStroke(dp(1f), p.border) }
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
  }

  private fun button(label: String, primary: Boolean, quiet: Boolean = false, top: Float, onClick: () -> Unit) = TextView(this).apply {
    text = label
    gravity = Gravity.CENTER
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    typeface = font("BricolageGrotesque-Text-SemiBold", Typeface.BOLD)
    setTextColor(if (primary) p.onAccent else if (quiet) p.muted else p.text)
    minHeight = dp(48f)
    setPadding(dp(16f), dp(12f), dp(16f), dp(12f))
    if (!quiet) background = GradientDrawable().apply {
      setColor(if (primary) p.accent else p.bg)
      cornerRadius = dp(12f).toFloat()
      setStroke(dp(1f), if (primary) p.accent else p.strong)
    }
    isClickable = true
    isFocusable = true
    setOnClickListener { onClick() }
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
  }
}
