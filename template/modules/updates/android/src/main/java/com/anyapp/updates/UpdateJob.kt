package com.anyapp.updates

import android.app.job.JobParameters
import android.app.job.JobService

/** The daily background check (AppUpdater). Same file in every Kiwimake template. */
class UpdateJob : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    Thread {
      runCatching { AppUpdater.checkAndNotify(applicationContext) }
      jobFinished(params, false)
    }.start()
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean = true
}
