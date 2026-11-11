# Working on this app

You are changing an Android app for a non-technical person who uses it on their phone. They tell
you what they want in plain words; they never see the code. When your turn ends, AnyAppAgent
builds a signed **release** APK from this folder and installs it over the version on their phone.
If the build fails, the error comes back to you as your next prompt. **Keep the app building, and
check your work before you finish.**

Stack: a native Android app. Kotlin 2.2 (built into the Android Gradle plugin 9.2.1), Jetpack
Compose with Material 3 (Compose BOM 2026.09.00), one activity, no XML layouts. compileSdk 37,
targetSdk 36, minSdk 26 (Android 8.0). Release builds are shrunk with R8, so the APK is a few MB.
When unsure of an API, read the sources and docs of these exact versions (Gradle caches the
library sources under `%USERPROFILE%\.gradle\caches`), not memory.

## Layout

```
app/src/main/java/com/anyapp/app/
  MainActivity.kt          the activity, the theme and the screen switch (Route, Nav): add screens here
  ui/HomeScreen.kt         the starter screen: replace it
  ui/Components.kt         Screen (safe area + scroll), Card, PrimaryButton, QuietButton: reuse them
  ui/theme/Theme.kt        colours (light + dark), type scale, spacing, radius: the app's look
  data/Store.kt            persistent storage: rememberStored(...) and Store.get/put
  notify/Notifications.kt  notification permission and notifyNow
  alarms/Alarms.kt         exact alarms with sound + spoken text, work while the app is closed
  alarms/*.kt              the machinery behind Alarms.kt (leave it unless a feature needs it)
app/src/main/AndroidManifest.xml   permissions, the activity, the alarm receivers and service
app/src/main/res/values/strings.xml   app_name: the name under the icon
app/src/main/res/raw/      sound files for alarms (adhan.mp3, beep.ogg, ...)
app/build.gradle.kts       dependencies and Android settings
icon.png                   THE launcher icon (1024x1024 PNG)
scripts/make-icon.mjs      makes icon.png from a colour and a glyph or letter
anyapp.json                written by AnyAppAgent: preset, slug and package id (read only)
```

The Kotlin package of the code is `com.anyapp.app` in every app; only the installed package id
(from `anyapp.json`) differs. Keep new code under `com.anyapp.app`.

## Never

- Never change `anyapp.json`, `applicationId`, `namespace`, `versionCode`, or anything about
  signing. AnyAppAgent sets the version code to the build number and signs every build with the
  same key; a different package id would be a different app that cannot update the one on the
  phone.
- Never run the app, an emulator, `installDebug`, `assembleRelease` or `clean`, and never stop
  Gradle daemons (`gradlew --stop`): the builder does the real build and other apps share the
  daemon.
- Never add a library you do not need. Each one makes the app bigger and the build slower. Prefer
  what Android and Compose already have. If you must, add one line to `dependencies` in
  `app/build.gradle.kts` with an exact version that exists on Google Maven or Maven Central, and
  keep Compose libraries under the BOM (no version).
- Never put secrets or keys in the app.

You may change `app_name` in `strings.xml` when the user asks to rename the app.

## Check your work (no device needed)

```
./gradlew --console=plain -q :app:compileReleaseKotlin      # Git Bash (or .\gradlew.bat in PowerShell)
```

It compiles the Kotlin in about 20 s (the first run of the day can take a minute) and prints
compiler errors with file and line. Run it before you finish a turn. It does not catch run time
crashes, so read your code for them too (null values, missing permissions, work on the main
thread, a state read before it is loaded).

## Words in the app

- **Never use the em dash character (U+2014) anywhere**: not in UI text, notifications, spoken
  text, comments, or your messages. Use a comma, colon, full stop or parentheses instead.
- Short, friendly, plain words; no technical terms in anything the user sees.

## Design: the user's taste (follow it)

The user said: "no purple gradients or AI slop please". So, in every app:

- **No purple gradients, and no gradients as decoration at all.** Flat colour, hairlines, space.
- **No sparkle, magic wand, stars or "AI" icons**, and no "magical" wording.
- **No generic AI look**: no glowing cards, glassmorphism, neon, emoji as decoration, big
  rounded hero banners, or the same purple-blue template every app has. Material 3's default
  purple and its tonal surfaces are not the look: the theme maps Material to our palette.
