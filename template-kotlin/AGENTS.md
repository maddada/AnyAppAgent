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
  ai/Ai.kt                 AI (chat, streaming, tools, agents) through AnyAppAgent's key
  ai/AiSetupNotice.kt      the "AI is not set up" card with a button to AnyAppAgent
  ai/AiTypes.kt            AiMessage, AiPart, AiTool, AiError ... (AI.md: the wire format, leave it)
app/src/main/AndroidManifest.xml   permissions, the activity, the alarm receivers and service
app/src/main/res/values/strings.xml   app_name: the name under the icon
app/src/main/res/raw/      sound files for alarms (adhan.mp3, beep.ogg, ...)
app/build.gradle.kts       dependencies and Android settings
icon.png                   THE launcher icon (1024x1024 PNG)
scripts/make-icon.mjs      makes icon.png from a colour and a glyph or letter
anyapp.json                written by AnyAppAgent: preset, slug and package id (read only)
overview.md                what the person wants the app to do (see below)
```

The Kotlin package of the code is `com.anyapp.app` in every app; only the installed package id
(from `anyapp.json`) differs. Keep new code under `com.anyapp.app`.

## overview.md and the person's other apps

- `overview.md` (project root) holds the app's main requirements as the person gave them: what
  the app is for, its main screens and features, the choices that matter. High level and short,
  not a README and not a changelog. The agent the person talks to (the main chat) keeps it up to date after every
  message that changes what the app should do; a helper reads it and leaves it alone. A first line
  `<!-- anyapp: draft ... -->` marks a draft the PC wrote: replace the whole file.
- The `anyapp` command shows the person's other apps on this PC: `anyapp apps` (name, kind,
  version, folder; this app is marked `*`), `anyapp overview <app>` (its `overview.md`),
  `anyapp path <app>` (its folder, to read its code). Before building a new app or feature, look
  there for something that already works (a calculation, a screen, notifications, a look the
  person liked) and copy it into this app, adapted to it.
- Other apps are read only: never change, build, commit or run anything in another app's folder.

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
- Never put secrets or keys in the app. For AI, use `Ai` (below): never ask the person for an
  API key and never call an AI provider over the internet yourself.

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

### AI: chat, streaming, tools and agents (Claude or OpenRouter, through AnyAppAgent)

Use this whenever the person asks for anything AI: a chat, summaries, smart suggestions, reading a
photo, an assistant that does things in the app. The person adds their AI key once in AnyAppAgent's
Settings; this app never sees the key. AnyAppAgent sends the requests, shows usage per app and can
switch AI off for this app. Nothing to install or declare.

```kotlin
import com.anyapp.app.ai.*

// 1. Show the setup card while AI is not ready (no key yet, or AI switched off for this app).
val aiStatus by rememberAiStatus()               // refreshes when the app comes back to the front
AiSetupNotice(aiStatus)                          // shows nothing when AI is ready

// All calls are suspend functions: run them in a coroutine.
val scope = rememberCoroutineScope()
val context = LocalContext.current

// 2. One question
scope.launch { val answer = Ai.ask(context, "Suggest a name for a cat", system = "Answer in one line.") }

// 3. A conversation, streamed: show text as it arrives
var messages by remember { mutableStateOf(listOf<AiMessage>()) }
var live by remember { mutableStateOf("") }
scope.launch {
  val next = messages + AiMessage.user(input)
  val reply = Ai.chat(context, next, system = "You are a friendly cooking helper.", onText = { live += it })
  messages = next + reply.message                // always keep reply.message, not just the text
}

// 4. An agent with tools: the AI calls your functions until it is done
val addItem = AiTool(
  name = "add_item",
  description = "Add an item to the shopping list",
  parameters = JSONObject("""{"type":"object","properties":{"name":{"type":"string"},"qty":{"type":"number"}},"required":["name"]}"""),
) { input -> addToList(input.getString("name"), input.optInt("qty", 1)); "added" }
scope.launch {
  val result = Ai.runAgent(
    context, tools = listOf(addItem),
    prompt = "Add what I need for pancakes",
    system = "You manage the shopping list. Use the tools.",
    maxSteps = 6,                                 // AI turns before it stops (default 8)
    onText = { live += it },
    onToolCall = { step = "Adding ${it.input.optString("name")}" },
  )
  result.text; result.messages                    // the final answer; the whole conversation to keep
}

