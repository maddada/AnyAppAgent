// Versions for the whole project. Kotlin 2.2.10 is built into the Android Gradle plugin 9.2.1;
// the Compose compiler plugin must have the same version as Kotlin.
plugins {
  id("com.android.application") version "9.2.1" apply false
  id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
}

// The root build/ folder holds Kiwimake's APKs and logs; Gradle's own root output goes below it.
layout.buildDirectory.set(file("build/gradle"))
