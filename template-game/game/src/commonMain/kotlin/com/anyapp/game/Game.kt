package com.anyapp.game

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import com.anyapp.game.kit.GameEvents
import com.anyapp.game.kit.GameHost
import com.anyapp.game.kit.LocalGameEvents
import com.anyapp.game.kit.LocalGameHost
import com.anyapp.game.starter.KiwiCatch

/** How the game wants the phone held. The app turns the screen to match. */
enum class GameOrientation { Any, Landscape, Portrait }

/** About the game, read by the app around it. */
object GameInfo {
  val orientation = GameOrientation.Any
}

/**
 * The game, as the app shows it: full screen, edge to edge. Replace KiwiCatch with your game; keep
 * this function's signature (the Android app, and later the iPhone and web versions, call it).
 */
@Composable
fun Game(host: GameHost, events: GameEvents) {
  CompositionLocalProvider(LocalGameHost provides host, LocalGameEvents provides events) {
    KiwiCatch()
  }
}
