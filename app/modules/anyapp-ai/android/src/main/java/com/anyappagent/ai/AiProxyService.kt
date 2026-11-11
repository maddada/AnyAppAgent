package com.anyappagent.ai

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * The local AI proxy that apps made with AnyAppAgent bind to (action com.anyappagent.action.AI).
 * The app sends a neutral chat request; this service checks who sent it (AiTrust), whether the
 * app is switched on and within its limits, adds the key, calls the provider and streams the
 * answer back. The key never leaves this process.
 *
 * Messages (the same numbers are in template/modules/ai, AiClient.kt):
 *   app -> here  STATUS    data {}                                      reply STATUS_REPLY
 *                CHAT      data { id, chunk, last }  request JSON in pieces of up to 256 KB
 *                CANCEL    data { id }
 *   here -> app  STATUS_REPLY data { json }  { ready, reason?, provider?, model? }
 *                EVENT       data { id, json }  one event (AiProviders.kt), the last is done or error
 */
class AiProxyService : Service() {
  companion object {
    const val STATUS = 1
    const val CHAT = 2
    const val CANCEL = 3
    const val STATUS_REPLY = 101
    const val EVENT = 102

    /** Limits that stop a runaway app from burning credit without anyone noticing. */
    const val MAX_IN_FLIGHT_PER_APP = 3
    const val MAX_CALLS_PER_MINUTE_PER_APP = 30
    const val MAX_REQUEST_BYTES = 12 * 1024 * 1024
    const val DEFAULT_MAX_TOKENS = 8192
    const val MAX_TOKENS_CAP = 32000
  }

  private lateinit var thread: HandlerThread
  private lateinit var messenger: Messenger
  private val pool = Executors.newCachedThreadPool()

  /** Keyed by "<uid>:<request id>". */
  private val partial = ConcurrentHashMap<String, StringBuilder>()
  private val running = ConcurrentHashMap<String, AiCall>()
  private val recent = HashMap<String, ArrayDeque<Long>>()

  override fun onCreate() {
    super.onCreate()
    thread = HandlerThread("anyapp-ai").apply { start() }
    messenger = Messenger(object : Handler(thread.looper) {
      override fun handleMessage(msg: Message) = handle(msg)
    })
  }

  override fun onBind(intent: Intent?): IBinder = messenger.binder

  override fun onDestroy() {
    running.values.forEach { it.cancel() }
    pool.shutdownNow()
    thread.quitSafely()
    super.onDestroy()
  }

  private fun handle(msg: Message) {
    val replyTo = msg.replyTo ?: return
    val uid = msg.sendingUid // set by the system from the Binder caller: cannot be faked
    val data = msg.data ?: Bundle()
    when (msg.what) {
      STATUS -> reply(replyTo, STATUS_REPLY, Bundle().apply { putString("json", status(uid).toString()) })
      CHAT -> chat(uid, replyTo, data)
      CANCEL -> {
        val k = "$uid:${data.getString("id")}"
        partial.remove(k)
        running.remove(k)?.cancel()
      }
    }
  }

  private fun status(uid: Int): JSONObject {
    val out = JSONObject()
    val who = AiTrust.check(this, uid)
    if (who is AiTrust.Result.Refused) return out.put("ready", false).put("reason", "not_allowed")
    val pkg = (who as AiTrust.Result.Allowed).packageName
    AiStore.touch(this, pkg)
    val cfg = AiStore.config(this) ?: return out.put("ready", false).put("reason", "not_set_up")
    if (!AiStore.app(this, pkg).enabled) return out.put("ready", false).put("reason", "app_off").put("provider", cfg.provider)
    return out.put("ready", true).put("provider", cfg.provider).put("model", cfg.model)
  }

