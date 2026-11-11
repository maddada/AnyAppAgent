package com.anyapp.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

// The app's look in one place: colours (light and dark), type, spacing and shapes.
// Screens use these tokens instead of hard-coded values so dark mode and redesigns stay easy.
// To give an app its own character, change `accent` (and maybe `background`) in BOTH palettes.

@Immutable
data class AppColors(
  /** Screen background: a quiet, slightly warm neutral. */
  val background: Color,
  /** Cards, sheets, inputs. */
  val surface: Color,
  /** Pressed rows, chips, secondary buttons, icon wells. */
  val surfaceMuted: Color,
  /** Hairlines and outlines. */
  val border: Color,
  /** Main text. */
  val text: Color,
  /** Secondary text. */
  val textMuted: Color,
  /** Hints, captions, disabled text. */
  val textFaint: Color,
  /** The one accent colour: primary buttons, links, selected states. Use it sparingly. */
  val accent: Color,
  /** Text and icons on top of `accent`. */
  val onAccent: Color,
  /** A pale tint of the accent for selected rows and badges. */
  val accentSoft: Color,
  val success: Color,
  val warning: Color,
  val danger: Color,
)

val LightColors = AppColors(
  background = Color(0xFFF5F5F2),
  surface = Color(0xFFFFFFFF),
  surfaceMuted = Color(0xFFECECE8),
  border = Color(0xFFDFDFDA),
  text = Color(0xFF18191B),
  textMuted = Color(0xFF5E6167),
  textFaint = Color(0xFF8D9096),
  accent = Color(0xFF2C4F9E),
  onAccent = Color(0xFFFFFFFF),
  accentSoft = Color(0xFFE6EBF5),
  success = Color(0xFF1F7A4D),
  warning = Color(0xFFA86400),
  danger = Color(0xFFC2362F),
)

val DarkColors = AppColors(
  background = Color(0xFF111214),
  surface = Color(0xFF1A1B1E),
  surfaceMuted = Color(0xFF232428),
  border = Color(0xFF2D2E33),
  text = Color(0xFFECECEA),
  textMuted = Color(0xFFA2A5AB),
  textFaint = Color(0xFF6F7278),
  accent = Color(0xFF8DA8E8),
  onAccent = Color(0xFF0F1114),
  accentSoft = Color(0xFF1D2433),
  success = Color(0xFF55C08A),
  warning = Color(0xFFE0A443),
  danger = Color(0xFFEE7A72),
)

/** Spacing scale (dp). Prefer these to one-off numbers. */
object Spacing {
  val xs = 4.dp
  val sm = 8.dp
  val md = 16.dp
  val lg = 24.dp
  val xl = 32.dp
  val xxl = 48.dp
  val xxxl = 64.dp
}

object Radius {
  val sm = 6.dp
  val md = 12.dp
  val lg = 18.dp
}

/**
 * Type scale (system font: Roboto). Weights and tracking do the work: one large title per
 * screen, then headings, body and small labels.
 */
object AppType {
  val display = TextStyle(fontSize = 40.sp, lineHeight = 46.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp)
  val title = TextStyle(fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp)
  val heading = TextStyle(fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp)
  val body = TextStyle(fontSize = 16.sp, lineHeight = 24.sp)
  val bodyStrong = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
  val small = TextStyle(fontSize = 14.sp, lineHeight = 20.sp)
  /** Uppercase section labels: write the text in capitals. */
  val label = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.2.sp)
  /** Numbers that line up (times, counters): `AppType.body.merge(AppType.numeric)`. */
  val numeric = TextStyle(fontFeatureSettings = "tnum")
}

val LocalAppColors = staticCompositionLocalOf { LightColors }

/** The current palette: `val colors = AppTheme.colors`. */
object AppTheme {
  val colors: AppColors
    @Composable get() = LocalAppColors.current
}

@Composable
fun AppTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
  val c = if (dark) DarkColors else LightColors
  // Material 3 components (buttons, switches, dialogs, text fields) take their colours from here.
  val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
    primary = c.accent,
    onPrimary = c.onAccent,
    primaryContainer = c.accentSoft,
    onPrimaryContainer = c.text,
    secondary = c.accent,
    onSecondary = c.onAccent,
    secondaryContainer = c.accentSoft,
    onSecondaryContainer = c.text,
    tertiary = c.accent,
    background = c.background,
    onBackground = c.text,
    surface = c.surface,
    onSurface = c.text,
    surfaceVariant = c.surfaceMuted,
    onSurfaceVariant = c.textMuted,
    surfaceContainerLowest = c.surface,
    surfaceContainerLow = c.surface,
    surfaceContainer = c.surface,
    surfaceContainerHigh = c.surfaceMuted,
    surfaceContainerHighest = c.surfaceMuted,
    outline = c.border,
    outlineVariant = c.border,
    error = c.danger,
  )
  val type = Typography(
    displayLarge = AppType.display,
    headlineMedium = AppType.title,
    titleLarge = AppType.heading,
    titleMedium = AppType.bodyStrong,
    bodyLarge = AppType.body,
    bodyMedium = AppType.small,
    labelLarge = AppType.bodyStrong.copy(fontSize = 15.sp),
    labelSmall = AppType.label,
  )
  val shapes = Shapes(
    small = RoundedCornerShape(Radius.sm),
    medium = RoundedCornerShape(Radius.md),
    large = RoundedCornerShape(Radius.lg),
  )
  val view = LocalView.current
  if (!view.isInEditMode) {
    SideEffect {
      val window = (view.context as Activity).window
      WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !dark
      WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !dark
    }
  }
  androidx.compose.runtime.CompositionLocalProvider(LocalAppColors provides c) {
    MaterialTheme(colorScheme = scheme, typography = type, shapes = shapes, content = content)
  }
}
