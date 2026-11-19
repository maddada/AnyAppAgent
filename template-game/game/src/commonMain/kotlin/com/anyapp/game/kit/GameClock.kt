package com.anyapp.game.kit

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos

/**
 * The game loop: calls [onFrame] once per screen frame (60 or 120 times a second) with the seconds
 * since the last frame, while [running]. A slow frame counts as at most 1/20 s, so nothing jumps
 * through a wall after a hiccup. Move things by speed * dt, never by a fixed step per frame.
 *
 *   GameClock(running = state == Playing) { dt -> world.update(dt) }
 */
@Composable
fun GameClock(running: Boolean, onFrame: (dt: Float) -> Unit) {
  val latest by rememberUpdatedState(onFrame)
  LaunchedEffect(running) {
    if (!running) return@LaunchedEffect
    var last = -1L
    while (true) {
      withFrameNanos { now ->
        val dt = if (last < 0) 0f else ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
        last = now
        latest(dt)
      }
    }
  }
}
