# Working on this game

You are making a game for a non-technical person who plays it on their phone. They tell you what
they want in plain words; they never see the code. When your turn ends, Kiwimake builds a signed
**release** APK from this folder and installs it over the version on their phone. If the build
fails, the error comes back to you as your next prompt. **Keep the game building, and check your
work before you finish.**

## This game is meant to move to iPhone and the web later

Games made with Kiwimake run on Android today, and are meant to come to iPhones and the web later
without a rewrite. That only works if the game itself never touches Android. So the project has
two parts, and the line between them is the most important rule here:

- **`game/`, the game itself**: rules, the game loop, drawing, screens, menus, pictures, sounds,
  fonts, texts. Kotlin Multiplatform with Compose Multiplatform. All of it lives in
  `game/src/commonMain` and must stay **platform-free**: the same code will later be built for
  iPhone (`iosArm64`) and the web (`wasmJs`), next to Android.
- **`app/`, the Android app around the game**: shows the game full screen and hands it the phone
  abilities (sound, vibrate, saves, AI) through one small interface, `GameHost`. It also holds
  Kiwimake's parts (shake feedback, updates, Change this app, the crash catcher). Its guide is
  `ANDROID.md` (paths there are from the project root).

Nothing checks this line for you: the Android build happily compiles Android code inside `game/`,
and the game only breaks later, when it moves. Keep to these rules every time:

1. **Never import `android.*`, `java.*`, `javax.*`, `com.google.*`, or Android-only `androidx.*`**
   (`androidx.activity`, `androidx.core`, `androidx.appcompat`, `androidx.lifecycle` from Google)
   anywhere under `game/src/commonMain`. No `R.drawable`, `R.raw`, `Context`, `Log`, `SoundPool`,
   `Vibrator`, `SharedPreferences`, `System.currentTimeMillis`, `Thread`, `java.util.Random`.
2. **Only these libraries in `game/`**, all of which run on Android, iPhone and the web: Compose
   Multiplatform 1.12.2 (`runtime`, `foundation`, `ui`, `components-resources`, the ones already in
   `game/build.gradle.kts`), the Kotlin standard library (`kotlin.math`, `kotlin.random`,
   `kotlin.time`), and if really needed `org.jetbrains.kotlinx` coroutines, serialization or
   datetime, and JetBrains' multiplatform lifecycle and navigation (`org.jetbrains.androidx.*`).
   Add a library to `game/` only when its page says it supports iOS and Wasm, with an exact
   version, under `commonMain.dependencies`. Never Material 3 in `game/` (the menus are drawn by
   the kit); never a library under `androidMain`.
3. **Pictures, sounds, fonts and texts go in `game/src/commonMain/composeResources/`**
   (`drawable/`, `files/`, `font/`, `values/strings.xml`) and load through `Res`
   (`import com.anyapp.game.resources.Res`): `painterResource(Res.drawable.kiwi)`,
   `imageResource(...)`, `Res.readBytes("files/level1.json")`, `Font(Res.font.title)`. Never
   `app/src/main/res` for anything the game shows or plays. File names: lowercase letters, digits
   and underscores.
4. **Anything the phone does goes through `GameHost`** (`game/.../kit/GameHost.kt`): sound,
   vibrate, saves, AI, opening Settings. Need something new from the phone (Bluetooth or Nearby
   play, the camera, sharing a score)? Add a method to `GameHost`, fill it in
   `app/src/main/java/com/anyapp/app/game/AndroidGameHost.kt` (Android code is fine there), and
   add a do-nothing version to `QuietHost`. The game calls only the interface.
5. **Sizes, touch and time the multiplatform way**: sizes from the canvas or `BoxWithConstraints`
   (keep the world in shares of the play area, 0 to 1, so it fits any screen and either way up),
   touch from `Modifier.pointerInput` (`detectTapGestures`, `detectDragGestures`, the kit's touch
   buttons), time from the frame clock (`GameClock`, `withFrameNanos`). Never screen metrics,
   `MotionEvent`, `Handler`, or `Thread.sleep`.
6. **Draw with the Compose canvas** (`Canvas`, `DrawScope`: shapes, paths, images, text). No
   OpenGL, `GLSurfaceView`, `SurfaceView`, Android `Canvas` or `Paint`. 3D, when asked for, is
   drawn on the Compose canvas too (project the points yourself, sort by depth).
7. **The kit and `Game(host, events)` stay the entry points.** `game/.../Game.kt` is what the
   Android app calls today and what the iPhone and web versions will call later: keep its
   signature.

When the person asks for "an iPhone version" or "put it on the web": say it is planned and that
the game is ready for it, but Kiwimake builds Android games only for now (an iPhone build needs a
Mac with Xcode). Do not start that work.

## Layout

