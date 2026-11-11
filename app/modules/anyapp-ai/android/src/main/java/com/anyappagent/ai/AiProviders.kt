package com.anyappagent.ai

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * One streaming chat call to the user's AI provider, in the neutral format apps speak
 * (docs: template/modules/ai/README.md, "Wire format"). Translates the request to the provider's
 * own API, streams the answer back as neutral events, and counts tokens.
 *
 * Neutral request: { system?, messages: [{ role: "user"|"assistant", content: string | Part[] }],
 *                    tools?: [{ name, description, parameters }], maxTokens? }
 * Part: { type: "text", text } | { type: "image", mediaType, data (base64) }
 *     | { type: "tool_call", id, name, input } | { type: "tool_result", id, content, isError? }
 *     | { type: "opaque", provider, block }   (provider data to send back unchanged, e.g. thinking)
 * Events: { type: "text", text } (a piece of the answer, as it arrives)
 *       | { type: "part", part }  (a finished part of the answer, in order)
 *       | { type: "done", stopReason: "end"|"tool_calls"|"max_tokens"|"refusal"|"other", usage }
 *       | { type: "error", code, message }
 */
class AiCall(
  private val provider: String,
  private val model: String,
  private val key: String,
  private val request: JSONObject,
  private val maxTokens: Int,
  private val emit: (JSONObject) -> Unit,
) {
  class Failure(val code: String, override val message: String) : Exception(message)

  var inputTokens = 0L
    private set
  var outputTokens = 0L
    private set

  @Volatile private var conn: HttpURLConnection? = null
  @Volatile var cancelled = false
    private set

  fun cancel() {
    cancelled = true
    try {
      conn?.disconnect()
    } catch (_: Exception) {
    }
  }

  /** Runs the call to the end (blocking). Throws Failure for anything the app should be told. */
  fun run() {
    val test = testServer()
    val anthropic = provider == AiStore.ANTHROPIC
    val url = when {
      test != null && anthropic -> "$test/v1/messages"
      test != null -> "$test/api/v1/chat/completions"
      anthropic -> "https://api.anthropic.com/v1/messages"
      else -> "https://openrouter.ai/api/v1/chat/completions"
    }
    // With the test server switch on (adb only, see testServer) the real key is never sent.
    val sentKey = if (test != null) "test-key" else key
    val body = if (anthropic) anthropicBody() else openRouterBody()
    val c = URL(url).openConnection() as HttpURLConnection
    conn = c
    try {
      c.requestMethod = "POST"
      c.doOutput = true
      c.connectTimeout = 20_000
      c.readTimeout = 180_000
      c.setRequestProperty("content-type", "application/json")
      c.setRequestProperty("accept", "text/event-stream")
      if (anthropic) {
        c.setRequestProperty("x-api-key", sentKey)
        c.setRequestProperty("anthropic-version", "2026-10-21")
        if (usesFallbacks()) c.setRequestProperty("anthropic-beta", "server-side-fallback-2026-07-01")
      } else {
        c.setRequestProperty("authorization", "Bearer $sentKey")
        c.setRequestProperty("x-title", "AnyAppAgent")
      }
      val bytes = body.toString().toByteArray(Charsets.UTF_8)
      c.setFixedLengthStreamingMode(bytes.size)
      c.outputStream.use { it.write(bytes) }
      val status = c.responseCode
      if (status !in 200..299) throw httpFailure(status, readAll(c))
      BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)).use { reader ->
        if (anthropic) readAnthropic(reader) else readOpenRouter(reader)
      }
    } catch (e: Failure) {
      throw e
    } catch (e: Exception) {
      if (cancelled) throw Failure("cancelled", "Stopped.")
      throw Failure("network", "Could not reach the AI service. Check the internet connection.")
    } finally {
      try {
        c.disconnect()
      } catch (_: Exception) {
      }
    }
  }

  // ---------------- Claude (Anthropic Messages API) ----------------

  private fun usesFallbacks() = model in setOf("claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")

  private fun anthropicBody(): JSONObject {
    val out = JSONObject()
      .put("model", model)
      .put("max_tokens", maxTokens)
      .put("stream", true)
    request.optString("system").takeIf { it.isNotBlank() }?.let { out.put("system", it) }
    val messages = JSONArray()
    for (m in messagesOf(request)) {
      val role = m.optString("role")
      val blocks = JSONArray()
      val results = JSONArray()
      for (p in partsOf(m)) {
        when (p.optString("type")) {
          "text" -> p.optString("text").takeIf { it.isNotEmpty() }?.let { blocks.put(JSONObject().put("type", "text").put("text", it)) }
          "image" -> blocks.put(
            JSONObject().put("type", "image").put(
              "source",
              JSONObject().put("type", "base64").put("media_type", p.optString("mediaType", "image/jpeg")).put("data", p.optString("data")),
            ),
          )
          "tool_call" -> blocks.put(JSONObject().put("type", "tool_use").put("id", p.optString("id")).put("name", p.optString("name")).put("input", p.optJSONObject("input") ?: JSONObject()))
          // Claude wants tool results first in their message.
          "tool_result" -> results.put(
            JSONObject().put("type", "tool_result").put("tool_use_id", p.optString("id")).put("content", contentString(p)).put("is_error", p.optBoolean("isError", false)),
          )
          "opaque" -> if (p.optString("provider") == AiStore.ANTHROPIC) p.optJSONObject("block")?.let { blocks.put(it) }
        }
      }
      val all = JSONArray()
      for (i in 0 until results.length()) all.put(results.get(i))
      for (i in 0 until blocks.length()) all.put(blocks.get(i))
      if (all.length() == 0) continue
      messages.put(JSONObject().put("role", if (role == "assistant") "assistant" else "user").put("content", all))
    }
    out.put("messages", messages)
    val tools = request.optJSONArray("tools")
    if (tools != null && tools.length() > 0) {
      val t = JSONArray()
      for (i in 0 until tools.length()) {
        val tool = tools.getJSONObject(i)
        t.put(
          JSONObject()
            .put("name", tool.optString("name"))
            .put("description", tool.optString("description"))
            .put("input_schema", tool.optJSONObject("parameters") ?: JSONObject().put("type", "object").put("properties", JSONObject())),
        )
      }
      out.put("tools", t)
    }
    if (usesFallbacks()) out.put("fallbacks", "default")
    return out
  }

  private class Block(val type: String, val raw: JSONObject) {
    val text = StringBuilder()
    val json = StringBuilder()
    val thinking = StringBuilder()
    var signature: String? = null
  }

  private fun readAnthropic(reader: BufferedReader) {
    val blocks = HashMap<Int, Block>()
    var stop = "other"
    var finished = false
    while (true) {
      if (cancelled) throw Failure("cancelled", "Stopped.")
      val line = reader.readLine() ?: break
      if (!line.startsWith("data:")) continue
      val data = line.substring(5).trim()
      if (data.isEmpty()) continue
      val ev = try {
        JSONObject(data)
      } catch (_: Exception) {
        continue
      }
      when (ev.optString("type")) {
        "message_start" -> ev.optJSONObject("message")?.optJSONObject("usage")?.let { takeAnthropicUsage(it) }
        "content_block_start" -> {
          val cb = ev.optJSONObject("content_block") ?: JSONObject()
          blocks[ev.optInt("index")] = Block(cb.optString("type"), cb)
        }
        "content_block_delta" -> {
          val b = blocks[ev.optInt("index")] ?: continue
          val d = ev.optJSONObject("delta") ?: continue
          when (d.optString("type")) {
            "text_delta" -> {
              val t = d.optString("text")
              b.text.append(t)
              if (t.isNotEmpty()) emit(JSONObject().put("type", "text").put("text", t))
            }
            "input_json_delta" -> b.json.append(d.optString("partial_json"))
            "thinking_delta" -> b.thinking.append(d.optString("thinking"))
            "signature_delta" -> b.signature = d.optString("signature")
          }
        }
        "content_block_stop" -> {
          val b = blocks.remove(ev.optInt("index")) ?: continue
          val part = when (b.type) {
            "text" -> JSONObject().put("type", "text").put("text", b.text.toString())
            "tool_use" -> JSONObject().put("type", "tool_call").put("id", b.raw.optString("id")).put("name", b.raw.optString("name"))
              .put("input", parseObject(b.json.toString()))
            "thinking" -> {
              val block = JSONObject().put("type", "thinking").put("thinking", b.raw.optString("thinking") + b.thinking.toString())
              (b.signature ?: b.raw.optString("signature").takeIf { it.isNotEmpty() })?.let { block.put("signature", it) }
              JSONObject().put("type", "opaque").put("provider", AiStore.ANTHROPIC).put("block", block)
            }
            else -> JSONObject().put("type", "opaque").put("provider", AiStore.ANTHROPIC).put("block", b.raw)
          }
          emit(JSONObject().put("type", "part").put("part", part))
        }
        "message_delta" -> {
          ev.optJSONObject("delta")?.optString("stop_reason")?.takeIf { it.isNotEmpty() && it != "null" }?.let {
            stop = when (it) {
              "end_turn", "stop_sequence" -> "end"
              "tool_use" -> "tool_calls"
              "max_tokens" -> "max_tokens"
              "refusal" -> "refusal"
              else -> "other"
            }
          }
          ev.optJSONObject("usage")?.let { takeAnthropicUsage(it) }
        }
        "message_stop" -> {
          finished = true
          break
        }
        "error" -> {
          val err = ev.optJSONObject("error")
          throw Failure(if (err?.optString("type") == "overloaded_error") "busy" else "provider", err?.optString("message")?.takeIf { it.isNotEmpty() } ?: "The AI service had a problem.")
        }
      }
    }
    if (!finished) throw Failure("network", "The answer was cut off. Try again.")
    emit(done(stop))
  }

  private fun takeAnthropicUsage(u: JSONObject) {
    val input = u.optLong("input_tokens") + u.optLong("cache_creation_input_tokens") + u.optLong("cache_read_input_tokens")
    if (input > inputTokens) inputTokens = input
    val output = u.optLong("output_tokens")
    if (output > outputTokens) outputTokens = output
  }

  // ---------------- OpenRouter (OpenAI-style chat completions) ----------------

  private fun openRouterBody(): JSONObject {
    val out = JSONObject()
      .put("model", model)
      .put("max_tokens", maxTokens)
      .put("stream", true)
      .put("usage", JSONObject().put("include", true))
    val messages = JSONArray()
    request.optString("system").takeIf { it.isNotBlank() }?.let { messages.put(JSONObject().put("role", "system").put("content", it)) }
    for (m in messagesOf(request)) {
      val parts = partsOf(m)
      if (m.optString("role") == "assistant") {
        val text = StringBuilder()
        val calls = JSONArray()
        for (p in parts) {
          when (p.optString("type")) {
            "text" -> text.append(p.optString("text"))
            "tool_call" -> calls.put(
              JSONObject().put("id", p.optString("id")).put("type", "function").put(
                "function",
                JSONObject().put("name", p.optString("name")).put("arguments", (p.optJSONObject("input") ?: JSONObject()).toString()),
              ),
            )
          }
        }
        val msg = JSONObject().put("role", "assistant").put("content", if (text.isEmpty() && calls.length() > 0) JSONObject.NULL else text.toString())
        if (calls.length() > 0) msg.put("tool_calls", calls)
        messages.put(msg)
      } else {
        val content = JSONArray()
        for (p in parts) {
          when (p.optString("type")) {
            "tool_result" -> messages.put(JSONObject().put("role", "tool").put("tool_call_id", p.optString("id")).put("content", contentString(p)))
            "text" -> p.optString("text").takeIf { it.isNotEmpty() }?.let { content.put(JSONObject().put("type", "text").put("text", it)) }
            "image" -> content.put(
              JSONObject().put("type", "image_url").put(
                "image_url",
                JSONObject().put("url", "data:${p.optString("mediaType", "image/jpeg")};base64,${p.optString("data")}"),
              ),
            )
          }
        }
        if (content.length() > 0) messages.put(JSONObject().put("role", "user").put("content", content))
      }
    }
    out.put("messages", messages)
    val tools = request.optJSONArray("tools")
    if (tools != null && tools.length() > 0) {
      val t = JSONArray()
      for (i in 0 until tools.length()) {
        val tool = tools.getJSONObject(i)
        t.put(
          JSONObject().put("type", "function").put(
            "function",
            JSONObject()
              .put("name", tool.optString("name"))
              .put("description", tool.optString("description"))
              .put("parameters", tool.optJSONObject("parameters") ?: JSONObject().put("type", "object").put("properties", JSONObject())),
          ),
        )
      }
      out.put("tools", t)
    }
    return out
  }

  private class Call {
    var id = ""
    var name = ""
    val args = StringBuilder()
  }

  private fun readOpenRouter(reader: BufferedReader) {
    val text = StringBuilder()
    val calls = sortedMapOf<Int, Call>()
    var stop = "other"
    var finished = false
    while (true) {
      if (cancelled) throw Failure("cancelled", "Stopped.")
      val line = reader.readLine() ?: break
      if (!line.startsWith("data:")) continue // ": OPENROUTER PROCESSING" keep-alives and blank lines
      val data = line.substring(5).trim()
      if (data == "[DONE]") {
        finished = true
        break
      }
      val chunk = try {
        JSONObject(data)
      } catch (_: Exception) {
        continue
      }
      chunk.optJSONObject("error")?.let { throw Failure("provider", it.optString("message").ifEmpty { "The AI service had a problem." }) }
      chunk.optJSONObject("usage")?.let {
        inputTokens = maxOf(inputTokens, it.optLong("prompt_tokens"))
        outputTokens = maxOf(outputTokens, it.optLong("completion_tokens"))
      }
      val choice = chunk.optJSONArray("choices")?.optJSONObject(0) ?: continue
      val delta = choice.optJSONObject("delta")
      if (delta != null) {
        val t = if (delta.isNull("content")) "" else delta.optString("content")
        if (t.isNotEmpty()) {
          text.append(t)
          emit(JSONObject().put("type", "text").put("text", t))
        }
        val tc = delta.optJSONArray("tool_calls")
        if (tc != null) {
          for (i in 0 until tc.length()) {
            val d = tc.getJSONObject(i)
            val call = calls.getOrPut(d.optInt("index", i)) { Call() }
            d.optString("id").takeIf { it.isNotEmpty() }?.let { call.id = it }
            d.optJSONObject("function")?.let { f ->
              f.optString("name").takeIf { it.isNotEmpty() }?.let { call.name = it }
              if (!f.isNull("arguments")) call.args.append(f.optString("arguments"))
            }
          }
        }
      }
      if (!choice.isNull("finish_reason")) {
        stop = when (choice.optString("finish_reason")) {
          "stop" -> "end"
          "tool_calls" -> "tool_calls"
          "length" -> "max_tokens"
          "content_filter" -> "refusal"
          "error" -> throw Failure("provider", "The AI service had a problem.")
          else -> "other"
        }
      }
    }
    if (!finished && stop == "other") throw Failure("network", "The answer was cut off. Try again.")
    if (text.isNotEmpty()) emit(JSONObject().put("type", "part").put("part", JSONObject().put("type", "text").put("text", text.toString())))
    for ((i, c) in calls) {
      val id = c.id.ifEmpty { "call_$i" }
      emit(JSONObject().put("type", "part").put("part", JSONObject().put("type", "tool_call").put("id", id).put("name", c.name).put("input", parseObject(c.args.toString()))))
    }
    if (calls.isNotEmpty() && stop == "end") stop = "tool_calls"
    emit(done(stop))
  }

  // ---------------- shared ----------------

  private fun done(stop: String) = JSONObject()
    .put("type", "done")
    .put("stopReason", stop)
    .put("usage", JSONObject().put("inputTokens", inputTokens).put("outputTokens", outputTokens))

  private fun httpFailure(status: Int, body: String): Failure {
    val msg = try {
      val j = JSONObject(body)
      j.optJSONObject("error")?.optString("message") ?: j.optString("message")
    } catch (_: Exception) {
      ""
    }.orEmpty().take(500)
    return when (status) {
      401, 403 -> Failure("bad_key", "The AI key was not accepted. Check it in AnyAppAgent's settings.")
      402 -> Failure("no_credit", "The AI account is out of credit.")
      429 -> Failure("busy", "Too many requests to the AI service right now. Try again in a moment.")
      400, 404, 413, 422 -> Failure("bad_request", msg.ifEmpty { "The AI service did not accept the request." })
      else -> Failure("busy", "The AI service is busy or down (error $status). Try again in a moment.")
    }
  }

  private fun readAll(c: HttpURLConnection): String = try {
    (c.errorStream ?: c.inputStream).bufferedReader().use { it.readText() }.take(20_000)
  } catch (_: Exception) {
    ""
  }

  companion object {
    fun messagesOf(req: JSONObject): List<JSONObject> {
      val arr = req.optJSONArray("messages") ?: return emptyList()
      return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }

    fun partsOf(m: JSONObject): List<JSONObject> {
      val c = m.opt("content")
      if (c is String) return listOf(JSONObject().put("type", "text").put("text", c))
      if (c is JSONArray) return (0 until c.length()).mapNotNull { c.optJSONObject(it) }
      return emptyList()
    }

    fun contentString(p: JSONObject): String {
      val c = p.opt("content")
      return when (c) {
        null, JSONObject.NULL -> ""
        is String -> c
        else -> c.toString()
      }
    }

    fun parseObject(s: String): JSONObject = try {
      if (s.isBlank()) JSONObject() else JSONObject(s)
    } catch (_: Exception) {
      JSONObject()
    }

    /**
     * Development only: `adb shell setprop debug.anyapp.ai.url http://10.0.2.2:<port>` sends
     * every AI call to a local fake provider. Only the shell user (adb) can set debug.*
     * properties, and while it is set the stored key is never sent (a placeholder goes instead),
     * so this switch cannot be used to read the key.
     */
    fun testServer(): String? = try {
      val p = Runtime.getRuntime().exec(arrayOf("getprop", "debug.anyapp.ai.url"))
      val v = p.inputStream.bufferedReader().use { it.readText() }.trim()
      p.waitFor()
      v.takeIf { it.startsWith("http://") || it.startsWith("https://") }?.trimEnd('/')
    } catch (_: Exception) {
      null
    }
  }
}
