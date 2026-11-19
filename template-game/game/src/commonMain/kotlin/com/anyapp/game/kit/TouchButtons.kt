package com.anyapp.game.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/**
 * One on-screen button. x and y: where its centre sits, as a share of the play area (0 to 1).
 * fill, fillDown and labelColor give a button its own colours (null: the kit's light buttons).
 */
data class ButtonSpec(
  val id: String,
  val label: String,
  val x: Float,
  val y: Float,
  val size: Dp = 76.dp,
  val fill: Color? = null,
  val fillDown: Color? = null,
  val labelColor: Color? = null,
)

/**
 * Touch buttons the player can hold (several at once) and move where their thumbs like them (the
 * pause menu's "Move the buttons"; the places are saved).
 *
 *   val buttons = rememberTouchButtons(ButtonSpec("left", "◀", 0.1f, 0.82f), ButtonSpec("right", "▶", 0.26f, 0.82f))
 *   if (buttons.isDown("left")) x -= speed * dt       // held
 *   if (buttons.pressed("jump")) jump()               // once per press
 *   TouchButtonsLayer(buttons)                        // drawn over the game
 */
class TouchButtons(private val host: GameHost, val specs: List<ButtonSpec>) {
  private val places = mutableStateMapOf<String, Offset>()
  private val down = mutableStateMapOf<String, Boolean>()
  private val presses = mutableMapOf<String, Int>()
  private val seen = mutableMapOf<String, Int>()

  /** True while the player is moving the buttons (they do nothing else then). */
  var moving by mutableStateOf(false)

  init {
    host.load(SAVE_KEY)?.split(';')?.forEach { entry ->
      val parts = entry.split(':', ',')
      if (parts.size == 3) {
        val x = parts[1].toFloatOrNull()
        val y = parts[2].toFloatOrNull()
        if (x != null && y != null) places[parts[0]] = Offset(x, y)
      }
    }
  }

  fun place(id: String): Offset = places[id] ?: specs.first { it.id == id }.let { Offset(it.x, it.y) }

  /** True while the button is held. */
  fun isDown(id: String): Boolean = down[id] == true

  /** True once for each press (the next call is false until the button is pressed again). */
  fun pressed(id: String): Boolean {
    val n = presses[id] ?: 0
    val before = seen[id] ?: 0
    seen[id] = n
    return n > before
  }

  /** Lets go of every button (on pause, so nothing stays held). */
  fun releaseAll() {
    down.clear()
    seen.putAll(presses)
  }

  /** Puts every button back where the game first had it. */
  fun resetPlaces() {
    places.clear()
    host.save(SAVE_KEY, "")
  }

  internal fun setDown(id: String, isDown: Boolean) {
    if (isDown && down[id] != true) presses[id] = (presses[id] ?: 0) + 1
    down[id] = isDown
  }

  internal fun moveBy(id: String, dx: Float, dy: Float) {
    val p = place(id)
    places[id] = Offset((p.x + dx).coerceIn(0.04f, 0.96f), (p.y + dy).coerceIn(0.06f, 0.94f))
  }

  internal fun savePlaces() {
    host.save(SAVE_KEY, places.entries.joinToString(";") { "${it.key}:${it.value.x},${it.value.y}" })
  }

  private companion object {
    const val SAVE_KEY = "kit.buttons"
  }
}

@Composable
fun rememberTouchButtons(vararg specs: ButtonSpec): TouchButtons {
  val host = LocalGameHost.current
  return remember(host) { TouchButtons(host, specs.toList()) }
}

/** Draws the buttons over the game and handles their touches. Touches elsewhere reach the game. */
@Composable
fun TouchButtonsLayer(buttons: TouchButtons, modifier: Modifier = Modifier.fillMaxSize()) {
  BoxWithConstraints(modifier) {
    val w = constraints.maxWidth.toFloat()
    val h = constraints.maxHeight.toFloat()
    val density = LocalDensity.current
    for (spec in buttons.specs) {
      val at = buttons.place(spec.id)
      val r = with(density) { spec.size.toPx() } / 2f
      val held = buttons.isDown(spec.id)
      Box(
        Modifier
          .offset { IntOffset((at.x * w - r).roundToInt(), (at.y * h - r).roundToInt()) }
          .size(spec.size)
          .background(
            if (held || buttons.moving) spec.fillDown ?: GameColors.buttonDown else spec.fill ?: GameColors.buttonFill,
            CircleShape,
          )
          .border(2.dp, GameColors.buttonEdge, CircleShape)
          .pointerInput(spec.id, buttons.moving, w, h) {
            if (buttons.moving) {
              detectDragGestures(onDragEnd = { buttons.savePlaces() }) { change, drag ->
                change.consume()
                buttons.moveBy(spec.id, drag.x / w, drag.y / h)
              }
            } else {
              awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false).consume()
                buttons.setDown(spec.id, true)
                do {
                  val event = awaitPointerEvent()
                  event.changes.forEach { it.consume() }
                } while (event.changes.any { it.pressed })
                buttons.setDown(spec.id, false)
              }
            }
          },
        contentAlignment = Alignment.Center,
      ) {
        BasicText(spec.label, style = GameText.button.copy(color = spec.labelColor ?: GameColors.paper, fontSize = (spec.size.value * if (spec.label.length > 2) 0.22f else 0.36f).sp))
      }
    }
  }
}
