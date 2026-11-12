package expo.modules.appwinautomate

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

/** An exact wake-up fired: run the automation (headless JavaScript), or end a timed Do Not Disturb. */
class TriggerReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Automate.ACTION_DND_RESTORE -> {
        Automate.dndOff(context)
        Log.i(Automate.TAG, "Timed Do Not Disturb ended")
      }
      Automate.ACTION_TRIGGER -> {
        val id = intent.getStringExtra(Automate.EXTRA_ID) ?: return
        val payload = Automate.take(context, id) ?: return
        if (Automate.isStopped(context)) {
          Log.i(Automate.TAG, "Not running $id: Stop all is on")
          return
        }
        val name = try {
          org.json.JSONObject(payload).optString("name", id)
        } catch (e: Exception) {
          id
        }
        AutomateTaskService.start(context, payload, name)
      }
    }
  }
}

/** Android forgets alarms on reboot (and an app update can drop them): re-arm, then let the runtime plan again. */
class AutomateBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Automate.rearmAll(context)
    Automate.rearmDnd(context)
    ListenerService.restart(context)
    Places.rearm(context)
    if (!Automate.isStopped(context)) AutomateTaskService.start(context, "{\"plan\":true}", null)
  }
}

/** Notification buttons: Stop all, and Allow / Don't allow on the ask-before-sending question. */
class ActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Notices.ACTION_STOP_ALL -> {
        Automate.stopAll(context)
        Notices.stoppedNotice(context)
      }
      Notices.ACTION_ANSWER -> {
        val id = intent.getStringExtra("question") ?: return
        Notices.answer(context, id, intent.getStringExtra("answer") ?: "deny")
      }
    }
  }
}

/** Runs one automation in the app's JavaScript while the app is closed, as a short foreground service. */
class AutomateTaskService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val label = intent?.getStringExtra("label")
    val notification = Notices.running(this, label)
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(Notices.RUNNING_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
      } else {
        startForeground(Notices.RUNNING_ID, notification)
      }
    } catch (e: Exception) {
      Log.w(Automate.TAG, "Could not show the running notice", e)
    }
    super.onStartCommand(intent, flags, startId)
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?): com.facebook.react.jstasks.HeadlessJsTaskConfig? {
    val payload = intent?.getStringExtra("payload") ?: return null
    val data = com.facebook.react.bridge.Arguments.createMap()
    data.putString("payload", payload)
    return com.facebook.react.jstasks.HeadlessJsTaskConfig(TASK, data, 120_000, true)
  }

  override fun onTimeout(startId: Int) {
    stopSelf()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  companion object {
    const val TASK = "AppwinAutomateRun"

    fun start(c: Context, payload: String, label: String?) {
      val intent = Intent(c, AutomateTaskService::class.java).putExtra("payload", payload).putExtra("label", label)
      HeadlessJsTaskService.acquireWakeLockNow(c)
      try {
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(intent) else c.startService(intent)
      } catch (e: Exception) {
        Log.w(TAG_START, "Could not start the automation runner", e)
      }
    }

    private const val TAG_START = "AppwinAutomate"
  }
}
