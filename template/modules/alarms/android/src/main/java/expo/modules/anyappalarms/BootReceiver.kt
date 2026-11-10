package expo.modules.anyappalarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Android forgets alarms on reboot; this re-arms the stored ones. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Log.i(AlarmScheduler.TAG, "Re-arming alarms after ${intent.action}")
    AlarmScheduler.rescheduleAll(context)
  }
}
