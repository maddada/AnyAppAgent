# The fast lane: quick updates, bundle swap builds and the Reload popup

The user picked "Fast lane" (Q19) and "Bundle swap builds" (Q20) on `C:\aa\ideas\ideas.html`, and
said: "we need to show the user a button that appears like a pop-up on the app itself that says
'Reload'. It explains that there are new changes that came in, like version 7 ... In both cases, if
I'm in the actual app and a new APK came in or a new OTA came in, I should have this reload button
so I can install and reload easily ... I wouldn't need to go back to AnyAppAgent's main application".

This builds on `docs/DISTRIBUTION.md` (per-app keys, the updater module, AnyAppAgent first).

## What the person gets

- A change that is only code (texts, colours, layout, logic, a new screen) reaches the phone in
  seconds as a **quick update**: no APK download, no install prompt. If the app is open, a small card
  says "Version 7 is ready" with **Reload**, which starts the new code in place. If it is closed, it
  simply opens with version 7 next time.
- A change that needs native work (a new library, a permission, the icon, a sound) is a normal
  build and an APK. If the person is inside the app when it arrives, the same card appears and
  Reload installs it (AnyAppAgent does the install, without a prompt, and opens the app again).
  AnyAppAgent no longer replaces an app under the person's finger.
- The tiles stay honest: "V7" means the app runs version 7, whether it came as a quick update or
  an APK. A quick update that crashes when it starts is rolled back on the phone by itself, and the
  tile shows the version that runs.
- The chat says which it was: "Sent as a quick update, no install needed" (build row on the PC and
  the phone, and the agent's own last sentence), or the usual "Your app is ready".

## How it decides: the native fingerprint

`builder/lib/fastlane.mjs` hashes every file that ends up in native code or resources: `app.json`
(and `app.config.*`), `package.json` and the lockfile, everything in `assets/`, everything in
`modules/` except its TypeScript and JavaScript (but `app.plugin.js` counts as native), `plugins/`,
plus the builder's init script, its version and the build's update feeds. Everything else (`src/`,
`index.ts`, `modules/*/index.ts`) is bundle only.

- The fingerprint of every full React Native build is baked into the APK as the string resource
  `anyapp_runtime` (`builder/anyapp.init.gradle`), and recorded with the build's APKs and the hash of
  its bundle assets in `build/fastlane/last.json`.
- Next build: same fingerprint and the last APKs still there means a quick build. A different one
  means Gradle, as before. Pictures and sounds the bundle uses that changed (compiled into the APK's
  resources) also mean Gradle.
- `buildApk({ fast: false })` or `ANYAPP_FAST_LANE=0` always runs Gradle.

Why our own fingerprint and not `@expo/fingerprint`: it is fast (a few hundred files, no
`node_modules` walk: `node_modules` only changes through `package.json` and the lockfile, which are
in it), deterministic on Windows, and it also covers what only AnyAppAgent's builder adds (the init
script, the feeds). It is conservative: any file in `assets/` forces a full build.

## The quick build (bundle swap, and the quick update)

1. `expo export:embed` (the same command Gradle runs) and `hermesc -O0` to Hermes bytecode.
   Without `-O` Hermes takes 1 s instead of 9 s for a 3 MB bundle; the bytecode is about a third
   larger, and the next full build optimises again (`ANYAPP_FAST_LANE_OPTIMIZE=1` keeps `-O`).
   TypeScript is checked in parallel, as in a full build.
2. **Bundle swap**: each of the last build's APKs (universal, `x86_64`, `arm64-v8a`) is copied entry
   by entry without recompressing (`builder/lib/zip.mjs`), with `assets/index.android.bundle`
   replaced and `android:versionCode` set to the new build number in the binary manifest
   (`builder/lib/axml.mjs`, a 4-byte write), the old v1 signature files dropped, stored entries
   aligned like zipalign (4 bytes, 16 KB for `.so`), then signed with `apksigner` with the same key.
   Then the normal checks: `aapt2` reads the new versionCode, and `apksigner verify` checks the
   certificates (a moved app also gets its key rotation lineage, as for Gradle APKs). So every
   version is still a real APK: first installs, shared releases and a phone with older native parts
   get it.
3. **Quick update**: one zip with `ota.json` (format, package, build, native fingerprint, and the
   size and SHA-256 of every file), `ota.sig` (`ota.json` signed SHA256withRSA with the app's own
   signing key, `builder/lib/OtaSign.java`, password only in the environment), the bundle and its
   `drawable-*`/`raw` assets. About 1 MB for the template app.

