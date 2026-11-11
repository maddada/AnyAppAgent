package com.anyapp.app.ai

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject

/**
 * AI (Claude or OpenRouter) through AnyAppAgent. The person adds their AI key once, in
 * AnyAppAgent's Settings; every app made with AnyAppAgent can then use it. This app never sees
 * the key: requests go to AnyAppAgent on the same phone (a bound service), which adds the key,
 * counts usage and lets the person switch AI off per app. Usage: AGENTS.md, "AI".
 *
 *   val answer = Ai.ask(context, "Suggest a name for a cat")
 *   val reply = Ai.chat(context, messages, system = "...", onText = { live += it })
 *   val result = Ai.runAgent(context, prompt = "...", tools = listOf(addItem))
 *
 * Every call is a suspend function (call it from a coroutine: rememberCoroutineScope().launch,
 * LaunchedEffect). Cancelling the coroutine stops the answer. Errors are AiError.
 */
object Ai {
  /**
   * AnyAppAgent's package. Development only: `adb shell setprop debug.anyapp.ai.agent <package>`
   * talks to a side-by-side AnyAppAgent build instead (only adb can set debug.* properties, and
   * that build still decides which apps it serves).
   */
  private val AGENT_PACKAGE: String by lazy { devProperty("debug.anyapp.ai.agent")?.takeIf { Regex("[a-z][a-z0-9_.]*").matches(it) } ?: "com.anyappagent" }
  private const val ACTION = "com.anyappagent.action.AI"

  // Same numbers as AnyAppAgent's AiProxyService (AI.md).
  private const val STATUS = 1
  private const val CHAT = 2
  private const val CANCEL = 3
  private const val STATUS_REPLY = 101
  private const val EVENT = 102
  private const val CHUNK = 200_000 // characters per message, well under the Binder limit

  private val thread by lazy { HandlerThread("anyapp-ai-client").apply { start() } }
  private val handler by lazy { Handler(thread.looper) }
  private val main = Handler(Looper.getMainLooper())
  private val counter = AtomicInteger()

  // Everything below is touched only on `thread`.
  private var context: Context? = null
  private var service: Messenger? = null
  private var binding = false
  private var bound = false
  private val waiting = ArrayList<(Messenger?) -> Unit>()
  private val statusWaiters = ArrayList<(String) -> Unit>()
  private val listeners = HashMap<String, (JSONObject) -> Unit>()

