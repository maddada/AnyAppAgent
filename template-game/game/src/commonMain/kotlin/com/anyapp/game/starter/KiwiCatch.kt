package com.anyapp.game.starter

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.anyapp.game.kit.ButtonSpec
import com.anyapp.game.kit.GameClock
import com.anyapp.game.kit.GameColors
import com.anyapp.game.kit.GameText
import com.anyapp.game.kit.LocalGameEvents
import com.anyapp.game.kit.LocalGameHost
import com.anyapp.game.kit.MenuButton
import com.anyapp.game.kit.MovingButtonsCard
import com.anyapp.game.kit.Overlay
import com.anyapp.game.kit.PauseMenu
import com.anyapp.game.kit.TouchButtonsLayer
import com.anyapp.game.kit.loadInt
import com.anyapp.game.kit.rememberSounds
import com.anyapp.game.kit.rememberTouchButtons
import com.anyapp.game.kit.saveInt
import kotlin.math.abs
import kotlin.random.Random

/**
 * The starter game, Kiwi Catch: a kiwi catches falling kiwifruit and dodges stones. Three lives,
 * the best score is saved. It shows every part of the kit: the game loop, touch buttons (and
 * dragging), sounds, a buzz, saves, pause and game over. Replace it with the person's game.
 */
private enum class Phase { Ready, Playing, Paused, Over }

private class Drop(var x: Float, var y: Float, val speed: Float, val stone: Boolean)

/** The world in shares of the play area (0 to 1), so it fits any screen and any way up. */
private class World {
  var kiwiX = 0.5f
  val drops = mutableListOf<Drop>()
  var nextDrop = 0.6f
  var score = 0
  var lives = 3
  var hurt = 0f
  /** Goes up every frame: drawing reads it, so the canvas redraws. */
  var frame by mutableIntStateOf(0)

  fun reset() {
    kiwiX = 0.5f
    drops.clear()
    nextDrop = 0.6f
    score = 0
    lives = 3
    hurt = 0f
    frame++
  }
}

private const val KIWI_Y = 0.80f
private const val CATCH_REACH = 0.075f

@Composable
fun KiwiCatch() {
  val host = LocalGameHost.current
  val events = LocalGameEvents.current
  val sounds = rememberSounds("catch", "hit", "over")
  val buttons = rememberTouchButtons(
    ButtonSpec("left", "◀", x = 0.10f, y = 0.84f),
    ButtonSpec("right", "▶", x = 0.27f, y = 0.84f),
  )
  val world = remember { World() }
  var phase by remember { mutableStateOf(Phase.Ready) }
  var best by remember { mutableIntStateOf(host.loadInt("best", 0)) }

  fun pause() {
    if (phase == Phase.Playing) {
      phase = Phase.Paused
      buttons.releaseAll()
    }
  }

  // Pause when the app leaves the screen; the back gesture pauses, and resumes from the menu.
  LaunchedEffect(events.hidden) { if (events.hidden) pause() }
  SideEffect { events.wantsBack = phase == Phase.Playing || phase == Phase.Paused || buttons.moving }
  LaunchedEffect(events.backPresses) {
    when {
      buttons.moving -> buttons.moving = false
      phase == Phase.Playing -> pause()
      phase == Phase.Paused -> phase = Phase.Playing
    }
  }

  GameClock(running = phase == Phase.Playing && !buttons.moving) { dt ->
    val speed = 0.75f
    if (buttons.isDown("left")) world.kiwiX -= speed * dt
    if (buttons.isDown("right")) world.kiwiX += speed * dt
    world.kiwiX = world.kiwiX.coerceIn(0.05f, 0.95f)
    world.hurt = (world.hurt - dt).coerceAtLeast(0f)

    world.nextDrop -= dt
    if (world.nextDrop <= 0f) {
      val faster = (world.score / 10) * 0.06f
      world.drops += Drop(Random.nextFloat() * 0.9f + 0.05f, -0.05f, 0.32f + faster + Random.nextFloat() * 0.12f, stone = Random.nextFloat() < 0.28f)
      world.nextDrop = (0.85f - faster).coerceAtLeast(0.35f)
    }
    val iterator = world.drops.iterator()
    while (iterator.hasNext()) {
      val drop = iterator.next()
      drop.y += drop.speed * dt
      if (drop.y >= KIWI_Y - 0.04f && drop.y <= KIWI_Y + 0.03f && abs(drop.x - world.kiwiX) < CATCH_REACH) {
        iterator.remove()
        if (drop.stone) {
          world.lives--
          world.hurt = 0.4f
          sounds.play("hit")
          host.vibrate(120)
          if (world.lives <= 0) {
            phase = Phase.Over
            sounds.play("over")
            if (world.score > best) {
              best = world.score
              host.saveInt("best", best)
            }
          }
        } else {
          world.score++
          sounds.play("catch", 0.8f)
        }
      } else if (drop.y > 1.05f) {
        iterator.remove()
      }
    }
    world.frame++
  }

  BoxWithConstraints(Modifier.fillMaxSize().background(SKY)) {
    val width = constraints.maxWidth.toFloat()
    Canvas(
      Modifier
        .fillMaxSize()
        // Dragging anywhere on the scene moves the kiwi too.
        .pointerInput(phase) {
          if (phase == Phase.Playing) detectDragGestures { change, drag ->
            change.consume()
            world.kiwiX = (world.kiwiX + drag.x / width).coerceIn(0.05f, 0.95f)
          }
        },
    ) {
      world.frame // read, so every frame redraws
      drawScene(world)
    }

    if (phase == Phase.Playing || phase == Phase.Paused) {
      TouchButtonsLayer(buttons)
      Hud(world.score, world.lives, onPause = { pause() })
    }

    when (phase) {
      Phase.Ready -> Overlay {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
          BasicText("Kiwi Catch", style = GameText.title)
          BasicText("Catch the kiwifruit, dodge the stones.", style = GameText.body)
          if (best > 0) BasicText("Best: $best", style = GameText.heading)
          MenuButton("Play", { world.reset(); phase = Phase.Playing }, primary = true)
        }
      }
      Phase.Paused -> if (!buttons.moving) PauseMenu(
        onResume = { phase = Phase.Playing },
        onRestart = { world.reset(); phase = Phase.Playing },
        sounds = sounds,
        buttons = buttons,
      )
      Phase.Over -> Overlay {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
          BasicText("Game over", style = GameText.title)
          BasicText("Score: ${world.score}", style = GameText.heading)
          BasicText(if (world.score >= best && world.score > 0) "A new best!" else "Best: $best", style = GameText.body)
          MenuButton("Play again", { world.reset(); phase = Phase.Playing }, primary = true)
          MenuButton("Settings", { host.openSettings() })
        }
      }
      Phase.Playing -> Unit
    }
    if (buttons.moving) MovingButtonsCard(buttons)
  }
}