- **Design each app for what it is for.** A prayer-time app, a shopping list and a workout timer
  should not look alike. Choose an accent, an icon and a layout that fit the subject (and its
  culture: a prayer app might use a calm deep green or ink colour and clear, large times).
- **Calm and well made**: good typography with a clear hierarchy (one large title per screen,
  then headings, body, small labels), generous spacing, one restrained accent colour used
  sparingly, and light and dark both looking deliberate.
- No em dashes (see above).

How: everything visual comes from `ui/theme/Theme.kt`. Use `AppTheme.colors` (`background`,
`surface`, `surfaceMuted`, `border`, `text`, `textMuted`, `textFaint`, `accent`, `onAccent`,
`accentSoft`, `success`, `warning`, `danger`), `AppType` (`display`, `title`, `heading`, `body`,
`bodyStrong`, `small`, `label`, `numeric`), `Spacing` and `Radius`, never hard-coded colours, so
dark mode works. Material 3 components (`Switch`, `Slider`, `OutlinedTextField`, `AlertDialog`,
`TimePicker`, ...) take their colours from the same palette. To give the app its character,
change `accent` (and, if fitting, `background`) in BOTH `LightColors` and `DarkColors` first, and
`window_background` in `res/values*/colors.xml` to match `background`. Big touch targets (48 dp
or more), short labels, one main action per screen. Icons: draw simple ones with
`androidx.compose.material.icons` only if you add `androidx.compose.material:material-icons-core`
(it is small; avoid `material-icons-extended`, it is huge), used sparingly in `textMuted` or
`accent`. Wrap every screen in `Screen { }` so content stays clear of the status bar, the gesture
bar and the keyboard (the app is edge to edge). The starter screen (`ui/HomeScreen.kt`) shows the
intended level of care.

## Built-in capabilities

The permissions for these are declared in `AndroidManifest.xml` and nothing needs installing.

### Screens and navigation

```kotlin
// MainActivity.kt
enum class Route { Home, Settings }
...
when (nav.current) {
  Route.Home -> HomeScreen(onOpenSettings = { nav.go(Route.Settings) })
  Route.Settings -> SettingsScreen(onBack = { nav.back() })
}
```

The system back gesture goes back automatically. For tabs, use a `NavigationBar` on one screen.

### Persistent storage

```kotlin
import com.anyapp.app.data.Store
import com.anyapp.app.data.rememberStored

var offset by rememberStored("offset", 10)          // Int, Long, Boolean, Float or String; saved on change
val items = Store.getJsonArray(context, "items")      // org.json for lists and objects
Store.putJsonArray(context, "items", JSONArray(list))
```

Data survives restarts and app updates (it is wiped only if the app is uninstalled). Keep each
value under ~1 MB. For a long list of records, keep them as one JSON array.

### Alarms that ring, speak and survive the app being closed (exact, reboot-proof)

Use these for anything time-critical: alarms, prayer times, medication, timers. They use Android's
`setAlarmClock` (never delayed by battery saving), fire while the app is closed or swiped away,
are re-armed after a reboot, show a notification, then play `sound` and speak `speak` aloud on the
alarm volume.

```kotlin
import com.anyapp.app.alarms.Alarm
import com.anyapp.app.alarms.Alarms

Alarms.schedule(context, Alarm(
  id = "fajr-2026-11-11",              // your stable id; same id = replace
  at = millis,                         // epoch milliseconds (java.time: ZonedDateTime...toInstant().toEpochMilli())
  title = "Fajr in 10 minutes",
  body = "Time to get ready",          // optional, defaults to speak
  speak = "Fajr prayer is in ten minutes", // optional, text to speech
  language = "en-US",                  // optional BCP-47; default = phone language
  sound = "adhan",                     // optional: plays res/raw/adhan.mp3 first
  daily = false,                       // true: same time every day
  fullScreen = true,                   // default true (see below)
))
Alarms.cancel(context, "fajr-2026-11-11")
val pending = Alarms.scheduled(context)          // soonest first
Alarms.testNow(context, Alarm(id = "test", at = System.currentTimeMillis(), title = "Test", speak = "This is a test"))
```

