package com.anyapp.app

import android.app.Application
import com.anyapp.app.diary.CrashCatcher

/** The app process: catches crashes from the very start (diary/CrashCatcher.kt). Keep it. */
class AnyApp : Application() {
  override fun onCreate() {
    super.onCreate()
    CrashCatcher.install(this)
  }
}
