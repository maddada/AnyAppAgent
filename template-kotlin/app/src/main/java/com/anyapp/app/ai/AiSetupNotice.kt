package com.anyapp.app.ai

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.anyapp.app.ui.Card
import com.anyapp.app.ui.QuietButton
import com.anyapp.app.ui.theme.AppTheme
import com.anyapp.app.ui.theme.AppType
import com.anyapp.app.ui.theme.Spacing
import kotlinx.coroutines.launch

/**
 * Whether AI can be used, refreshed whenever the app comes back to the front (for example after
 * the person added a key in Kiwimake). null while it is being checked.
 *
 *   val aiStatus by rememberAiStatus()
 *   AiSetupNotice(aiStatus)
 */
@Composable
fun rememberAiStatus(): State<AiStatus?> {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val status = remember { mutableStateOf<AiStatus?>(null) }
  LifecycleResumeEffect(Unit) {
    val job = scope.launch { status.value = Ai.status(context) }
    onPauseOrDispose { job.cancel() }
  }
  return status
}

/**
 * Shown where an AI feature would be when AI cannot be used yet (no key in Kiwimake, or AI
 * switched off for this app). Its button opens Kiwimake's settings. Shows nothing when AI is
 * ready or the status is still loading. After an AiError with `needsSetup`, pass `code = e.code`.
 */
@Composable
fun AiSetupNotice(status: AiStatus?, modifier: Modifier = Modifier, code: String? = null) {
  val reason = code ?: status?.takeIf { !it.ready }?.reason ?: return
  val context = LocalContext.current
  val colors = AppTheme.colors
  val canOpen = reason != "no_anyappagent" && reason != "not_allowed"
  val title = when (reason) {
    "app_off" -> "AI is off for this app"
    "not_set_up" -> "AI is not set up yet"
    else -> "AI is not available"
  }
  Card(modifier) {
    Text(title, style = AppType.bodyStrong, color = colors.text)
    Text(aiProblemText(reason), style = AppType.small, color = colors.textMuted, modifier = Modifier.padding(bottom = Spacing.xs))
    if (canOpen) QuietButton("Open Kiwimake", onClick = { Ai.openSetup(context) })
  }
}
