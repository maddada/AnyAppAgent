# AnyAppAgent app template

Every app AnyAppAgent makes starts as a copy of this folder (`builder/` copies it and fills in the
placeholders `__APP_NAME__`, `__APP_SLUG__` and `__APP_PACKAGE__` in `app.json`). The agent that
edits a copy reads [AGENTS.md](AGENTS.md); this file is for people working on the template itself.

## What is in it

- Expo SDK 58 (`expo@58.0.x`, React Native 0.88, React 19.3, TypeScript strict), Android only,
  Continuous Native Generation: `android/` is never committed, the builder runs `expo prebuild`.
- A calm starter screen (`src/screens/HomeScreen.tsx`: system type with a clear hierarchy,
  hairlines, one ink-blue accent, light and dark), a theme (`src/theme.ts`) with a neutral palette
  and type scale any app can build on, three reusable components, and React Navigation 7 (static config, typed).
- Native capabilities wired in so most prompts need only JavaScript (see AGENTS.md for usage):

| Capability | Library | Why this one |
| --- | --- | --- |
| Exact alarms that fire while the app is closed, after reboot, with sound and spoken text | `modules/alarms` (local Expo module, Kotlin) | No maintained library does "speak text when the alarm fires and the app is dead". The module uses `AlarmManager.setAlarmClock` (exempt from Doze), a boot receiver that re-arms alarms stored in SharedPreferences, and a short `mediaPlayback` foreground service that plays `res/raw` sounds and Android `TextToSpeech` on the alarm stream. Its `app.plugin.js` copies `assets/sounds/*` into `res/raw`. |
| Notifications, exact scheduled reminders | `expo-notifications` | First-party; SDK 58 adds `delivery: 'alarmClock'` for exact date triggers and reschedules after reboot. |
| Text to speech (in app) | `expo-speech` | First-party, no config. |
| Audio playback | `expo-audio` | First-party replacement for the deprecated `expo-av`. |
| Persistent storage | `@react-native-async-storage/async-storage` | The standard key-value store every agent knows; wrapped in `src/lib/storage.ts`. |
| Location | `expo-location` | First-party; foreground only. |
| Haptics | `expo-haptics` | First-party. |
| Keep screen awake | `expo-keep-awake` | First-party. |
| Time/date picker | `@react-native-community/datetimepicker` | The picker Expo recommends; native Material dialogs. |
| Navigation | `@react-navigation/native` + `native-stack` | Explicit, typed screen registration (less magic for an agent than file-based routing). |
| UI | `@expo/vector-icons`, `react-native-safe-area-context` | Icons, edge-to-edge insets. (No gradient library: the user does not want gradients.) |
| OTA later | `expo-updates` (installed, `updates.enabled: false`) | Ready for over-the-air updates without another native change of the dependency set. |

All versions were chosen with `npx expo install`, so they match SDK 58.

## Permissions

Declared in `app.json` and merged from the libraries: `POST_NOTIFICATIONS`, `USE_EXACT_ALARM`,
`SCHEDULE_EXACT_ALARM` (Android 12), `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `VIBRATE`,
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `INTERNET`,
`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS`
(from `expo-audio`). `USE_EXACT_ALARM` is fine because these apps are side-loaded, never on Play.

## The icon

`assets/icon.png` (1024x1024, opaque, full-bleed) is the only icon file: `app.json` uses it as the
legacy icon, the adaptive icon foreground and the splash image. `scripts/make-icon.mjs` draws a
Material Design Icons glyph (read from the font inside `@expo/vector-icons` with a small TrueType
rasterizer) or a letter on a flat colour and writes the PNG with Node's `zlib`, with no
other tools: `npm run icon -- --bg "#0E7C66" --glyph mosque`.

## Checks

```
npm run typecheck && npm run lint && npm run bundle    # or: npm run check
```

## Changing the template

Edit, run `npm run check`, and build a test app with the builder (`node ../builder/cli.mjs create
C:\aa\t\x --name X` then `build`). If you change dependencies, use `npx expo install` and commit
`package-lock.json`: the builder's dependency cache is keyed on it. Any change here makes the
builder discard its prepared spare app folder and make a new one on the next `createApp`.
