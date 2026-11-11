package expo.modules.anyappabilities

import android.content.Context
import android.util.Log
import com.anyapp.abilities.AbilityAction
import com.anyapp.abilities.ActionRunner
import com.anyapp.abilities.Actions
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/**
 * Runs an action with the app's JavaScript (the handler from onAction in modules/abilities), as a
 * React Native headless task: it starts the JavaScript without showing the app when the app is
 * closed, and runs in the same JavaScript when the app is open.
 */
class JsActionRunner : ActionRunner {
  override fun run(context: Context, action: AbilityAction, done: (message: String?) -> Unit) {
    UiThreadUtil.runOnUiThread {
      val host = (context.applicationContext as? ReactApplication)?.reactHost
      if (host == null) {
        Log.w(Actions.TAG, "No React host; cannot run ${action.name}")
        done(null)
        return@runOnUiThread
      }
      val current = host.currentReactContext
      if (current != null && current.hasActiveReactInstance()) start(current, action, done)
      else {
        host.addReactInstanceEventListener(object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            host.removeReactInstanceEventListener(this)
            UiThreadUtil.runOnUiThread { start(context, action, done) }
          }
        })
        host.start()
      }
    }
  }

  private fun start(context: ReactContext, action: AbilityAction, done: (String?) -> Unit) {
    val tasks = HeadlessJsTaskContext.getInstance(context)
    val data = Arguments.createMap().apply {
      putString("name", action.name)
      putString("source", action.source)
      putString("from", action.from)
      putString("data", action.data.toString())
    }
    var taskId = -1
    tasks.addTaskEventListener(object : HeadlessJsTaskEventListener {
      override fun onHeadlessJsTaskStart(id: Int) = Unit
      override fun onHeadlessJsTaskFinish(id: Int) {
        if (id != taskId) return
        tasks.removeTaskEventListener(this)
        done(AnyappAbilitiesModule.takeMessage())
      }
    })
    taskId = tasks.startTask(HeadlessJsTaskConfig(TASK, data, 20_000, true))
  }

  companion object {
    const val TASK = "AnyappAction"
  }
}
