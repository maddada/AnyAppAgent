package com.anyappagent.ai

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * What Kiwimake's own Settings screen uses for "AI for your apps". The key goes in once and
 * is never handed back to JavaScript: only the provider, the model and the key's last 4 characters.
 */
class AnyAppAiModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("No context")

  override fun definition() = ModuleDefinition {
    Name("AnyAppAi")

    Function("getConfig") {
      val cfg = AiStore.config(context) ?: return@Function null
      mapOf(
        "provider" to cfg.provider,
        "model" to cfg.model,
        "defaultModel" to AiStore.defaultModel(cfg.provider),
        "hint" to cfg.hint,
        "savedAt" to cfg.savedAt.toDouble(),
        "testServer" to (AiCall.testServer() != null),
      )
    }

    Function("detectProvider") { key: String -> AiStore.detectProvider(key.trim()) }

    Function("defaultModel") { provider: String -> AiStore.defaultModel(provider) }

    Function("save") { key: String, provider: String?, model: String? ->
      val k = key.trim()
      if (k.length < 8) throw CodedException("BAD_KEY", "That does not look like a key.", null)
      val p = provider ?: AiStore.detectProvider(k) ?: throw CodedException("NO_PROVIDER", "Choose Claude or OpenRouter.", null)
      if (p != AiStore.ANTHROPIC && p != AiStore.OPENROUTER) throw CodedException("NO_PROVIDER", "Choose Claude or OpenRouter.", null)
      AiStore.saveKey(context, k, p, model)
      true
    }

    Function("setModel") { model: String? -> AiStore.setModel(context, model) }

    Function("remove") { AiStore.removeKey(context) }

    /** One real, tiny call with the saved key. */
    AsyncFunction("test") { promise: Promise ->
      val ctx = context
      thread(name = "anyapp-ai-test") {
        val cfg = AiStore.config(ctx)
        val key = AiStore.readKey(ctx)
        if (cfg == null || key == null) {
          promise.resolve(mapOf("ok" to false, "code" to "not_set_up", "message" to "No key saved."))
          return@thread
        }
        val req = JSONObject()
          .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "Reply with the word OK.")))
        val call = AiCall(cfg.provider, cfg.model, key, req, 64) {}
        try {
          call.run()
          promise.resolve(mapOf("ok" to true, "model" to cfg.model, "testServer" to (AiCall.testServer() != null)))
        } catch (e: AiCall.Failure) {
          promise.resolve(mapOf("ok" to false, "code" to e.code, "message" to e.message))
        } catch (e: Exception) {
          promise.resolve(mapOf("ok" to false, "code" to "internal", "message" to "Something went wrong."))
        }
      }
    }

    Function("apps") {
      val ctx = context
      AiStore.apps(ctx).map {
        val label = AiTrust.label(ctx, it.packageName)
        mapOf(
          "packageName" to it.packageName,
          "label" to (label ?: it.packageName),
          "installed" to (label != null),
          "enabled" to it.enabled,
          "calls" to it.calls.toDouble(),
          "inputTokens" to it.inputTokens.toDouble(),
          "outputTokens" to it.outputTokens.toDouble(),
          "lastUsed" to it.lastUsed.toDouble(),
          "refused" to it.refused.toDouble(),
        )
      }
    }

    Function("setAppEnabled") { pkg: String, enabled: Boolean -> AiStore.setEnabled(context, pkg, enabled) }

    Function("forgetApp") { pkg: String -> AiStore.forgetApp(context, pkg) }
  }
}