- Ask for the notification permission first (below), for example on first launch.
- Alarms are one-shot unless `daily = true`. For times that change every day (prayer times,
  sunrise), schedule the next several days (e.g. 7) whenever the app opens or settings change,
  using ids that include the date, and cancel the old ones first. Keep the total under ~400.
- Sound files: put `name.mp3` (or .ogg/.wav) in `app/src/main/res/raw/`, lowercase letters,
  digits and underscores only, and pass `sound = "name"`.
- `fullScreen` (only for alarms with `sound` or `speak`): when the phone is locked, the alarm
  wakes the screen and shows a full-screen alarm with a Stop button, like a clock app. Use
  `fullScreen = false` for gentle announcements that should only speak. `Alarms.canUseFullScreen`
  is false if the user turned this off (Android 14+); `Alarms.openFullScreenSettings` opens it.

### Notifications

```kotlin
import com.anyapp.app.notify.Notifications
import com.anyapp.app.notify.rememberNotificationPermission

val permission = rememberNotificationPermission()   // in a composable
if (!permission.granted) PrimaryButton("Turn on reminders", onClick = { permission.request() })
Notifications.notifyNow(context, "Saved", "Your list was saved")
```

### Also at hand (Android itself, no library)

- Text to speech while the app is open: `android.speech.tts.TextToSpeech`.
- Sounds in the app: `android.media.MediaPlayer.create(context, R.raw.beep).start()`.
- Vibration: `LocalHapticFeedback.current.performHapticFeedback(HapticFeedbackType.LongPress)`.
- Keep the screen on: `LocalView.current.keepScreenOn = true` (in a `DisposableEffect`).
- Dates and times: `java.time` (`LocalDate`, `LocalTime`, `ZonedDateTime`, `ZoneId.of("Asia/Dubai")`).
- Time and date pickers: Material 3 `TimePicker`, `DatePicker` (in an `AlertDialog`).
- Location: add `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` to the manifest, ask with
  `rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions())`, then
  `LocationManager.getCurrentLocation(...)`. Always handle "not granted" (a friendly message and a
  fallback, e.g. a city picker).
- Internet: `java.net.HttpURLConnection` on `Dispatchers.IO` (HTTPS only). Network work never on
  the main thread.
- Background work: `rememberCoroutineScope()` / `LaunchedEffect` with `withContext(Dispatchers.IO)`.

Adding a permission: one `<uses-permission>` line in `AndroidManifest.xml`; ask for dangerous
ones at run time as above.

## The app icon

The launcher icon is **`icon.png`** at the project root: a 1024x1024 PNG, square, opaque,
full-bleed (no rounded corners, no transparency). Android crops about a sixth from every edge into
a circle or squircle, so keep the picture in the middle ~60%. Every build makes the Android sizes
(`res/mipmap-*/ic_launcher_foreground.png`) from it, so never edit those. Give every app its own
icon that matches what it does (the starter icon, a plain outline on graphite, is a placeholder).
Flat colour, one simple glyph that says what the app is for, no gradients, no sparkles:

```
node scripts/make-icon.mjs --bg "#14532D" --fg "#F4F1E8" --glyph mosque      # flat colour + glyph
node scripts/make-icon.mjs --bg "#1E2023" --letter W                         # colour + letter
node scripts/make-icon.mjs --search alarm                                    # find glyph names
```

Options: `--fg` glyph colour (default white), `--scale` glyph size 0.2 to 0.7 (default 0.46).
Glyphs are Material Design Icons (https://pictogrammers.com/library/mdi/). You may also write any
other 1024x1024 PNG to `icon.png`. Also set `ic_launcher_background` in `res/values/colors.xml` to
the icon's background colour.

## When the build fails

The error you receive is the useful part of the output: Kotlin compiler errors with file and
line, or Gradle's "What went wrong". Fix the cause; do not work around it by deleting features.
The full log is in `build/logs/`. If R8 removed something a library needs by reflection, add a
`-keep` rule to `app/proguard-rules.pro`.
