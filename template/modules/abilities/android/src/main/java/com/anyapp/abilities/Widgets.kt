package com.anyapp.abilities

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

/** One row of a widget's list: "Asr" ... "15:12". [strong] shows it in the accent colour. */
data class WidgetRow(val label: String, val value: String = "", val strong: Boolean = false) {
  fun toJson(): JSONObject = JSONObject().put("label", label).put("value", value).put("strong", strong)
}

/** The widget's button. [open] true opens the app with the action; false runs it in the background. */
data class WidgetButton(val label: String, val action: String, val open: Boolean = false) {
  fun toJson(): JSONObject = JSONObject().put("label", label).put("action", action).put("open", open)
}

/**
 * What a widget shows. Every field is optional. [countdownTo] (epoch ms) shows a live countdown in
 * place of [value] until that moment. [timeline] lists later versions (epoch ms to the fields that
 * change then), so the widget moves on by itself while the app is closed (the next prayer, a new
 * day). [accent] and [accentDark] are colours like "#14532D".
 */
data class WidgetContent(
  val title: String? = null,
  val value: String? = null,
  val subtitle: String? = null,
  val countdownTo: Long? = null,
  val progress: Double? = null,
  val rows: List<WidgetRow> = emptyList(),
  val button: WidgetButton? = null,
  val tapAction: String? = null,
  val accent: String? = null,
  val accentDark: String? = null,
  val timeline: List<Pair<Long, WidgetContent>> = emptyList(),
) {
  fun toJson(): JSONObject {
    val o = JSONObject()
    title?.let { o.put("title", it) }
    value?.let { o.put("value", it) }
    subtitle?.let { o.put("subtitle", it) }
    countdownTo?.let { o.put("countdownTo", it) }
    progress?.let { o.put("progress", it) }
    if (rows.isNotEmpty()) o.put("rows", JSONArray(rows.map { it.toJson() }))
    button?.let { o.put("button", it.toJson()) }
    tapAction?.let { o.put("tapAction", it) }
    accent?.let { o.put("accent", it) }
    accentDark?.let { o.put("accentDark", it) }
    if (timeline.isNotEmpty()) o.put("timeline", JSONArray(timeline.map { (at, c) -> c.toJson().put("at", at) }))
    return o
  }
}

/**
 * Home screen widgets. The app declares up to 4 widgets (receivers [Widget1] .. [Widget4], each
 * with a meta-data `com.anyapp.abilities.widget` naming its id), then sets what each shows with
 * [update]. Android draws it from the last content, so it works while the app is closed.
 */
object Widgets {
  private const val META = "com.anyapp.abilities.widget"
  private val SLOTS = listOf(Widget1::class.java, Widget2::class.java, Widget3::class.java, Widget4::class.java)
  private const val MAX_ROWS = 6

  fun update(context: Context, id: String, content: WidgetContent) = updateJson(context, id, content.toJson().toString())

  /** Same as [update], with the content as JSON (the fields of [WidgetContent]). */
  fun updateJson(context: Context, id: String, json: String) {
    JSONObject(json) // throws on bad JSON before anything is stored
    Actions.prefs(context).edit().putString("widget:$id", json).apply()
    refresh(context, id)
  }

  /** The widget ids this app declares. */
  fun ids(context: Context): List<String> = slots(context).keys.toList()

  /** True when at least one copy of widget [id] is on the home screen. */
  fun isPlaced(context: Context, id: String): Boolean = instances(context, id).isNotEmpty()

  /**
   * Asks the launcher to put widget [id] on the home screen (Android shows its own "Add" dialog).
   * Returns false when the launcher cannot do that; then the person adds it by hand
   * (long-press the home screen, Widgets).
   */
  fun requestPin(context: Context, id: String): Boolean {
    val cls = slots(context)[id] ?: return false
    val mgr = AppWidgetManager.getInstance(context)
    if (Build.VERSION.SDK_INT < 26 || !mgr.isRequestPinAppWidgetSupported) return false
    return mgr.requestPinAppWidget(ComponentName(context, cls), null, null)
  }

