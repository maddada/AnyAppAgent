package com.anyappagent.ai

import android.content.Context
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * AI for web apps (docs/WEB-APPS.md): Kiwimake's own web screen runs the person's web app in a
 * WebView and passes its window.kiwimake.ai calls here. The same rules as AiProxyService (the one
 * Android apps bind to): the per-app on/off switch, 3 answers in flight, 30 calls a minute, the
 * maxTokens cap and usage counting, with the same AiCall. The key never leaves this process: the
 * page only ever sees the neutral events.
 *
 * A web app has no package or signing certificate to check. It is keyed "web:<slug>" and shown in
 * Settings as "<App name> (web)". Only Kiwimake's web screen calls this, and only for the person's
 * own app at its own address (the screen checks that before it answers the page).
 */
object AiWebCalls {
  private val pool = Executors.newCachedThreadPool()

  /** Keyed by "<app key>|<call id>". */
  private val running = ConcurrentHashMap<String, AiCall>()
  private val recent = HashMap<String, ArrayDeque<Long>>()

  fun isWebKey(key: String) = key.startsWith("web:") && key.length > 4 && key.length <= 120

  fun status(ctx: Context, key: String, label: String): JSONObject {
    val out = JSONObject()
    if (!isWebKey(key)) return out.put("ready", false).put("reason", "not_allowed")
    AiStore.touchLabeled(ctx, key, label)
    val cfg = AiStore.config(ctx) ?: return out.put("ready", false).put("reason", "not_set_up")
    if (!AiStore.app(ctx, key).enabled) return out.put("ready", false).put("reason", "app_off").put("provider", cfg.provider)
    return out.put("ready", true).put("provider", cfg.provider).put("model", cfg.model)
  }

  /** Starts one call; `emit` gets every event (on a worker thread), the last is done or error. */
  fun chat(ctx: Context, key: String, label: String, id: String, json: String, emit: (JSONObject) -> Unit) {
    fun fail(code: String, message: String) = emit(JSONObject().put("type", "error").put("code", code).put("message", message))
    if (!isWebKey(key)) return fail("not_allowed", "Only apps made with Kiwimake can use its AI key.")
    if (json.length > AiProxyService.MAX_REQUEST_BYTES) return fail("too_big", "The request is too big. Send smaller images.")
    AiStore.touchLabeled(ctx, key, label)
    val cfg = AiStore.config(ctx)
    val secret = if (cfg != null) AiStore.readKey(ctx) else null
    if (cfg == null || secret == null) return fail("not_set_up", "AI is not set up: open Kiwimake to add a key.")
    if (!AiStore.app(ctx, key).enabled) {
      AiStore.countRefused(ctx, key)
      return fail("app_off", "AI is switched off for this app in Kiwimake.")
    }
    if (running.keys.count { it.startsWith("$key|") } >= AiProxyService.MAX_IN_FLIGHT_PER_APP) {
      return fail("limit", "This app is already waiting for ${AiProxyService.MAX_IN_FLIGHT_PER_APP} answers. Try again when they finish.")
    }
    if (!underRateLimit(key)) {
      AiStore.countRefused(ctx, key)
      return fail("limit", "This app asked the AI too often in the last minute. Wait a moment.")
    }
    val request = try {
      JSONObject(json)
    } catch (_: Exception) {
      return fail("bad_request", "The request was not valid JSON.")
    }
    val maxTokens = request.optInt("maxTokens", AiProxyService.DEFAULT_MAX_TOKENS).coerceIn(1, AiProxyService.MAX_TOKENS_CAP)
    val k = "$key|$id"
    running.remove(k)?.cancel() // the same id again: the old one is over
    val call = AiCall(cfg.provider, cfg.model, secret, request, maxTokens) { ev -> emit(ev) }
    running[k] = call
    AiStore.countCall(ctx, key)
    val app = ctx.applicationContext
    pool.execute {
      try {
        call.run()
      } catch (e: AiCall.Failure) {
        if (e.code != "cancelled") emit(JSONObject().put("type", "error").put("code", e.code).put("message", e.message))
        else emit(JSONObject().put("type", "error").put("code", "cancelled").put("message", "Stopped."))
      } catch (e: Exception) {
        emit(JSONObject().put("type", "error").put("code", "internal").put("message", "Something went wrong in Kiwimake."))
      } finally {
        if (running[k] === call) running.remove(k)
        AiStore.countTokens(app, key, call.inputTokens, call.outputTokens)
      }
    }
  }

  fun cancel(key: String, id: String) {
    running.remove("$key|$id")?.cancel()
  }

  private fun underRateLimit(key: String): Boolean = synchronized(recent) {
    val now = System.currentTimeMillis()
    val q = recent.getOrPut(key) { ArrayDeque() }
    while (q.isNotEmpty() && now - q.first() > 60_000) q.removeFirst()
    if (q.size >= AiProxyService.MAX_CALLS_PER_MINUTE_PER_APP) return false
    q.addLast(now)
    true
  }
}
