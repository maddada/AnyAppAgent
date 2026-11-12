package com.anyappagent.ai

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Everything "AI for your apps" keeps on the phone, all in Kiwimake's private storage:
 * - the AI key, encrypted with an AES-256-GCM key that lives in the Android Keystore (it cannot be
 *   read out of the phone, and the encrypted key is useless anywhere else),
 * - the provider and model,
 * - per app: on/off and usage (calls, tokens),
 * - the signing certificates of apps Kiwimake installed (AiTrust.kt).
 */
object AiStore {
  private const val PREFS = "anyapp_ai"
  private const val KEY_ALIAS = "anyapp_ai_key_v1"

  const val ANTHROPIC = "anthropic"
  const val OPENROUTER = "openrouter"

  /** Sensible defaults per provider; the user can change the model in Settings. */
  fun defaultModel(provider: String): String =
    if (provider == OPENROUTER) "anthropic/claude-opus-5.5" else "claude-opus-5-5"

  /** Claude keys start with sk-ant-, OpenRouter keys with sk-or-. Null when it cannot tell. */
  fun detectProvider(key: String): String? = when {
    key.startsWith("sk-ant-") -> ANTHROPIC
    key.startsWith("sk-or-") -> OPENROUTER
    else -> null
  }

  private fun prefs(ctx: Context): SharedPreferences = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private val lock = Any()

  // ---- the key ----

  data class Config(val provider: String, val model: String, val hint: String, val savedAt: Long)

  fun config(ctx: Context): Config? {
    val p = prefs(ctx)
    if (!p.contains("key")) return null
    val provider = p.getString("provider", ANTHROPIC) ?: ANTHROPIC
    return Config(provider, p.getString("model", null) ?: defaultModel(provider), p.getString("hint", "") ?: "", p.getLong("savedAt", 0))
  }

  /** The key in clear text, only for building a request inside this process. */
  fun readKey(ctx: Context): String? {
    val blob = prefs(ctx).getString("key", null) ?: return null
    return try {
      val (iv, ct) = blob.split(":").map { Base64.decode(it, Base64.NO_WRAP) }
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
      String(c.doFinal(ct), Charsets.UTF_8)
    } catch (_: Exception) {
      null // keystore key gone (e.g. restored onto another phone): treat as not set up
    }
  }

  fun saveKey(ctx: Context, key: String, provider: String, model: String?) {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, secretKey())
    val blob = Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(c.doFinal(key.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    prefs(ctx).edit()
      .putString("key", blob)
      .putString("provider", provider)
      .putString("model", model?.takeIf { it.isNotBlank() }?.trim() ?: defaultModel(provider))
      .putString("hint", key.takeLast(4))
      .putLong("savedAt", System.currentTimeMillis())
      .apply()
  }

  fun setModel(ctx: Context, model: String?) {
    val cfg = config(ctx) ?: return
    prefs(ctx).edit().putString("model", model?.takeIf { it.isNotBlank() }?.trim() ?: defaultModel(cfg.provider)).apply()
  }

  fun removeKey(ctx: Context) {
    prefs(ctx).edit().remove("key").remove("provider").remove("model").remove("hint").remove("savedAt").apply()
    try {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(KEY_ALIAS)
    } catch (_: Exception) {
    }
  }

  private fun secretKey(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }

  // ---- apps: on/off and usage ----

  data class AppRecord(
    val packageName: String,
    val enabled: Boolean,
    val calls: Long,
    val inputTokens: Long,
    val outputTokens: Long,
    val lastUsed: Long,
    val refused: Long,
  )

  private fun appKey(pkg: String) = "app:$pkg"

  fun app(ctx: Context, pkg: String): AppRecord {
    val raw = prefs(ctx).getString(appKey(pkg), null)
    val j = if (raw != null) JSONObject(raw) else JSONObject()
    return AppRecord(
      pkg,
      j.optBoolean("enabled", true),
      j.optLong("calls"),
      j.optLong("in"),
      j.optLong("out"),
      j.optLong("last"),
      j.optLong("refused"),
    )
  }

  private fun put(ctx: Context, r: AppRecord) {
    val j = JSONObject()
      .put("enabled", r.enabled)
      .put("calls", r.calls)
      .put("in", r.inputTokens)
      .put("out", r.outputTokens)
      .put("last", r.lastUsed)
      .put("refused", r.refused)
    prefs(ctx).edit().putString(appKey(r.packageName), j.toString()).apply()
  }

  fun apps(ctx: Context): List<AppRecord> =
    prefs(ctx).all.keys.filter { it.startsWith("app:") }.map { app(ctx, it.removePrefix("app:")) }.sortedByDescending { it.lastUsed }

  /** Makes sure the app shows in Settings (so it can be switched off) from its first contact. */
  fun touch(ctx: Context, pkg: String) = synchronized(lock) {
    if (!prefs(ctx).contains(appKey(pkg))) put(ctx, app(ctx, pkg))
  }

  fun setEnabled(ctx: Context, pkg: String, enabled: Boolean) = synchronized(lock) { put(ctx, app(ctx, pkg).copy(enabled = enabled)) }

  fun countCall(ctx: Context, pkg: String) = synchronized(lock) {
    val r = app(ctx, pkg)
    put(ctx, r.copy(calls = r.calls + 1, lastUsed = System.currentTimeMillis()))
  }

  fun countTokens(ctx: Context, pkg: String, input: Long, output: Long) = synchronized(lock) {
    if (input == 0L && output == 0L) return@synchronized
    val r = app(ctx, pkg)
    put(ctx, r.copy(inputTokens = r.inputTokens + input, outputTokens = r.outputTokens + output, lastUsed = System.currentTimeMillis()))
  }

  fun countRefused(ctx: Context, pkg: String) = synchronized(lock) {
    val r = app(ctx, pkg)
    put(ctx, r.copy(refused = r.refused + 1))
  }

  fun forgetApp(ctx: Context, pkg: String) = synchronized(lock) { prefs(ctx).edit().remove(appKey(pkg)).apply() }

  // ---- signing certificates of apps Kiwimake installed (SHA-256, hex) ----

  fun trustedSigners(ctx: Context): Set<String> = prefs(ctx).getStringSet("signers", emptySet()) ?: emptySet()

  fun addTrustedSigner(ctx: Context, digest: String) = synchronized(lock) {
    val now = trustedSigners(ctx)
    if (digest !in now) prefs(ctx).edit().putStringSet("signers", now + digest).apply()
  }
}