  /** Draws widget [id] again from its stored content and plans its next change. */
  fun refresh(context: Context, id: String) {
    val cls = slots(context)[id] ?: run {
      Log.w(Actions.TAG, "No widget \"$id\" is declared")
      return
    }
    val ids = instances(context, id)
    if (ids.isEmpty()) {
      cancelTick(context, id)
      return
    }
    val mgr = AppWidgetManager.getInstance(context)
    val stored = Actions.prefs(context).getString("widget:$id", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    val now = System.currentTimeMillis()
    val content = stored?.let { activeAt(it, now) } ?: placeholder(context)
    for (wid in ids) mgr.updateAppWidget(wid, render(context, id, content, now))
    if (stored == null) {
      // A new widget with nothing to show yet: ask the app (in the background) to fill it in.
      Actions.run(context, AbilityAction("widget-update", "widget", id))
    }
    val next = stored?.let { nextChange(it, now) }
    if (next == null) cancelTick(context, id) else scheduleTick(context, id, next)
    Log.d(Actions.TAG, "widget $id drawn on ${ids.size} (${cls.simpleName})")
  }

  internal fun refreshSlot(context: Context, cls: Class<*>) {
    slots(context).filterValues { it == cls }.keys.forEach { refresh(context, it) }
  }

  internal fun cancelIfUnused(context: Context, cls: Class<*>) {
    slots(context).filterValues { it == cls }.keys.forEach { if (!isPlaced(context, it)) cancelTick(context, it) }
  }

  // ---- slots ------------------------------------------------------------------------------

  private var slotCache: Map<String, Class<out AppWidgetProvider>>? = null

  private fun slots(context: Context): Map<String, Class<out AppWidgetProvider>> {
    slotCache?.let { return it }
    val out = linkedMapOf<String, Class<out AppWidgetProvider>>()
    for (cls in SLOTS) {
      try {
        val info = context.packageManager.getReceiverInfo(ComponentName(context, cls), PackageManager.GET_META_DATA)
        info.metaData?.getString(META)?.let { out[it] = cls }
      } catch (_: PackageManager.NameNotFoundException) {
        // this slot is not declared
      }
    }
    return out.also { slotCache = it }
  }

  private fun instances(context: Context, id: String): IntArray {
    val cls = slots(context)[id] ?: return IntArray(0)
    return AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, cls))
  }

  // ---- content ----------------------------------------------------------------------------

  /** The content at [now]: the base with the latest timeline entry that has started laid over it. */
  internal fun activeAt(base: JSONObject, now: Long): JSONObject {
    val out = JSONObject(base.toString())
    out.remove("timeline")
    val timeline = base.optJSONArray("timeline") ?: return out
    var best: JSONObject? = null
    var bestAt = Long.MIN_VALUE
    for (i in 0 until timeline.length()) {
      val e = timeline.optJSONObject(i) ?: continue
      val at = e.optLong("at", Long.MAX_VALUE)
      if (at <= now && at >= bestAt) {
        best = e
        bestAt = at
      }
    }
    best?.keys()?.forEach { k -> if (k != "at") out.put(k, best.get(k)) }
    return out
  }

  /** When the widget next has to be drawn again: the next timeline entry or the end of a countdown. */
  internal fun nextChange(base: JSONObject, now: Long): Long? {
    var next: Long? = null
    fun consider(t: Long) {
      if (t > now && (next == null || t < next!!)) next = t
    }
    val timeline = base.optJSONArray("timeline")
    if (timeline != null) for (i in 0 until timeline.length()) timeline.optJSONObject(i)?.let { consider(it.optLong("at", 0)) }
    val active = activeAt(base, now)
    if (active.has("countdownTo")) consider(active.optLong("countdownTo"))
    return next
  }

  private fun placeholder(context: Context): JSONObject {
    val label = context.applicationInfo.loadLabel(context.packageManager).toString()
    return JSONObject().put("title", label).put("subtitle", "Open the app to fill this in")
  }

  // ---- drawing ----------------------------------------------------------------------------

  private fun render(context: Context, id: String, c: JSONObject, now: Long): RemoteViews {
    val r = { name: String -> Actions.res(context, "anyapp_widget_$name", "id") }
    val rv = RemoteViews(context.packageName, Actions.res(context, "anyapp_widget", "layout"))

    fun text(view: String, value: String?) {
      if (value.isNullOrEmpty()) rv.setViewVisibility(r(view), View.GONE)
      else {
        rv.setViewVisibility(r(view), View.VISIBLE)
        rv.setTextViewText(r(view), value)
      }
    }
    text("title", c.optStringOrNull("title"))
    text("subtitle", c.optStringOrNull("subtitle"))

    val countdownTo = if (c.has("countdownTo")) c.optLong("countdownTo") else 0L
    if (countdownTo > now && Build.VERSION.SDK_INT >= 24) {
      rv.setViewVisibility(r("value"), View.GONE)
      rv.setViewVisibility(r("countdown"), View.VISIBLE)
      rv.setChronometer(r("countdown"), SystemClock.elapsedRealtime() + (countdownTo - now), null, true)
      rv.setChronometerCountDown(r("countdown"), true)
    } else {
      rv.setViewVisibility(r("countdown"), View.GONE)
      rv.setChronometer(r("countdown"), SystemClock.elapsedRealtime(), null, false)
      text("value", c.optStringOrNull("value"))
    }

    if (c.has("progress")) {
      val p = c.optDouble("progress", 0.0).coerceIn(0.0, 1.0)
      rv.setViewVisibility(r("progress"), View.VISIBLE)
      rv.setProgressBar(r("progress"), 1000, (p * 1000).toInt(), false)
    } else rv.setViewVisibility(r("progress"), View.GONE)

    val rows = c.optJSONArray("rows")
    val n = minOf(rows?.length() ?: 0, MAX_ROWS)
    rv.setViewVisibility(r("rows"), if (n > 0) View.VISIBLE else View.GONE)
    val (accent, accentDark) = accents(context, c)
    for (i in 0 until MAX_ROWS) {
      val row = if (i < n) rows!!.optJSONObject(i) else null
      rv.setViewVisibility(r("row$i"), if (row != null) View.VISIBLE else View.GONE)
      if (row == null) continue
      rv.setTextViewText(r("row${i}_label"), row.optString("label"))
      rv.setTextViewText(r("row${i}_value"), row.optString("value"))
      val strong = row.optBoolean("strong")
      for (part in listOf("row${i}_label", "row${i}_value")) {
        if (strong) textColor(rv, r(part), accent, accentDark)
        else plainText(context, rv, r(part))
      }
    }

    val button = c.optJSONObject("button")
    if (button != null && button.optString("label").isNotEmpty()) {
      rv.setViewVisibility(r("button"), View.VISIBLE)
      rv.setTextViewText(r("button"), button.optString("label"))
      val action = AbilityAction(button.optString("action", "tap"), "widget", id)
      rv.setOnClickPendingIntent(r("button"), if (button.optBoolean("open")) openPending(context, action) else runPending(context, action))
      tint(rv, r("button"), "setBackgroundTintList", accent, accentDark)
    } else rv.setViewVisibility(r("button"), View.GONE)

    val tap = c.optStringOrNull("tapAction")
    rv.setOnClickPendingIntent(r("root"), openPending(context, tap?.let { AbilityAction(it, "widget", id) }))
    textColor(rv, r("title"), accent, accentDark)
    tint(rv, r("progress"), "setProgressTintList", accent, accentDark)
    return rv
  }

  private fun accents(context: Context, c: JSONObject): Pair<Int, Int> {
    val fallback = context.getColor(Actions.res(context, "anyapp_widget_accent", "color"))
    val light = parseColor(c.optStringOrNull("accent")) ?: fallback
    val dark = parseColor(c.optStringOrNull("accentDark")) ?: parseColor(c.optStringOrNull("accent")) ?: fallback
    return light to dark
  }

  private fun textColor(rv: RemoteViews, view: Int, light: Int, dark: Int) {
    if (Build.VERSION.SDK_INT >= 31) rv.setColorInt(view, "setTextColor", light, dark) else rv.setTextColor(view, light)
  }

  /** The normal text colour, resolved by the launcher so it follows its light or dark mode. */
  private fun plainText(context: Context, rv: RemoteViews, view: Int) {
    val res = Actions.res(context, "anyapp_widget_text", "color")
    if (Build.VERSION.SDK_INT >= 31) rv.setColorStateList(view, "setTextColor", res) else rv.setTextColor(view, context.getColor(res))
  }

  private fun tint(rv: RemoteViews, view: Int, method: String, light: Int, dark: Int) {
    if (Build.VERSION.SDK_INT >= 31) rv.setColorStateList(view, method, ColorStateList.valueOf(light), ColorStateList.valueOf(dark))
  }

  private fun parseColor(s: String?): Int? = s?.let { runCatching { Color.parseColor(it.trim()) }.getOrNull() }

  private fun runPending(context: Context, action: AbilityAction): PendingIntent {
    val intent = Intent(context, ActionReceiver::class.java)
      .setAction(ActionReceiver.RUN)
      .putExtra(ActionReceiver.EXTRA_ACTION, action.toJson().toString())
      .setData(android.net.Uri.parse("anyapp-run://${action.source}/${action.from}/${action.name}"))
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or Actions.immutable)
  }

  private fun openPending(context: Context, action: AbilityAction?): PendingIntent =
    PendingIntent.getActivity(context, 0, Actions.openIntent(context, action), PendingIntent.FLAG_UPDATE_CURRENT or Actions.immutable)

  // ---- timeline ticks ---------------------------------------------------------------------

  private fun tickIntent(context: Context, id: String, flags: Int): PendingIntent? {
    val intent = Intent(context, ActionReceiver::class.java).setAction(ActionReceiver.REFRESH)
      .putExtra(ActionReceiver.EXTRA_WIDGET, id)
      .setData(android.net.Uri.parse("anyapp-tick://$id"))
    return PendingIntent.getBroadcast(context, 0, intent, flags or Actions.immutable)
  }

  private fun scheduleTick(context: Context, id: String, at: Long) {
    val am = context.getSystemService(AlarmManager::class.java) ?: return
    val pi = tickIntent(context, id, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
    try {
      if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.RTC, at, pi)
      else am.setExactAndAllowWhileIdle(AlarmManager.RTC, at, pi)
    } catch (e: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC, at, pi)
    }
  }

  private fun cancelTick(context: Context, id: String) {
    val pi = tickIntent(context, id, PendingIntent.FLAG_NO_CREATE) ?: return
    context.getSystemService(AlarmManager::class.java)?.cancel(pi)
    pi.cancel()
  }

  private fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) optString(key) else null
}

/** The widget receivers. The manifest declares one per widget the app has (see [Widgets]). */
open class AbilityWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = Widgets.refreshSlot(context, javaClass)

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
    Widgets.refreshSlot(context, javaClass)

  override fun onDisabled(context: Context) = Widgets.cancelIfUnused(context, javaClass)
}

class Widget1 : AbilityWidgetProvider()
class Widget2 : AbilityWidgetProvider()
class Widget3 : AbilityWidgetProvider()
class Widget4 : AbilityWidgetProvider()
