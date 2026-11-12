package expo.modules.anyappai

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * AI through Kiwimake. This app never has an AI key: Kiwimake (com.anyappagent) keeps the
 * user's key and runs a local service that apps made with it bind to. This module sends the
 * chat request there and passes the streamed answer to JavaScript as `onEvent` events.
 * JavaScript API: src/lib/ai.ts. Wire format: modules/ai/README.md.
 */
class AnyappAiModule : Module() {
  companion object {
    const val AGENT_PACKAGE = "com.anyappagent"
    const val ACTION = "com.anyappagent.action.AI"

    // Same numbers as Kiwimake's AiProxyService.
    const val STATUS = 1
    const val CHAT = 2
    const val CANCEL = 3
    const val STATUS_REPLY = 101
    const val EVENT = 102

    const val CHUNK = 200_000 // characters per message, well under the Binder limit
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val thread = HandlerThread("anyapp-ai-client").apply { start() }
  private val handler = Handler(thread.looper)

  // All state below is touched only on `thread`.
  private var service: Messenger? = null
  private var binding = false
  private var bound = false
  private val waiting = ArrayList<(Messenger?) -> Unit>()
  private val statusWaiters = ArrayList<Promise>()
  private val live = HashSet<String>()

  private val replies = Messenger(object : Handler(thread.looper) {
    override fun handleMessage(msg: Message) {
      val data = msg.data ?: return
      when (msg.what) {
        STATUS_REPLY -> {
          val json = data.getString("json") ?: "{}"
          statusWaiters.toList().forEach { it.resolve(json) }
          statusWaiters.clear()
        }
        EVENT -> {
          val id = data.getString("id") ?: return
          val json = data.getString("json") ?: return
          val type = try {
            JSONObject(json).optString("type")
          } catch (_: Exception) {
            ""
          }
          if (type == "done" || type == "error") live.remove(id)
          sendEvent("onEvent", mapOf("id" to id, "json" to json))
        }
      }
    }
  })

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      handler.post {
        binding = false
        service = binder?.let { Messenger(it) }
        val w = waiting.toList()
        waiting.clear()
        w.forEach { it(service) }
      }
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      // Kiwimake stopped or was updated: answers in progress are lost.
      handler.post {
        service = null
        failAll("disconnected", "Kiwimake stopped while answering. Try again.")
      }
    }

    override fun onBindingDied(name: ComponentName?) {
      handler.post {
        unbind()
        failAll("disconnected", "Kiwimake was updated or stopped. Try again.")
      }
    }

    override fun onNullBinding(name: ComponentName?) {
      handler.post { unbind() }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("AnyappAi")

    Events("onEvent")

    /** Resolves a JSON string: { ready, reason?, provider?, model? }. */
    AsyncFunction("status") { promise: Promise ->
      handler.post {
        withService { s ->
          if (s == null) {
            promise.resolve(JSONObject().put("ready", false).put("reason", if (agentInstalled()) "not_reachable" else "no_anyappagent").toString())
            return@withService
          }
          statusWaiters.add(promise)
          val ok = send(s, STATUS, Bundle())
          if (!ok) {
            statusWaiters.remove(promise)
            promise.resolve(JSONObject().put("ready", false).put("reason", "not_reachable").toString())
          } else {
            handler.postDelayed({
              if (statusWaiters.remove(promise)) promise.resolve(JSONObject().put("ready", false).put("reason", "not_reachable").toString())
            }, 8000)
          }
        }
      }
    }

    /** Starts one chat request; its events arrive as onEvent { id, json }. */
    AsyncFunction("start") { id: String, request: String ->
      handler.post {
        live.add(id)
        withService { s ->
          if (s == null) {
            val code = if (agentInstalled()) "not_reachable" else "no_anyappagent"
            val msg = if (code == "no_anyappagent") "AI needs Kiwimake on this phone." else "Could not reach Kiwimake. Open it once and try again."
            emitError(id, code, msg)
            return@withService
          }
          var i = 0
          var ok = true
          do {
            val end = minOf(request.length, i + CHUNK)
            ok = send(s, CHAT, Bundle().apply {
              putString("id", id)
              putString("chunk", request.substring(i, end))
              putBoolean("last", end >= request.length)
            })
            i = end
          } while (ok && i < request.length)
          if (!ok) emitError(id, "not_reachable", "Could not reach Kiwimake. Try again.")
        }
      }
      true
    }

    Function("cancel") { id: String ->
      handler.post {
        service?.let { send(it, CANCEL, Bundle().apply { putString("id", id) }) }
      }
    }

    Function("isAgentInstalled") { agentInstalled() }

    /** Opens Kiwimake's settings, where the AI key is added and each app switched on or off. */
    Function("openSetup") {
      val ctx = context
      val deep = Intent(Intent.ACTION_VIEW, Uri.parse("anyappagent://settings")).setPackage(AGENT_PACKAGE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(deep)
        true
      } catch (_: Exception) {
        val launch = ctx.packageManager.getLaunchIntentForPackage(AGENT_PACKAGE)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (launch != null) {
          try {
            ctx.startActivity(launch)
            true
          } catch (_: Exception) {
            false
          }
        } else {
          false
        }
      }
    }

    OnDestroy {
      handler.post {
        unbind()
        thread.quitSafely()
      }
    }
  }

  private fun agentInstalled(): Boolean = try {
    context.packageManager.getPackageInfo(AGENT_PACKAGE, 0)
    true
  } catch (_: Exception) {
    false
  }

  /** Runs `then` on `thread` with the bound service, binding first if needed (null = cannot bind). */
  private fun withService(then: (Messenger?) -> Unit) {
    service?.let { return then(it) }
    waiting.add(then)
    if (binding) return
    binding = true
    val ok = try {
      context.bindService(Intent(ACTION).setPackage(AGENT_PACKAGE), connection, Context.BIND_AUTO_CREATE)
    } catch (_: Exception) {
      false
    }
    bound = ok
    if (!ok) {
      binding = false
      try {
        context.unbindService(connection)
      } catch (_: Exception) {
      }
      val w = waiting.toList()
      waiting.clear()
      w.forEach { it(null) }
      return
    }
    handler.postDelayed({
      if (binding) {
        binding = false
        unbind()
        val w = waiting.toList()
        waiting.clear()
        w.forEach { it(null) }
      }
    }, 10_000)
  }

  private fun unbind() {
    if (bound) {
      try {
        context.unbindService(connection)
      } catch (_: Exception) {
      }
    }
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

  private fun failAll(code: String, message: String) {
    live.toList().forEach { emitError(it, code, message) }
    live.clear()
    statusWaiters.toList().forEach { it.resolve(JSONObject().put("ready", false).put("reason", "not_reachable").toString()) }
    statusWaiters.clear()
  }

  private fun emitError(id: String, code: String, message: String) {
    live.remove(id)
    sendEvent("onEvent", mapOf("id" to id, "json" to JSONObject().put("type", "error").put("code", code).put("message", message).toString()))
  }
}