  private fun chat(uid: Int, replyTo: Messenger, data: Bundle) {
    val id = data.getString("id") ?: return
    val k = "$uid:$id"
    val buf = partial.getOrPut(k) { StringBuilder() }
    buf.append(data.getString("chunk").orEmpty())
    if (buf.length > MAX_REQUEST_BYTES) {
      partial.remove(k)
      return fail(replyTo, id, "too_big", "The request is too big. Send smaller images.")
    }
    if (!data.getBoolean("last", true)) return
    partial.remove(k)

    val who = AiTrust.check(this, uid)
    if (who is AiTrust.Result.Refused) {
      return fail(replyTo, id, "not_allowed", "Only apps made with AnyAppAgent can use its AI key.")
    }
    val pkg = (who as AiTrust.Result.Allowed).packageName
    AiStore.touch(this, pkg)
    val cfg = AiStore.config(this)
    val key = if (cfg != null) AiStore.readKey(this) else null
    if (cfg == null || key == null) return fail(replyTo, id, "not_set_up", "AI is not set up: open AnyAppAgent to add a key.")
    if (!AiStore.app(this, pkg).enabled) {
      AiStore.countRefused(this, pkg)
      return fail(replyTo, id, "app_off", "AI is switched off for this app in AnyAppAgent.")
    }
    if (running.keys.count { it.startsWith("$uid:") } >= MAX_IN_FLIGHT_PER_APP) {
      return fail(replyTo, id, "limit", "This app is already waiting for ${MAX_IN_FLIGHT_PER_APP} answers. Try again when they finish.")
    }
    if (!underRateLimit(pkg)) {
      AiStore.countRefused(this, pkg)
      return fail(replyTo, id, "limit", "This app asked the AI too often in the last minute. Wait a moment.")
    }
    val request = try {
      JSONObject(buf.toString())
    } catch (_: Exception) {
      return fail(replyTo, id, "bad_request", "The request was not valid JSON.")
    }
    val maxTokens = request.optInt("maxTokens", DEFAULT_MAX_TOKENS).coerceIn(1, MAX_TOKENS_CAP)

    val call = AiCall(cfg.provider, cfg.model, key, request, maxTokens) { ev ->
      if (!send(replyTo, id, ev)) running.remove(k)?.cancel() // the app went away
    }
    running[k] = call
    AiStore.countCall(this, pkg)
    pool.execute {
      try {
        call.run()
      } catch (e: AiCall.Failure) {
        if (e.code != "cancelled") send(replyTo, id, JSONObject().put("type", "error").put("code", e.code).put("message", e.message))
        else send(replyTo, id, JSONObject().put("type", "error").put("code", "cancelled").put("message", "Stopped."))
      } catch (e: Exception) {
        send(replyTo, id, JSONObject().put("type", "error").put("code", "internal").put("message", "Something went wrong in AnyAppAgent."))
      } finally {
        running.remove(k)
        AiStore.countTokens(this, pkg, call.inputTokens, call.outputTokens)
      }
    }
  }

  private fun underRateLimit(pkg: String): Boolean = synchronized(recent) {
    val now = System.currentTimeMillis()
    val q = recent.getOrPut(pkg) { ArrayDeque() }
    while (q.isNotEmpty() && now - q.first() > 60_000) q.removeFirst()
    if (q.size >= MAX_CALLS_PER_MINUTE_PER_APP) return false
    q.addLast(now)
    true
  }

  private fun fail(replyTo: Messenger, id: String, code: String, message: String) {
    send(replyTo, id, JSONObject().put("type", "error").put("code", code).put("message", message))
  }

  private fun send(replyTo: Messenger, id: String, ev: JSONObject): Boolean =
    reply(replyTo, EVENT, Bundle().apply {
      putString("id", id)
      putString("json", ev.toString())
    })

  private fun reply(replyTo: Messenger, what: Int, data: Bundle): Boolean = try {
    replyTo.send(Message.obtain(null, what).apply { this.data = data })
    true
  } catch (_: RemoteException) {
    false
  }
}
