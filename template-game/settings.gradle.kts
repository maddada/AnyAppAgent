pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "anyapp"
// game: the game itself (Kotlin Multiplatform, Android today, iPhone and the web later).
// app: the Android app around it (the APK Kiwimake builds and installs).
include(":game", ":app")
