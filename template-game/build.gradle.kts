// Versions for the whole project. A game is two modules (Android Gradle plugin 9 wants this split):
// game/ is a Kotlin Multiplatform library with Compose Multiplatform, app/ is the Android app.
// Kotlin and the Compose compiler plugin must have the same version.
plugins {
  id("com.android.application") version "9.2.1" apply false
  id("com.android.kotlin.multiplatform.library") version "9.2.1" apply false
  id("org.jetbrains.kotlin.multiplatform") version "2.4.21" apply false
  id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
  id("org.jetbrains.compose") version "1.12.2" apply false
}

// The root build/ folder holds Kiwimake's APKs and logs; Gradle's own root output goes below it.
layout.buildDirectory.set(file("build/gradle"))
