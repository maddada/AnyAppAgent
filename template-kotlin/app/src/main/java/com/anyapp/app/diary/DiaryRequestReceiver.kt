package com.anyapp.app.diary

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Kiwimake asks for the diary (the app's agent on the PC wants to read it). The answer goes
 * only to the app that installed this one, so asking is harmless: nobody else ever gets the diary.
 */
class DiaryRequestReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_REQUEST) return
    val requestId = intent.getStringExtra("requestId") ?: return
    val target = CrashCatcher.installer(context) ?: return
    context.sendBroadcast(
      Intent(ACTION_DIARY)
        .setPackage(target)
        .putExtra("requestId", requestId.take(100))
        .putExtra("diary", Diary.read(context, Diary.KEEP).toString())
        .putExtra("sender", CrashCatcher.sender(context)),
    )
  }

  companion object {
    const val ACTION_REQUEST = "com.anyapp.action.DIARY_REQUEST"
    const val ACTION_DIARY = "com.anyappagent.action.DIARY"
  }
}