@Composable
private fun Hud(score: Int, lives: Int, onPause: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().safeDrawingPadding().padding(horizontal = 16.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    BasicText("$score", style = GameText.score)
    BasicText("  " + "●".repeat(lives.coerceAtLeast(0)), style = GameText.score.copy(color = GameColors.danger))
    Box(Modifier.weight(1f))
    Box(
      Modifier.size(48.dp).background(GameColors.ink.copy(alpha = 0.12f), CircleShape).clickable(onClick = onPause),
      contentAlignment = Alignment.Center,
    ) { BasicText("II", style = GameText.score) }
  }
}

private val SKY = Color(0xFFDCEBF2)
private val GROUND = Color(0xFF7BAE5B)
private val KIWI_BODY = Color(0xFF8A6A45)
private val KIWI_DARK = Color(0xFF5E4630)
private val BEAK = Color(0xFFE2C38A)
private val FRUIT_SKIN = Color(0xFF8C6B3E)
private val FRUIT_FLESH = Color(0xFF8DC63F)
private val FRUIT_CORE = Color(0xFFF3F0D2)
private val STONE = Color(0xFF8E9399)

private fun DrawScope.drawScene(world: World) {
  val w = size.width
  val h = size.height
  val unit = minOf(w, h)
  drawRect(GROUND, topLeft = Offset(0f, h * (KIWI_Y + 0.05f)), size = Size(w, h))

  for (drop in world.drops) {
    val c = Offset(drop.x * w, drop.y * h)
    val r = unit * 0.035f
    if (drop.stone) {
      drawCircle(STONE, r, c)
      drawCircle(Color.Black.copy(alpha = 0.15f), r, c, style = Stroke(unit * 0.004f))
    } else {
      drawCircle(FRUIT_SKIN, r, c)
      drawCircle(FRUIT_FLESH, r * 0.82f, c)
      drawCircle(FRUIT_CORE, r * 0.3f, c)
    }
  }

  // The kiwi: body, head, beak and legs. It blinks red for a moment when a stone hits.
  val body = Offset(world.kiwiX * w, h * KIWI_Y)
  val r = unit * 0.06f
  val tint = if (world.hurt > 0f) GameColors.danger else KIWI_BODY
  drawLine(KIWI_DARK, body + Offset(-r * 0.3f, r * 0.7f), body + Offset(-r * 0.4f, r * 1.1f), strokeWidth = r * 0.12f)
  drawLine(KIWI_DARK, body + Offset(r * 0.3f, r * 0.7f), body + Offset(r * 0.4f, r * 1.1f), strokeWidth = r * 0.12f)
  drawOval(tint, topLeft = body - Offset(r, r * 0.8f), size = Size(r * 2f, r * 1.6f))
  val head = body + Offset(r * 0.7f, -r * 0.6f)
  drawCircle(tint, r * 0.45f, head)
  drawCircle(Color.Black, r * 0.07f, head + Offset(r * 0.12f, -r * 0.08f))
  drawLine(BEAK, head + Offset(r * 0.35f, 0f), head + Offset(r * 1.2f, r * 0.5f), strokeWidth = r * 0.12f)
}
