package com.anyapp.game.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The game's look: colours and text styles for menus and the score. Change them to fit the game
 * (a space game is not a garden game). Flat colours, no gradients, no glow.
 */
object GameColors {
  val ink = Color(0xFF1E2A22)
  val paper = Color(0xFFF7F3EA)
  val accent = Color(0xFF4E8A3A)
  val onAccent = Color(0xFFFFFFFF)
  val danger = Color(0xFFC2452D)
  /** Behind menus, over the game. */
  val shade = Color(0xB3141A16)
  /** The touch buttons: a light fill and a clear edge, readable over any scene. */
  val buttonFill = Color(0x40FFFFFF)
  val buttonDown = Color(0x80FFFFFF)
  val buttonEdge = Color(0xCCFFFFFF)
}

object GameText {
  val title = TextStyle(fontSize = 36.sp, fontWeight = FontWeight.Bold, color = GameColors.paper, textAlign = TextAlign.Center)
  val heading = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = GameColors.paper, textAlign = TextAlign.Center)
  val body = TextStyle(fontSize = 16.sp, color = GameColors.paper, textAlign = TextAlign.Center)
  val score = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold, color = GameColors.ink)
  val button = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
}

/** A menu button: big enough for a thumb. primary = the one main action (Play, Resume). */
@Composable
fun MenuButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, primary: Boolean = false, minWidth: Dp = 220.dp) {
  val shape = RoundedCornerShape(14.dp)
  Box(
    modifier
      .widthIn(min = minWidth)
      .heightIn(min = 50.dp)
      .background(if (primary) GameColors.accent else Color.Transparent, shape)
      .border(1.5.dp, if (primary) GameColors.accent else GameColors.paper.copy(alpha = 0.6f), shape)
      .clickable(onClick = onClick)
      .padding(horizontal = 20.dp, vertical = 12.dp),
    contentAlignment = Alignment.Center,
  ) {
    BasicText(text, style = GameText.button.copy(color = if (primary) GameColors.onAccent else GameColors.paper))
  }
}
