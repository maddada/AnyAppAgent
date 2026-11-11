# AnyAppAgent (the Android app)

Expo SDK 58, React Native 0.88, TypeScript, Android only, side-loaded. Package `com.anyappagent`.
It talks to the PC companion (`../server`) through `../shared/protocol.ts`.

## Commands

| What | Command |
| --- | --- |
| Installable APK (release, JS inside, no dev server) | `npm run apk` (prints the APK path: `dist/AnyAppAgent.apk`) |
| Regenerate `android/` after changing `app.json` (icon, fonts, permissions) | `npm run apk:clean` (in PowerShell `npm run apk -- --clean` loses the flag) |
| Typecheck / lint | `npm run typecheck` / `npm run lint` |
| JS bundle only | `npm run export:android` |
| Mock PC (whole contract, canned data, real tiny APKs) | `npm run mock` (code `123456`, emulator address `10.0.2.2:8787`) |
| Drive the emulator (tap by testID, type, screenshot) | `node dev/ui.mjs ...` |

Build from PowerShell after `. C:\dev\AnyAppAgent\scripts\android-env.ps1` (see `docs/ENVIRONMENT.md`).
`npm run apk` falls back to `D:\tools\android\jdk` and `D:\tools\android\sdk` when `JAVA_HOME` /
`ANDROID_HOME` are not set.

## Layout

- `src/app/` screens (Expo Router): `connect`, `index` (home grid + sheets), `chat/[id]`, `settings`.
- `src/lib/` state and talking to the PC: `api.ts` (HTTP), `session.ts` (pairing, WebSocket with
  reconnect, resync), `installer.ts` (download, sha256, install, notifications), `store.ts`.
- `src/chat/` the chat timeline in bb's look (`Markdown.tsx`, `ChatRows.tsx`, `timeline.ts`).
- `modules/anyapp-native/` the Kotlin Expo module: PackageInstaller sessions (+ system-intent
  fallback through a FileProvider), package info, launch, settings pages, notifications and the
  keep-alive foreground service.
- `modules/anyapp-ai/` "AI for your apps": the AI key (Keystore-encrypted), the local proxy service
  generated apps bind to (`AiProxyService`, caller check in `AiTrust.kt`), provider streaming
  (`AiProviders.kt`) and usage per app. Settings UI: `src/ui/AiSettings.tsx`. Test without a key:
  `node dev/fake-ai-provider.mjs` + `adb shell setprop debug.anyapp.ai.url http://10.0.2.2:8913`.
- `dev/` the mock PC (`mock-server.mjs`), the tiny test-APK builder (`make-test-apk.mjs`), the icon
  painter (`png.mjs`, `make-app-icons.mjs`) and the adb driver (`ui.mjs`).
- `docs/screens/` screenshots from the emulator.

## Mock APKs

The mock serves real APKs it builds itself with the SDK build-tools (`dev/make-test-apk.mjs`):
no code (`hasCode=false`), the framework's own `android.app.Activity` as the one screen, a window
background showing the icon and the version number, signed with a test key kept in `dev/tmp/`.
Mock apps use package names `com.anyappagent.mock.<slug>` so they never collide with real
generated apps (`com.anyapp.<slug>`) on a shared emulator.
