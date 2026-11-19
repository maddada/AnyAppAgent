package com.anyapp.game.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** A full-screen layer over the game that swallows touches (menus, game over). */
@Composable
fun Overlay(content: @Composable () -> Unit) {
  Box(
    Modifier
      .fillMaxSize()
      .background(GameColors.shade)
      .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
      .safeDrawingPadding(),
    contentAlignment = Alignment.Center,
  ) { content() }
}

/**
 * The pause menu: Resume, Start again, the sound switch, Move the buttons, Settings. Pass null for
 * sounds or buttons when the game has none.
 */
@Composable
fun PauseMenu(onResume: () -> Unit, onRestart: () -> Unit, sounds: Sounds? = null, buttons: TouchButtons? = null) {
  val host = LocalGameHost.current
  Overlay {
    Column(
      Modifier.verticalScroll(rememberScrollState()).padding(24.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      BasicText("Paused", style = GameText.title, modifier = Modifier.padding(bottom = 8.dp))
      MenuButton("Resume", onResume, primary = true)
      MenuButton("Start again", onRestart)
      if (sounds != null) MenuButton(if (sounds.on) "Sound: on" else "Sound: off", { sounds.toggle() })
      if (buttons != null) MenuButton("Move the buttons", { buttons.moving = true })
      MenuButton("Settings", { host.openSettings() })
    }
  }
}

/** Shown while the player moves the buttons: what to do, then Reset and Done (below, on the right). */
@Composable
fun MovingButtonsCard(buttons: TouchButtons) {
  Box(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier
        .widthIn(max = 420.dp)
        .fillMaxWidth()
        .background(GameColors.ink.copy(alpha = 0.92f), RoundedCornerShape(16.dp))
        .padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      BasicText(
        "Drag the buttons to where your thumbs like them.",
        style = GameText.body.copy(textAlign = TextAlign.Start),
        modifier = Modifier.fillMaxWidth(),
      )
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
        SmallButton("Reset") { buttons.resetPlaces() }
        SmallButton("Done", primary = true) { buttons.moving = false }
      }
    }
  }
}

@Composable
private fun SmallButton(text: String, primary: Boolean = false, onClick: () -> Unit) {
  MenuButton(text, onClick, primary = primary, minWidth = 96.dp)
}
