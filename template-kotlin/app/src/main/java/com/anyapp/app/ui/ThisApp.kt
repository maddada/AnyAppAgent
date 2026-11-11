package com.anyapp.app.ui

import android.app.Activity
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.anyapp.app.ui.theme.AppTheme
import com.anyapp.app.ui.theme.AppType
import com.anyapp.app.ui.theme.Spacing
import com.anyapp.updates.ChangeThisApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * "Change this app" (AnyAppAgent docs/CHANGE-THIS-APP.md): the "This app" group every app has in its
 * settings. Built in: keep it in the app's Settings screen. The row opens AnyAppAgent at this app
 * (the person who made it lands in its chat; anyone else can suggest a change or make their own
 * version), or without AnyAppAgent an explanation drawn by the app (com.anyapp.updates.ChangeSheet).
 */
@Composable
fun ChangeThisAppRow(screen: String = "settings") {
  val context = LocalContext.current
  val colors = AppTheme.colors
  var visible by remember { mutableStateOf(false) }
  LaunchedEffect(Unit) { visible = withContext(Dispatchers.IO) { runCatching { ChangeThisApp.visible(context) }.getOrDefault(false) } }
  if (!visible) return
  Row(
    Modifier
      .fillMaxWidth()
      .heightIn(min = 56.dp)
      .clickable { (context as? Activity)?.let { ChangeThisApp.open(it, screen) } }
      .padding(vertical = Spacing.md)
      .testTag("change-this-app"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
  ) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text("Change this app", style = AppType.bodyStrong, color = colors.text)
      Text("Ask for a change in plain words", style = AppType.small, color = colors.textMuted)
    }
    Text("›", style = AppType.heading, color = colors.textFaint)
  }
}

/** The whole "This app" group: Change this app, the version, and who made it. Keep it last in Settings. */
@Composable
fun ThisAppSection(screen: String = "settings") {
  val context = LocalContext.current
  val colors = AppTheme.colors
  val version = remember { ChangeThisApp.version(context) }
  val owner = remember { ChangeThisApp.owner(context) }
  Text("THIS APP", style = AppType.label, color = colors.textFaint, modifier = Modifier.padding(top = Spacing.xl, bottom = Spacing.sm))
  HorizontalDivider(thickness = 1.dp, color = colors.border)
  ChangeThisAppRow(screen)
  HorizontalDivider(thickness = 1.dp, color = colors.border)
  Row(Modifier.fillMaxWidth().padding(vertical = Spacing.md), verticalAlignment = Alignment.CenterVertically) {
    Text("Version", style = AppType.body, color = colors.text, modifier = Modifier.weight(1f))
    Text(version, style = AppType.small.merge(AppType.numeric), color = colors.textMuted)
  }
  HorizontalDivider(thickness = 1.dp, color = colors.border)
  Row(Modifier.fillMaxWidth().padding(vertical = Spacing.md), verticalAlignment = Alignment.CenterVertically) {
    Text(if (owner.isEmpty()) "Made" else "Made by $owner", style = AppType.body, color = colors.text, modifier = Modifier.weight(1f))
    Text("with AnyAppAgent", style = AppType.small, color = colors.textMuted)
  }
  HorizontalDivider(thickness = 1.dp, color = colors.border)
}

/** The starter Settings screen: the app's own settings go above "This app". */
@Composable
fun SettingsScreen() {
  Screen {
    Text("Settings", style = AppType.title, color = AppTheme.colors.text, modifier = Modifier.padding(bottom = Spacing.sm))
    ThisAppSection()
  }
}
