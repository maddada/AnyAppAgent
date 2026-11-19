// The game: Kotlin Multiplatform with Compose Multiplatform. Today it is built for Android only.
// Games are meant to move to iPhone and the web later: then iosArm64(), iosSimulatorArm64() and
// wasmJs { browser() } are added below, and the code in src/commonMain must already run there.
// So commonMain uses only the libraries listed here (see AGENTS.md, "Ready for iPhone and the web").
plugins {
  id("org.jetbrains.kotlin.multiplatform")
  id("com.android.kotlin.multiplatform.library")
  id("org.jetbrains.kotlin.plugin.compose")
  id("org.jetbrains.compose")
}

kotlin {
  android {
    namespace = "com.anyapp.game"
    compileSdk = 37
    minSdk = 26
    // Pictures, sounds and fonts in src/commonMain/composeResources reach the APK this way.
    androidResources { enable = true }
  }

  sourceSets {
    commonMain.dependencies {
      implementation("org.jetbrains.compose.runtime:runtime:1.12.2")
      implementation("org.jetbrains.compose.foundation:foundation:1.12.2")
      implementation("org.jetbrains.compose.ui:ui:1.12.2")
      implementation("org.jetbrains.compose.components:components-resources:1.12.2")
    }
  }
}

compose.resources {
  packageOfResClass = "com.anyapp.game.resources"
}
