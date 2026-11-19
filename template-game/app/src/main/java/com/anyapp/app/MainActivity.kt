package com.anyapp.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.anyapp.app.game.AndroidGameHost
import com.anyapp.app.ui.PrimaryButton
import com.anyapp.app.ui.SettingsScreen
import com.anyapp.app.ui.theme.AppTheme
import com.anyapp.app.ui.theme.Spacing
import com.anyapp.game.Game
import com.anyapp.game.GameInfo
import com.anyapp.game.GameOrientation
import com.anyapp.game.kit.GameEvents

/**
 * The Android app around the game: it shows the game full screen (game/, the part that later goes
 * to iPhone and the web) and hands it the phone abilities (AndroidGameHost). Settings opens over
 * the game, so the game keeps its place.
 */
class MainActivity : ComponentActivity() {
  private val events = GameEvents()
  private var settingsOpen by mutableStateOf(false)
  private lateinit var host: AndroidGameHost

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    com.anyapp.updates.AppUpdater.onAppStart(this) // updates for people the app is shared with: keep
    com.anyapp.updates.ReadyPopup.install(application) // the "Version N is ready, Reload" popup: keep
    requestedOrientation = when (GameInfo.orientation) {
      GameOrientation.Landscape -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      GameOrientation.Portrait -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
      GameOrientation.Any -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
    enableEdgeToEdge()
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.systemBars())
    }
    host = AndroidGameHost(this) { settingsOpen = true }
    setContent { AppTheme { App(host, events, settingsOpen, onCloseSettings = { settingsOpen = false }) } }
  }

  override fun onResume() {
    super.onResume()
    events.hidden = false
  }

  override fun onPause() {
    events.hidden = true
    super.onPause()
  }

  override fun onDestroy() {
    host.release()
    super.onDestroy()
  }
}

@Composable
fun App(host: AndroidGameHost, events: GameEvents, settingsOpen: Boolean, onCloseSettings: () -> Unit) {
  BackHandler(enabled = settingsOpen) { onCloseSettings() }
  BackHandler(enabled = !settingsOpen && events.wantsBack) { events.back() }
  Box(Modifier.fillMaxSize()) {
    Game(host, events)
    // Every app keeps a Settings screen with the "This app" group (Change this app): see ANDROID.md.
    if (settingsOpen) {
      Box(Modifier.fillMaxSize().background(AppTheme.colors.background)) {
        SettingsScreen()
        // The game is full screen, so the way back is a button too (the back gesture also works).
        PrimaryButton(
          "Back to the game",
          onClick = onCloseSettings,
          modifier = Modifier.align(Alignment.BottomEnd).safeDrawingPadding().padding(Spacing.lg),
        )
      }
    }
  }
}
