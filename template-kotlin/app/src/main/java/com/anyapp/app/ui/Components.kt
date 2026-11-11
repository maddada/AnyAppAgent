package com.anyapp.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.anyapp.app.ui.theme.AppTheme
import com.anyapp.app.ui.theme.AppType
import com.anyapp.app.ui.theme.Radius
import com.anyapp.app.ui.theme.Spacing

/**
 * Every screen goes in a Screen: background, clear of the status bar, the gesture bar and the
 * keyboard (the app is edge to edge), side padding, and scrolling when [scroll] is true.
 */
@Composable
fun Screen(
  modifier: Modifier = Modifier,
  scroll: Boolean = true,
  content: @Composable ColumnScope.() -> Unit,
) {
  val colors = AppTheme.colors
  Column(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.background)
      .safeDrawingPadding()
      .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier)
      .padding(horizontal = Spacing.lg, vertical = Spacing.md)
      .then(modifier),
    content = content,
  )
}

/** A quiet surface with a hairline border for grouping content. */
@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  val colors = AppTheme.colors
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(Radius.md),
    color = colors.surface,
    border = BorderStroke(1.dp, colors.border),
  ) {
    Column(Modifier.padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm), content = content)
  }
}

/** The one main action of a screen: big, full width, accent coloured. */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
  val colors = AppTheme.colors
  androidx.compose.material3.Button(
    onClick = onClick,
    enabled = enabled,
    modifier = modifier.fillMaxWidth().heightIn(min = 52.dp),
    shape = RoundedCornerShape(Radius.md),
    colors = ButtonDefaults.buttonColors(containerColor = colors.accent, contentColor = colors.onAccent),
    contentPadding = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.md),
  ) { Text(text, style = AppType.bodyStrong) }
}

/** A secondary action: outlined, quiet. */
@Composable
fun QuietButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
  val colors = AppTheme.colors
  OutlinedButton(
    onClick = onClick,
    enabled = enabled,
    modifier = modifier.fillMaxWidth().heightIn(min = 52.dp),
    shape = RoundedCornerShape(Radius.md),
    border = BorderStroke(1.dp, colors.border),
    colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.text),
  ) { Text(text, style = AppType.bodyStrong) }
}
