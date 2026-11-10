package expo.modules.anyappalarms

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JavaScript API: see modules/alarms/index.ts. */
class AnyappAlarmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AnyappAlarms")

    AsyncFunction("schedule") { alarm: AlarmRecord ->
      val data = AlarmData.fromRecord(alarm)
      val exact = AlarmScheduler.schedule(context, data)
      mapOf("id" to data.id, "exact" to exact)
    }

    AsyncFunction("cancel") { id: String ->
      AlarmScheduler.cancel(context, id)
    }

    AsyncFunction("cancelAll") {
      AlarmScheduler.cancelAll(context)
    }

    AsyncFunction("getAll") {
      AlarmStore.all(context).map { it.toMap() }
    }

    AsyncFunction("fireNow") { alarm: AlarmRecord ->
      AlarmReceiver.fire(context, AlarmData.fromRecord(alarm))
    }

    Function("canScheduleExactAlarms") {
      AlarmScheduler.canScheduleExact(context)
    }

    AsyncFunction("openExactAlarmSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + context.packageName))
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }
}