The server keeps it next to the APKs (`build-<n>-ota.zip`), serves it at `GET /api/apps/:id/ota`
(the latest build; same auth as `/apk`) and marks the build `delivery: "quick"` with `ota` and
`runtime` (`shared/protocol.ts`, additive).

## On the phone

Apps cannot reach the PC by themselves, so everything goes through AnyAppAgent.

**AnyAppAgent** (`app/src/lib/installer.ts`, `app/modules/anyapp-native`):

- On `apk.ready` for an app on this phone: if the build has a quick update and the installed app's
  `anyapp_runtime` (read from its resources) equals the quick update's, and the app has not
  refused that build before, it downloads the zip, checks its SHA-256 and hands it to the app
  (`setAppReady`, then the broadcast `com.anyapp.updates.READY` to that package only). In the
  foreground or the background: it is small.
- Otherwise the APK, as before, except while the app says it is on screen and AnyAppAgent is not:
  then AnyAppAgent downloads and checks the APK and only tells the app "an APK is ready" (park).
  The app's Reload opens `anyappagent://?update=<package>`, AnyAppAgent installs (no prompt: it is
  the installer of record) and opens the app again.
- Its provider (`content://<AnyAppAgent>.updates/`, `UpdatesProvider.kt`) gained `ready/<pkg>`,
  `ota/<pkg>` (the file), `presence/<pkg>` and `report/<pkg>`. Every route answers only the app
  asking about itself (the caller's package must be the one in the address).
- `getPackageInfo().versionCode` is the version the app shows: its APK's, or a newer quick update it
  reported running or was handed (unless it refused it). The real APK versionCode is
  `apkVersionCode`.

**Every app** (`com.anyapp.updates`, the same files in `template/modules/updates` and
`template-kotlin`, kept byte for byte equal by `builder/test/updater-copies.test.mjs`):

- `ReadyPopup.kt`: activity lifecycle callbacks. On every resume it tells AnyAppAgent it is on
  screen and asks what is ready; the broadcast does the same. The card: "Version N is ready", one
  line ("New changes came in over the air. Reload to see them, no install needed." or "A new install
  is ready. Reload installs it and opens the app again."), Later and Reload, in the Workbench colours
  (warm paper, graphite, bottle green; light and dark). Plain Android views on the activity's
  window, so it works in React Native and Compose alike and an agent cannot break it by editing
  the app's screens.
- `Ota.kt`: checks a quick update before anything of it runs: the signature with the app's own
  signing certificate (the current signer, after a key rotation the app's own key), the package,
  the native fingerprint, newer than what runs, every file's size and SHA-256, safe file names.
  Anything else is refused, never unpacked, and remembered (and reported) as bad. Because it is
  signed with the app's key, only whoever can sign an APK of the app can make a quick update it
  runs: a fake "AnyAppAgent" on the phone could hand it a file, but not one that passes.
- `HostLink.kt`: the provider calls.
- React Native only, `AnyappUpdatesPackage.kt` (found by Expo autolinking): a
  `ReactNativeHostHandler` whose `getJSBundleFile` returns the bundle `Ota` chose (Expo asks again at
  every reload, so `ReactHost.reload()` starts the new one in place), and whose
  `onReactInstanceException` rolls back.
- Kotlin apps: `ReadyPopup.install(application)` in `MainActivity.onCreate`; APKs only.

**Rollback**: the first start of a quick update is a trial. A fatal JavaScript error during the trial
marks it bad and opens the app again at once with the last good bundle (or the APK's own). It is a
restart, not an in-place reload: after a fatal error React Native has already torn its screens
down, and a reload then showed a blank screen (seen in the proof). A trial start that
never got going (the process died before 5 s) is rolled back at the next start. The app reports the
bad build to AnyAppAgent, which never offers it again and shows the version that runs. A newer APK
drops every quick update older than or as old as itself, and a different native fingerprint drops
them all.

## Why a small custom loader and not expo-updates

`expo-updates` is installed in the template and off; it stays off.

- Its updates are fetched by the app itself over HTTP from an update server. These apps cannot reach
  the PC (only AnyAppAgent can, through Easy Connect), so it would need a web server on the phone.
- The trust we want is "signed with the app's own key", which works the same for every app and
  needs nothing embedded at build time; expo-updates' code signing needs its own certificate in
  every build and a manifest format we would have to produce.
- The loader is small (one `ReactNativeHostHandler`), lives in the module every app already has,
  and shares the Reload popup with the APK path and with Kotlin apps.

## Shared apps (GitHub releases)

Not built yet; it fits as is. A stable publish of a quick build could add the quick update zip as a
release file and an `ota` entry (`name`, `size`, `sha256`, `runtime`, `build`) to `update.json`; the
app's own updater (`AppUpdater`) would download it when the runtime matches and hand it to `Ota.stage`,
which already does every check (the signature is the app's key, so GitHub is only the courier),
then show the same Reload card. Friends with older native parts keep getting the APK.

## Proof

See "Fast lane proof" below.

## Fast lane proof

2026-11-11, `emulator-5560` (Android 15, shared and heavily loaded by other threads: load average
often 20 to 40, once 383 with a system restart), my own companion (port 8813, state, apps and keys in
`C:\aa\t\fl-*`, GitHub off, single agent per app), my phone copy `com.anyappagent.fastlane`, real
Claude Code turns. Test apps: Tally (`com.anyapp.tally`, React Native) and FL Kotlin
(`com.anyapp.flkotlin`). Screenshots and timing notes in `C:\aa\e2e\fast-lane\`.

| What | Result |
| ---- | ------ |
| Builder, JavaScript-only change (CLI, warm) | Quick build 16 s (export and Hermes 12 s with TypeScript running beside it), quick update 1.1 MB, three swapped APKs signed and checked. In the companion: 7 to 10 s. A full warm Gradle build of the same app: 104 to 224 s; a new app's first build: 7 to 11 min |
| The agent changed the icon and `app.json` in its first real turn | "Native parts changed": full build, correctly |
| Quick update with Tally on screen ("Tap Count" heading) | Message to build done 31 s (the agent's turn about 20 s, the build 10 s); AnyAppAgent fetched and handed over the 5.5 MB update in 10.5 s (1.7 s on a later run when the emulator was calmer); Tally checked it in 1.4 s and showed "Version 3 is ready" (`12-tally-popup-ota.png`); Reload: the new heading on screen about 2 s after the tap, in place (`13-tally-after-reload.png`), trial confirmed ("started fine") |
| The tile after it | "V3" while the installed APK is 2 (`14-tile-v3.png`) |
| Native change (icon) with Tally on screen | Full build 212 s; AnyAppAgent downloaded the APK but did not install over the open app; Tally showed "Version 4 is ready ... A new install is ready" 19 s after the build (`15-tally-popup-apk.png`); Reload: installed 5.6 s after the tap, no prompt |
| Reopen after that install | First try failed: the reopen came from JavaScript 16 s later, after a Home press from another thread, and Android blocked it as a background start. Fixed: AnyAppAgent's install result receiver opens the app the moment Android reports success. Retest (build 8): installed 3.3 s after Reload, Tally back on screen by itself at 11 s (`23-tally-popup-apk8.png`, `24-tally-v8-reopened.png`, tile V8 `25-tile-v8.png`) |
| Broken quick update (`throw` at the top of the App component, build 5) | Reload: "quick update 5 failed at start ... going back", AnyAppAgent told ("did not start on the phone; it went back to 4"). First version reloaded in place and left a blank screen; changed to a restart. Retest (build 7): crash, then a fresh process on the installed version (`22-after-rollback-restart.png`); build 7 is not offered again |
| Kotlin app, change with the app on screen | Build 78 s; "Version 2 is ready" in the Compose app (`26-kotlin-popup.png`); Reload: installed 2.3 s, reopened 6.8 s, new text showing (`27-kotlin-v2-reopened.png`) |
| Dark mode | The card stayed light when the theme changed while it showed (React Native handles the change without recreating the activity). Fixed (redrawn on configuration change); `31-popup-dark.png` |
| The chat | Build card "Sent as a quick update / Version 11. No install needed: tap Reload in the app", header "Version 11 is on this phone", and the agent's own "Sent as a quick update, no install needed." (`32-chat-quick-update.png`) |

Time from message to change, as measured here:

- **Quick update**: about 45 s on the loaded emulator (agent turn 20 s, build 10 s, hand-over 11 s,
  Reload 2 s); the PC and phone part alone is 13 to 25 s. The agent's turn is now most of it.
- **APK**: about 4 to 5 minutes (agent turn, Gradle 2 to 4 minutes, a 24 MB download, install 3 to
  6 s, reopen), much longer when the shared emulator was overloaded.

Not proven here: the agent's own "Sent as a quick update" sentence is its prediction from what it
changed; once (build 10) it was a full build because I had changed the app's native loader by hand,
and the build card said so. The build card is the truth.
