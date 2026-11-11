package com.anyapp.app.ai

import org.json.JSONArray
import org.json.JSONObject

// The types of "AI through AnyAppAgent" (wire format: AI.md beside AGENTS.md, the same as the
// React Native template's modules/ai/README.md). Usage: AGENTS.md, "AI".

/** One piece of a message. */
sealed class AiPart {
  data class Text(val text: String) : AiPart()

  /** An image in a user message: base64 data without a "data:" prefix. Keep it under ~4 MB. */
  data class Image(val data: String, val mediaType: String = "image/jpeg") : AiPart()

  /** The AI asks to run a tool (in an assistant message). */
  data class ToolCall(val id: String, val name: String, val input: JSONObject) : AiPart()

  /** Your tool's answer (in a user message). */
  data class ToolResult(val id: String, val content: String, val isError: Boolean = false) : AiPart()

  /** Provider data (for example the model's hidden thinking) sent back unchanged. Never build one. */
  data class Opaque(val json: JSONObject) : AiPart()

  fun toJson(): JSONObject = when (this) {
    is Text -> JSONObject().put("type", "text").put("text", text)
    is Image -> JSONObject().put("type", "image").put("mediaType", mediaType).put("data", data)
    is ToolCall -> JSONObject().put("type", "tool_call").put("id", id).put("name", name).put("input", input)
    is ToolResult -> JSONObject().put("type", "tool_result").put("id", id).put("content", content).apply { if (isError) put("isError", true) }
    is Opaque -> json
  }

  companion object {
    fun fromJson(j: JSONObject): AiPart = when (j.optString("type")) {
      "text" -> Text(j.optString("text"))
      "image" -> Image(j.optString("data"), j.optString("mediaType", "image/jpeg"))
      "tool_call" -> ToolCall(j.optString("id"), j.optString("name"), j.optJSONObject("input") ?: JSONObject())
      "tool_result" -> ToolResult(j.optString("id"), j.optString("content"), j.optBoolean("isError"))
      else -> Opaque(j)
    }
  }
}

/** A message of the conversation. Keep the whole list to continue a conversation. */
data class AiMessage(val role: String, val content: List<AiPart>) {
  val text: String get() = content.filterIsInstance<AiPart.Text>().joinToString("") { it.text }

  fun toJson(): JSONObject = JSONObject().put("role", role).put("content", JSONArray().apply { content.forEach { put(it.toJson()) } })

  companion object {
    fun user(text: String) = AiMessage("user", listOf(AiPart.Text(text)))
    fun user(vararg parts: AiPart) = AiMessage("user", parts.toList())
  }
}

/**
 * A tool the AI may call. [parameters] is a JSON Schema for its input, e.g.
 * `JSONObject("""{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}""")`.
 * [run] gets the input and returns anything (a String, a number, a JSONObject...); throw to
 * report a problem to the AI.
 */
class AiTool(
  val name: String,
  val description: String,
  val parameters: JSONObject,
  val run: suspend (input: JSONObject) -> Any?,
)

data class AiUsage(val inputTokens: Int = 0, val outputTokens: Int = 0) {
  operator fun plus(o: AiUsage) = AiUsage(inputTokens + o.inputTokens, outputTokens + o.outputTokens)
}

/** One AI answer. Append [message] to your messages to continue. */
data class AiReply(
  val text: String,
  /** Tools the AI wants to run (when [stopReason] is "tool_calls"). */
  val toolCalls: List<AiPart.ToolCall>,
  val message: AiMessage,
  /** "end", "tool_calls", "max_tokens", "refusal" or "other". */
  val stopReason: String,
  val usage: AiUsage,
)

data class AiAgentResult(val text: String, val messages: List<AiMessage>, val steps: Int, val usage: AiUsage, val stopReason: String)

/**
 * Whether AI can be used. When not [ready], [reason] is one of:
 * "not_set_up" (no key in AnyAppAgent yet), "app_off" (switched off for this app),
 * "no_anyappagent" (AnyAppAgent is not on this phone), "not_reachable", "not_allowed".
 */
data class AiStatus(val ready: Boolean, val reason: String? = null, val provider: String? = null, val model: String? = null)

/**
 * [code]: a not-ready reason (above), or "bad_key", "no_credit", "busy", "limit", "network",
 * "bad_request", "too_big", "cancelled", "disconnected", "internal".
 */
class AiError(val code: String, message: String) : Exception(message) {
  /** True when the fix is in AnyAppAgent (add a key, switch the app on): show AiSetupNotice. */
  val needsSetup: Boolean get() = code in setOf("not_set_up", "app_off", "no_anyappagent", "not_allowed", "bad_key", "no_credit")
}

/** Plain words for a person, for any AiError code or not-ready reason. */
fun aiProblemText(code: String): String = when (code) {
  "not_set_up" -> "AI is not set up: open AnyAppAgent to add a key."
  "app_off" -> "AI is switched off for this app in AnyAppAgent."
  "no_anyappagent" -> "AI needs the AnyAppAgent app on this phone."
  "not_allowed" -> "AnyAppAgent did not let this app use AI."
  "bad_key" -> "The AI key was not accepted. Check it in AnyAppAgent."
  "no_credit" -> "The AI account is out of credit."
  "busy" -> "The AI is busy right now. Try again in a moment."
  "limit" -> "Too many AI requests in a short time. Wait a moment."
  "network" -> "No connection to the AI. Check the internet."
  else -> "The AI could not answer. Try again."
}
