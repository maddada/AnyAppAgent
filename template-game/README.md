# Kiwimake game starter

The starter every game is made from (the "Game" preset). A game is the Kotlin starter
(`../template-kotlin`: the Android app with feedback, updates, Change this app, AI and the diary)
with this folder copied on top by `builder/` (`createApp({ preset: 'game' })`):

- `game/`: the game itself, a Kotlin Multiplatform module with Compose Multiplatform 1.12.2. It is
  built for Android today and written so it can be built for iPhone and the web later (the rules
  are in `AGENTS.md`, "This game is meant to move to iPhone and the web later").
- `app/`: replaces the Kotlin starter's `MainActivity.kt`, `build.gradle.kts` (it depends on
  `:game`) and `AndroidManifest.xml` (one line differs: the activity keeps running when the phone
  turns), and adds `game/AndroidGameHost.kt`.
- `settings.gradle.kts` and `build.gradle.kts`: the two modules, Kotlin 2.4.21, the Android
  Gradle plugin 9.2.1 (its multiplatform library plugin for `game/`).
- `AGENTS.md`: the game's guide for its agent. The Kotlin starter's `AGENTS.md` is copied in as
  `ANDROID.md` (the guide to the Android app around the game); its `ui/HomeScreen.kt` and
  `README.md` are left out (`GAME_FROM_KOTLIN` in `builder/lib/presets.mjs`).

The game kit (`game/src/commonMain/kotlin/com/anyapp/game/kit/`): `GameHost` (sound, vibrate,
saves, AI, Settings), `GameClock` (the frame loop), `TouchButtons` (held and pressed, movable by
the player, places saved), `Sounds`, `PauseMenu`, `GameStyle`. The starter game is Kiwi Catch
(`starter/KiwiCatch.kt`).

Builds are full Gradle builds like Kotlin apps (no quick updates). `__APP_SLUG__` and
`__APP_PACKAGE__` in `anyapp.json`, and `__APP_NAME__` in the Kotlin starter's `strings.xml`, are
filled in by `createApp`. Sounds in `composeResources/files/sounds/` were made with a small script
(sine and square tones, a noise burst), so they carry no license terms.
