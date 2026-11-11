import groovy.json.JsonSlurper

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.plugin.compose")
}

// anyapp.json is written by AnyAppAgent: the app's package id, which never changes (a different
// id would be a different app that cannot update the one on the phone).
@Suppress("UNCHECKED_CAST")
val anyapp = JsonSlurper().parse(rootProject.file("anyapp.json")) as Map<String, Any?>

android {
  // The Kotlin package of the code. It stays com.anyapp.app in every app (only applicationId differs).
  namespace = "com.anyapp.app"
  compileSdk = 37

  defaultConfig {
    applicationId = anyapp["package"] as String
    minSdk = 26
    targetSdk = 36
    // AnyAppAgent sets versionCode to the build number and signs every build with the same key.
    versionCode = 1
    versionName = "1.0"
  }

  buildTypes {
    release {
      // R8 shrinks the app to a few MB. Keep rules for reflection go in proguard-rules.pro.
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  buildFeatures {
    compose = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  packaging {
    resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "DebugProbesKt.bin", "kotlin-tooling-metadata.json")
  }
}

dependencies {
  implementation(platform("androidx.compose:compose-bom:2026.09.00"))
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.activity:activity-compose:1.13.0")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
  implementation("androidx.core:core-ktx:1.19.1")
}