// 5. Images in: base64 (no data: prefix), in a user message
Ai.chat(context, listOf(AiMessage.user(AiPart.Image(base64, "image/jpeg"), AiPart.Text("What plant is this?"))))

// Errors: every call can throw AiError
try { Ai.ask(context, "Hi") } catch (e: AiError) {
  if (e.needsSetup) setupCode = e.code else problem = aiProblemText(e.code)   // AiSetupNotice(null, code = setupCode)
}
```

- Always handle "not ready": show `AiSetupNotice` (with `code = e.code` after an `AiError` with
  `needsSetup`) where the AI feature would be, and keep the rest of the app working without AI.
  Its button opens AnyAppAgent's settings. Never show a key field in this app.
- Stream long answers with `onText` (it runs on the main thread, so it can set Compose state).
  Cancelling the coroutine (`job.cancel()`) stops the answer.
- Keep tools small and safe: the AI decides when to call them, so never give it a tool that
  deletes or spends without the person confirming in the UI.
- Limits set by AnyAppAgent: about 30 AI calls a minute and 3 at once per app (`AiError` code
  `limit`), answers up to `maxTokens` (default 8192). An agent step is one call.
- Images: let the person pick one with `rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia())`,
  scale it down (`BitmapFactory` + `Bitmap.createScaledBitmap`, JPEG quality 70), then base64 it
  (`android.util.Base64.NO_WRAP`). Keep images small, a few MB at most.
- Save conversations with `Store` (as JSON: `AiMessage.toJson()`) if the person should find them again.
- The wire format under `Ai` is in `AI.md`; app code never needs it.

### Updates for people the app is shared with (built in, nothing to do)

When the person shares the app from AnyAppAgent, the PC builds it with its update feed and the
app updates itself on other people's phones: it checks when it opens and once a day, shows a
notification when a new version is published, and a tap downloads, checks and installs it. On the
person's own phone AnyAppAgent installs every build, so the app stays quiet. This is
`com.anyapp.updates` (the same code in every AnyAppAgent app), started by the
`AppUpdater.onAppStart(this)` line in `MainActivity` and the entries marked in
`AndroidManifest.xml`, with `res/raw/anyapp_keep.xml`: never edit or remove any of these, and
never add another updater. Only if the person asks for an update line or a "Check for updates"
button: `AppUpdater.check(context)` (off the main thread) returns `State.Available(update)`,
`UpToDate`, `HandledByAnyAppAgent`, `Off` or `Problem(message)`, and
`startActivity(Intent(context, UpdateActivity::class.java).putExtra(UpdateActivity.EXTRA_START, true))`
opens the update box.

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

## New versions on the phone

After your turn the PC builds a new APK (a few minutes) and AnyAppAgent installs it. If the person is
inside the app when it arrives, the app shows a small "Version N is ready" card with **Reload**,
which installs it and opens the app again (`com.anyapp.updates.ReadyPopup`, started in
`MainActivity.onCreate`: keep that line). Kotlin apps have no quick (over-the-air) updates: every
change is a new install.

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

## Plan first, and pages in the chat

- Before you build a new app or make a large change (a new screen, a new feature, a redesign), the
  person confirms a plan: the plan as bullets and sub-bullets in the chat, and a plan page (a picture
  of what you will build, then "Build it?"). Start only after their yes. Small changes need no plan.
- Pages are HTML files you show in the chat with the `show_page` tool (MCP server `pages`): a plan,
  a mockup of a screen, how a feature would work, or questions they answer on the page. The guide
  (the skeleton and the question kit) is named in your instructions; read it before your first page.
- Page files never go into this project: write them in the folder the `show_page` tool names.

## When the build fails

The error you receive is the useful part of the output: Kotlin compiler errors with file and
line, or Gradle's "What went wrong". Fix the cause; do not work around it by deleting features.
The full log is in `build/logs/`. If R8 removed something a library needs by reflection, add a
`-keep` rule to `app/proguard-rules.pro`.
