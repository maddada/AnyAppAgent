package expo.modules.anyappdiary

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/** Native side of src/lib/diary.ts and src/lib/crash.ts. Use those, not this. */
class AnyappDiaryModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AnyappDiary")

    OnCreate {
      appContext.reactContext?.let { CrashCatcher.install(it) }
    }

    Function("note") { text: String ->
      Diary.note(context, text)
    }

    Function("read") { max: Int ->
      Diary.read(context, max.coerceIn(1, Diary.KEEP)).toString()
    }

    /** report: JSON {kind, message, stack?, screen?}. fatal: the app is about to close. */
    Function("report") { report: String, fatal: Boolean ->
      if (fatal) CrashCatcher.lastJsReportAt = System.currentTimeMillis()
      CrashCatcher.sendReport(context, JSONObject(report))
    }
  }
}
