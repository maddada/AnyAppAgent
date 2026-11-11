package com.anyapp.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.anyapp.app.ui.HomeScreen
import com.anyapp.app.ui.theme.AppTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    com.anyapp.updates.AppUpdater.onAppStart(this) // updates for people the app is shared with: keep
    com.anyapp.updates.ReadyPopup.install(application) // the "Version N is ready, Reload" popup: keep
    enableEdgeToEdge()
    setContent { AppTheme { App() } }
  }
}

/** The app's screens: add one entry per screen, and a branch for it in [App]. */
enum class Route { Home }

/** A tiny back stack. `nav.go(Route.Settings)` opens a screen, `nav.back()` (or the back gesture) closes it. */
class Nav(start: List<Route>) {
  var stack by mutableStateOf(start)
    private set
  val current: Route get() = stack.last()
  val canGoBack: Boolean get() = stack.size > 1
  fun go(route: Route) { stack = stack + route }
  fun back() { if (canGoBack) stack = stack.dropLast(1) }

  companion object {
    val saver = Saver<Nav, List<String>>(save = { n -> n.stack.map { it.name } }, restore = { s -> Nav(s.map(Route::valueOf)) })
  }
}

@Composable
fun App() {
  val nav = rememberSaveable(saver = Nav.saver) { Nav(listOf(Route.Home)) }
  BackHandler(enabled = nav.canGoBack) { nav.back() }
  when (nav.current) {
    Route.Home -> HomeScreen()
  }
}