```
game/                                  the game (Kotlin Multiplatform; platform-free, see above)
  build.gradle.kts                     the game's targets and libraries (Android today)
  src/commonMain/kotlin/com/anyapp/game/
    Game.kt                            Game(host, events): the entry point; GameInfo.orientation
    starter/KiwiCatch.kt               the starter game: replace it with the person's game
    kit/GameHost.kt                    GameHost (phone abilities), QuietHost, GameEvents, save helpers
    kit/GameClock.kt                   the game loop: GameClock(running) { dt -> ... }
    kit/TouchButtons.kt                on-screen buttons: hold, press, and movable by the player
    kit/Sounds.kt                      rememberSounds("catch", "hit"), sounds.play("catch")
    kit/PauseMenu.kt                   Overlay, PauseMenu, MovingButtonsCard
    kit/GameStyle.kt                   GameColors, GameText, MenuButton: the game's look
  src/commonMain/composeResources/     pictures (drawable/), sounds (files/sounds/), fonts, texts
app/                                   the Android app around the game (ANDROID.md)
  src/main/java/com/anyapp/app/
    MainActivity.kt                    full screen, keeps the screen on, Settings over the game
    game/AndroidGameHost.kt            GameHost on Android: SoundPool, vibrator, saves, AI
    ui/ThisApp.kt                      Settings with "This app" (Change this app): keep it
  src/main/res/values/strings.xml      app_name: the name under the icon
icon.png                               THE launcher icon (1024x1024 PNG; ANDROID.md, "The app icon")
anyapp.json                            written by Kiwimake: preset, slug and package id (read only)
overview.md                            what the person wants the game to be (ANDROID.md explains it)
```

The game's Kotlin package is `com.anyapp.game` (new game code goes under it, in commonMain); the
Android app's is `com.anyapp.app`. Only the installed package id (from `anyapp.json`) differs per
game.

## Check your work (no device needed)

```
./gradlew --console=plain -q :app:compileReleaseKotlin
```

It compiles the game and the Android app (about 20 to 40 s; the first run of the day can take a
few minutes) and prints compiler errors with file and line. Run it before you finish a turn. It
does not catch run time crashes, so read your code for them too.

## Never

- Everything in ANDROID.md's "Never" list holds here too: never change `anyapp.json`,
  `applicationId`, `namespace`, `versionCode` or signing; never run the app, an emulator,
  `installDebug`, `assembleRelease` or `clean`; never stop Gradle daemons; no secrets in the game.
- Never change the versions in the root `build.gradle.kts` (Kotlin, Compose Multiplatform and the
  Android Gradle plugin are chosen to work together).
- Never put game code in `app/` because it is quicker: it would stay behind on Android.
- Never remove the feedback feature, the updater or Change this app (ANDROID.md says where they are).
- **Never use the em dash character (U+2014)** anywhere: not in the game's text, comments, or your
  messages. Use a comma, colon, full stop or parentheses.

## Making the game

Start from what the person asked for and make it **fun first**: quick to start (one tap from
opening to playing), clear goals, instant feedback for every action (a sound, a flash, a buzz, a
number), a difficulty that rises slowly, and a reason to play again (a best score, levels, stars).
Then make it look deliberate: one palette that fits the theme, flat colours, no gradients or glow,
big readable numbers.

- **The loop**: keep the world in a plain class (positions as shares of the play area), update it
  in `GameClock { dt -> }` by speed times `dt`, and bump a `frame` counter (a `mutableIntStateOf`)
  that the `Canvas` reads, so it redraws every frame without recomposing the screen.
- **Touch**: the kit's buttons for held controls (`isDown`) and one-shot actions (`pressed`), taps
  and drags on the scene with `pointerInput`. Touch targets at least 48 dp; keep them clear of the
  corners where the system gestures live. The pause menu's "Move the buttons" lets the player
  place them.
- **Pause**: pause when `LocalGameEvents.current.hidden` turns true, and set `events.wantsBack`
  while playing so the back gesture pauses instead of leaving. Keep a pause button on screen.
- **Saves**: `host.saveInt("best", n)`, `host.loadInt("best", 0)`, `host.save(key, text)` for
  anything else (for lists and levels, a few short strings or JSON text). They survive updates.
- **Sound**: short WAV or OGG files in `composeResources/files/sounds/` (under 100 KB each; you
  can make simple ones with a small script), loaded with `rememberSounds(...)`. Always keep the
  sound switch (the pause menu has it).
- **Which way up**: `GameInfo.orientation` in `Game.kt` (`Any`, `Landscape` or `Portrait`).
  Landscape suits racing, platformers and sports; portrait suits puzzles, cards and endless
  runners that go up.
- **AI** (a quiz master, a talking opponent, puzzles made on the fly): `host.askAi(prompt,
  system)` in a coroutine (`rememberCoroutineScope().launch`), with `GameAiException` caught and
  its message shown. The person sets AI up once in Kiwimake.

### Recipes by kind

- **Arcade** (catch, dodge, shoot, run): the starter's shape. A list of objects with positions and
  speeds, spawn timers that shorten with the score, simple circle or box collisions, lives or a
  timer, a best score.
- **Platformer**: a player with velocity and gravity (`vy += g * dt`), ground and platforms as
  boxes, jump on `pressed("jump")` only when standing, a camera offset that follows the player.
  Landscape, buttons left, right and jump.
- **Puzzle** (match, slide, connect, sort): the board as a grid of numbers in a plain class, tap or
  drag to act, a move checks and changes the board, then short animations (`animateFloatAsState`
  or a time value in the world) show it. Levels as small text maps in
  `composeResources/files/levels/`, progress saved per level.
- **Board** (chess-like, connect four, ludo): the board and rules in pure Kotlin functions (easy to
  check), a computer opponent as a simple search (minimax for small boards) run with
  `withContext(Dispatchers.Default)` from kotlinx coroutines, pass and play on one phone first.
- **Cards** (solitaire, memory, snap): a `Card` data class, the deck shuffled with `kotlin.random`,
  cards drawn as rounded rectangles with text or pictures, drag to move with snapping, an undo
  list.
- **Two players on one phone**: split the screen, each half its own buttons (the kit's buttons
  work with several fingers at once).

The starter game (`starter/KiwiCatch.kt`) shows each part working together. Replace it with the
person's game (delete it once nothing uses it), and keep the kit.
