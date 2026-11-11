package com.anyapp.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Data that survives restarts and app updates (wiped only when the app is uninstalled).
 * Small values and JSON, kept in SharedPreferences. Keep each value under ~1 MB.
 *
 *   var count by rememberStored("count", 0)            // in a composable, saved on every change
 *   Store.putJson(context, "settings", JSONObject().put("offset", 10))
 */
object Store {
  private fun prefs(c: Context): SharedPreferences = c.getSharedPreferences("app", Context.MODE_PRIVATE)

  fun getString(c: Context, key: String, default: String): String = prefs(c).getString(key, default) ?: default
  fun putString(c: Context, key: String, value: String) = prefs(c).edit().putString(key, value).apply()

  fun getInt(c: Context, key: String, default: Int): Int = prefs(c).getInt(key, default)
  fun putInt(c: Context, key: String, value: Int) = prefs(c).edit().putInt(key, value).apply()

  fun getLong(c: Context, key: String, default: Long): Long = prefs(c).getLong(key, default)
  fun putLong(c: Context, key: String, value: Long) = prefs(c).edit().putLong(key, value).apply()

  fun getBoolean(c: Context, key: String, default: Boolean): Boolean = prefs(c).getBoolean(key, default)
  fun putBoolean(c: Context, key: String, value: Boolean) = prefs(c).edit().putBoolean(key, value).apply()

  fun getFloat(c: Context, key: String, default: Float): Float = prefs(c).getFloat(key, default)
  fun putFloat(c: Context, key: String, value: Float) = prefs(c).edit().putFloat(key, value).apply()

  fun getJson(c: Context, key: String): JSONObject? =
    prefs(c).getString(key, null)?.let { runCatching { JSONObject(it) }.getOrNull() }
  fun putJson(c: Context, key: String, value: JSONObject) = putString(c, key, value.toString())

  fun getJsonArray(c: Context, key: String): JSONArray? =
    prefs(c).getString(key, null)?.let { runCatching { JSONArray(it) }.getOrNull() }
  fun putJsonArray(c: Context, key: String, value: JSONArray) = putString(c, key, value.toString())

  fun remove(c: Context, key: String) = prefs(c).edit().remove(key).apply()
}

/** A state that is loaded from [Store] once and saved whenever it changes. */
private class StoredState<T>(
  private val inner: MutableState<T>,
  private val save: (T) -> Unit,
) : MutableState<T> by inner {
  override var value: T
    get() = inner.value
    set(v) {
      inner.value = v
      save(v)
    }

  override fun component1(): T = value
  override fun component2(): (T) -> Unit = { value = it }
}

/** Persistent state for String, Int, Long, Boolean or Float values. */
@Composable
@Suppress("UNCHECKED_CAST")
fun <T> rememberStored(key: String, default: T): MutableState<T> {
  val c = LocalContext.current.applicationContext
  return remember(key) {
    val initial: T = when (default) {
      is String -> Store.getString(c, key, default) as T
      is Int -> Store.getInt(c, key, default) as T
      is Long -> Store.getLong(c, key, default) as T
      is Boolean -> Store.getBoolean(c, key, default) as T
      is Float -> Store.getFloat(c, key, default) as T
      else -> error("rememberStored supports String, Int, Long, Boolean and Float; use Store.putJson for more")
    }
    StoredState(mutableStateOf(initial)) { v ->
      when (v) {
        is String -> Store.putString(c, key, v)
        is Int -> Store.putInt(c, key, v)
        is Long -> Store.putLong(c, key, v)
        is Boolean -> Store.putBoolean(c, key, v)
        is Float -> Store.putFloat(c, key, v)
      }
    }
  }
}