  private val replies by lazy {
    Messenger(object : Handler(thread.looper) {
      override fun handleMessage(msg: Message) {
        val data = msg.data ?: return
        when (msg.what) {
          STATUS_REPLY -> {
            val json = data.getString("json") ?: "{}"
            val w = statusWaiters.toList()
            statusWaiters.clear()
            w.forEach { it(json) }
          }
          EVENT -> {
            val id = data.getString("id") ?: return
            val ev = try {
              JSONObject(data.getString("json") ?: return)
            } catch (_: Exception) {
              return
            }
            listeners[id]?.invoke(ev)
          }
        }
      }
    })
  }

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      handler.post {
        binding = false
        service = binder?.let { Messenger(it) }
        flushWaiting(service)
      }
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      // AnyAppAgent stopped or was updated: answers in progress are lost.
      handler.post {
        service = null
        failAll("disconnected", "AnyAppAgent stopped while answering. Try again.")
      }
    }

    override fun onBindingDied(name: ComponentName?) {
      handler.post {
        unbind()
        failAll("disconnected", "AnyAppAgent was updated or stopped. Try again.")
      }
    }

    override fun onNullBinding(name: ComponentName?) {
      handler.post { unbind() }
    }
  }

  // ---------- status and setup

  /** Whether AI can be used right now, and if not, why. Never throws. */
  suspend fun status(context: Context): AiStatus = suspendCancellableCoroutine { cont ->
    val once = AtomicBoolean(false)
    val answer = { json: String -> if (once.compareAndSet(false, true)) cont.resume(parseStatus(json)) }
    handler.post {
      withService(context) { s ->
        if (s == null) return@withService answer(notReady(if (agentInstalled(context)) "not_reachable" else "no_anyappagent"))
        statusWaiters.add(answer)
        if (!send(s, STATUS, Bundle())) {
          statusWaiters.remove(answer)
          answer(notReady("not_reachable"))
        } else {
          handler.postDelayed({ if (statusWaiters.remove(answer)) answer(notReady("not_reachable")) }, 8000)
        }
      }
    }
  }

  /** Opens AnyAppAgent's settings, where the AI key is added and each app switched on or off. */
  fun openSetup(context: Context): Boolean {
    val deep = Intent(Intent.ACTION_VIEW, Uri.parse("anyappagent://settings")).setPackage(AGENT_PACKAGE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(deep)
      true
    } catch (_: Exception) {
      val launch = context.packageManager.getLaunchIntentForPackage(AGENT_PACKAGE)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      launch != null && runCatching { context.startActivity(launch) }.isSuccess
    }
  }

  // ---------- one turn

  /**
   * One AI turn, streamed. Returns when the answer is complete; [onText] gets the text as it
   * arrives (on the main thread). To continue the conversation, add `reply.message` to your
   * messages, then the next user message (or tool results). Throws AiError.
   */
  suspend fun chat(
    context: Context,
    messages: List<AiMessage>,
    system: String? = null,
    tools: List<AiTool> = emptyList(),
    /** Default 8192, at most 32000. */
    maxTokens: Int? = null,
    onText: ((String) -> Unit)? = null,
  ): AiReply = suspendCancellableCoroutine { cont ->
    val id = "${System.currentTimeMillis().toString(36)}-${counter.incrementAndGet()}"
    val request = JSONObject().apply {
      if (system != null) put("system", system)
      put("messages", JSONArray().apply { messages.forEach { put(it.toJson()) } })
      if (tools.isNotEmpty()) {
        put("tools", JSONArray().apply {
          tools.forEach { put(JSONObject().put("name", it.name).put("description", it.description).put("parameters", it.parameters)) }
        })
      }
      if (maxTokens != null) put("maxTokens", maxTokens)
    }.toString()
    val parts = ArrayList<AiPart>()
    val text = StringBuilder()
    val once = AtomicBoolean(false)
    handler.post {
      listeners[id] = { ev ->
        when (ev.optString("type")) {
          "text" -> {
            val piece = ev.optString("text")
            text.append(piece)
            if (onText != null) main.post { onText(piece) }
          }
          "part" -> ev.optJSONObject("part")?.let { parts.add(AiPart.fromJson(it)) }
          "done" -> {
            listeners.remove(id)
            val usage = ev.optJSONObject("usage")
            val reply = AiReply(
              text = text.toString(),
              toolCalls = parts.filterIsInstance<AiPart.ToolCall>(),
              message = AiMessage("assistant", parts.toList()),
              stopReason = ev.optString("stopReason", "other"),
              usage = AiUsage(usage?.optInt("inputTokens") ?: 0, usage?.optInt("outputTokens") ?: 0),
            )
            if (once.compareAndSet(false, true)) main.post { cont.resume(reply) }
          }
          "error" -> {
            listeners.remove(id)
            val error = AiError(ev.optString("code", "internal"), ev.optString("message", "The AI could not answer."))
            if (once.compareAndSet(false, true)) main.post { cont.resumeWithException(error) }
          }
        }
      }
      withService(context) { s ->
        if (s == null) {
          val code = if (agentInstalled(context)) "not_reachable" else "no_anyappagent"
          return@withService emit(id, code, if (code == "no_anyappagent") "AI needs AnyAppAgent on this phone." else "Could not reach AnyAppAgent. Open it once and try again.")
        }
        var i = 0
        var ok: Boolean
        do {
          val end = minOf(request.length, i + CHUNK)
          ok = send(s, CHAT, Bundle().apply {
            putString("id", id)
            putString("chunk", request.substring(i, end))
            putBoolean("last", end >= request.length)
          })
          i = end
        } while (ok && i < request.length)
        if (!ok) emit(id, "not_reachable", "Could not reach AnyAppAgent. Try again.")
      }
    }
    cont.invokeOnCancellation {
      handler.post {
        listeners.remove(id)
        service?.let { send(it, CANCEL, Bundle().apply { putString("id", id) }) }
      }
    }
  }

  /** Asks one question, returns the answer text. Throws AiError. */
  suspend fun ask(context: Context, prompt: String, system: String? = null, onText: ((String) -> Unit)? = null): String =
    chat(context, listOf(AiMessage.user(prompt)), system = system, onText = onText).text

  // ---------- agent loop

  /**
   * Runs an agent: the AI answers, calls your tools when it needs them, gets their results, and
   * continues until it is done (or [maxSteps] AI turns). Returns the final text and the whole
   * conversation (keep `messages` to continue later). Throws AiError.
   */
  suspend fun runAgent(
    context: Context,
    tools: List<AiTool>,
    prompt: String? = null,
    messages: List<AiMessage> = emptyList(),
    system: String? = null,
    /** AI turns before stopping. Default 8. */
    maxSteps: Int = 8,
    maxTokens: Int? = null,
    onText: ((String) -> Unit)? = null,
    /** Called before each tool runs (to show "Adding milk..."). */
    onToolCall: ((AiPart.ToolCall) -> Unit)? = null,
  ): AiAgentResult {
    val all = messages.toMutableList()
    if (prompt != null) all.add(AiMessage.user(prompt))
    val byName = tools.associateBy { it.name }
    var usage = AiUsage()
    var last: AiReply? = null
    var steps = 0
    while (steps < maxSteps) {
      steps++
      val reply = chat(context, all, system, tools, maxTokens, onText)
      last = reply
      usage += reply.usage
      all.add(reply.message)
      if (reply.stopReason != "tool_calls" || reply.toolCalls.isEmpty()) break
      val results = reply.toolCalls.map { call ->
        onToolCall?.invoke(call)
        val tool = byName[call.name]
        if (tool == null) {
          AiPart.ToolResult(call.id, "No tool named ${call.name}.", isError = true)
        } else {
          try {
            val out = tool.run(call.input)
            AiPart.ToolResult(call.id, if (out is String) out else (out?.toString() ?: "null"))
          } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
          } catch (e: Exception) {
            AiPart.ToolResult(call.id, e.message ?: e.toString(), isError = true)
          }
        }
      }
      all.add(AiMessage("user", results))
    }
    return AiAgentResult(last?.text ?: "", all, steps, usage, last?.stopReason ?: "other")
  }

  // ---------- binding (on `thread`)

  private fun agentInstalled(c: Context): Boolean = try {
    c.packageManager.getPackageInfo(AGENT_PACKAGE, 0)
    true
  } catch (_: Exception) {
    false
  }

  private fun withService(c: Context, then: (Messenger?) -> Unit) {
    service?.let { return then(it) }
    waiting.add(then)
    if (binding) return
    binding = true
    val app = c.applicationContext
    context = app
    val ok = try {
      app.bindService(Intent(ACTION).setPackage(AGENT_PACKAGE), connection, Context.BIND_AUTO_CREATE)
    } catch (_: Exception) {
      false
    }
    bound = ok
    if (!ok) {
      runCatching { app.unbindService(connection) }
      binding = false
      flushWaiting(null)
      return
    }
    handler.postDelayed({
      if (binding) {
        unbind()
        flushWaiting(null)
      }
    }, 10_000)
  }

  private fun flushWaiting(s: Messenger?) {
    val w = waiting.toList()
    waiting.clear()
    w.forEach { it(s) }
  }

  private fun unbind() {
    if (bound) context?.let { runCatching { it.unbindService(connection) } }
    bound = false
    binding = false
    service = null
  }

  private fun send(s: Messenger, what: Int, data: Bundle): Boolean = try {
    s.send(Message.obtain(null, what).apply {
      this.data = data
      replyTo = replies
    })
    true
  } catch (_: RemoteException) {
    service = null
    false
  }

  private fun emit(id: String, code: String, message: String) {
    listeners[id]?.invoke(JSONObject().put("type", "error").put("code", code).put("message", message))
  }

  private fun failAll(code: String, message: String) {
    listeners.keys.toList().forEach { emit(it, code, message) }
    val w = statusWaiters.toList()
    statusWaiters.clear()
    w.forEach { it(notReady("not_reachable")) }
  }

  private fun devProperty(name: String): String? = try {
    val p = Runtime.getRuntime().exec(arrayOf("getprop", name))
    val v = p.inputStream.bufferedReader().use { it.readText() }.trim()
    p.waitFor()
    v.ifEmpty { null }
  } catch (_: Exception) {
    null
  }

  private fun notReady(reason: String) = JSONObject().put("ready", false).put("reason", reason).toString()

  private fun parseStatus(json: String): AiStatus = try {
    val j = JSONObject(json)
    if (j.optBoolean("ready")) AiStatus(true, provider = j.optString("provider"), model = j.optString("model"))
    else AiStatus(false, reason = j.optString("reason", "not_reachable"))
  } catch (_: Exception) {
    AiStatus(false, reason = "not_reachable")
  }
}
