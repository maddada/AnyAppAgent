package com.anyapp.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.anyapp.app.R
import com.anyapp.app.ui.theme.AppTheme
import com.anyapp.app.ui.theme.AppType
import com.anyapp.app.ui.theme.Radius
import com.anyapp.app.ui.theme.Spacing

private data class Step(val title: String, val text: String)

private val steps = listOf(
  Step("Describe it", "Tell Kiwimake what this app should do, in your own words."),
  Step("It gets built", "Your PC makes the new version while you wait."),
  Step("It updates here", "The new version installs over this one. Nothing to set up."),
)

/** The starter screen. Replace it with the app's real first screen. */
@Composable
fun HomeScreen(onOpenSettings: () -> Unit = {}) {
  val colors = AppTheme.colors
  val context = LocalContext.current
  val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "1.0"

  Screen {
    Image(
      painter = painterResource(R.mipmap.ic_launcher_foreground),
      contentDescription = null,
      modifier = Modifier
        .padding(top = Spacing.xl, bottom = Spacing.xl)
        .size(56.dp)
        .clip(RoundedCornerShape(Radius.md))
        .border(1.dp, colors.border, RoundedCornerShape(Radius.md)),
    )
    Text(stringResource(R.string.app_name), style = AppType.display, color = colors.text, modifier = Modifier.padding(bottom = Spacing.sm))
    Text("Ready for its first idea.", style = AppType.body, color = colors.textMuted)

    Text(
      "WHAT HAPPENS NEXT",
      style = AppType.label,
      color = colors.textFaint,
      modifier = Modifier.padding(top = Spacing.xxl + Spacing.md, bottom = Spacing.sm),
    )
    HorizontalDivider(thickness = 1.dp, color = colors.border)
    steps.forEachIndexed { i, s ->
      if (i > 0) HorizontalDivider(thickness = 1.dp, color = colors.border)
      Row(Modifier.padding(vertical = Spacing.md + 2.dp), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text("${i + 1}", style = AppType.bodyStrong.merge(AppType.numeric), color = colors.accent, modifier = Modifier.width(20.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text(s.title, style = AppType.bodyStrong, color = colors.text)
          Text(s.text, style = AppType.small, color = colors.textMuted)
        }
      }
    }
    HorizontalDivider(thickness = 1.dp, color = colors.border)

    Spacer(Modifier.height(Spacing.xxl))
    QuietButton("Settings", onClick = onOpenSettings, modifier = Modifier.testTag("open-settings"))
    Text("Version $version", style = AppType.small.merge(AppType.numeric), color = colors.textFaint)
  }
}
