// "Point at it": part of the feedback feature built into every app (see Feedback.kt). Keep it.
package com.anyapp.feedback

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import kotlin.math.sqrt

/**
 * A deliberate shake, not a bump, a step or a run: [PEAKS] strong jolts (each over [FORCE], with
 * gravity taken out), every one in roughly the opposite direction of the one before, all within
 * [WINDOW_NS]. Walking and running never reach it: their peaks are weaker than 1.3 g of extra
 * force in one direction, and a fall is at most 1 g. After a shake it rests for [REST_NS].
 */
internal class ShakeDetector(private val onShake: () -> Unit) : SensorEventListener {
  companion object {
    const val FORCE = 13f // m/s^2 beyond gravity, about 1.3 g
    const val PEAKS = 4
    const val WINDOW_NS = 1_500_000_000L
    const val GAP_NS = 700_000_000L // a pause this long between jolts starts over
    const val REST_NS = 2_500_000_000L
    const val GRAVITY_SMOOTHING = 0.92f
  }

  private val gravity = FloatArray(3)
  private var hasGravity = false
  private var lastDir: FloatArray? = null
  private var firstPeakAt = 0L
  private var lastPeakAt = 0L
  private var peaks = 0
  private var restUntil = 0L

  fun reset() {
    hasGravity = false
    lastDir = null
    peaks = 0
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
    val v = event.values
    if (!hasGravity) {
      gravity[0] = v[0]; gravity[1] = v[1]; gravity[2] = v[2]
      hasGravity = true
      return
    }
    for (i in 0..2) gravity[i] = GRAVITY_SMOOTHING * gravity[i] + (1 - GRAVITY_SMOOTHING) * v[i]
    val x = v[0] - gravity[0]
    val y = v[1] - gravity[1]
    val z = v[2] - gravity[2]
    val force = sqrt(x * x + y * y + z * z)
    val now = event.timestamp
    if (now < restUntil) return
    if (peaks > 0 && now - lastPeakAt > GAP_NS) {
      peaks = 0
      lastDir = null
    }
    if (force < FORCE) return
    val dir = floatArrayOf(x / force, y / force, z / force)
    val prev = lastDir
    if (prev != null && prev[0] * dir[0] + prev[1] * dir[1] + prev[2] * dir[2] > -0.3f) return // same swing
    if (peaks > 0 && now - firstPeakAt > WINDOW_NS) peaks = 0 // too slow: this jolt starts a new count
    if (peaks == 0) firstPeakAt = now
    peaks++
    lastPeakAt = now
    lastDir = dir
    if (peaks >= PEAKS) {
      peaks = 0
      lastDir = null
      restUntil = now + REST_NS
      onShake()
    }
  }
}
