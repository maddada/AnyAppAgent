# AnyAppAgent builder

Plain ESM (Node 20+), no dependencies, no build step. Implements the `builder/` contract in
[docs/SPEC.md](../docs/SPEC.md):

```js
import { createApp, buildApk, getIconPath } from './builder/index.mjs';

await createApp({ dir: 'C:\\aa\\apps\\prayer', name: 'Prayer Times', slug: 'prayer', packageName: 'com.anyapp.prayer', onLog });
const { apkPath, sizeBytes, sha256 } = await buildApk({ dir: 'C:\\aa\\apps\\prayer', buildNumber: 1, onLog });
getIconPath({ dir: 'C:\\aa\\apps\\prayer' });   // C:\aa\apps\prayer\assets\icon.png
```

`buildApk` also returns `versionCode`, `packageName`, `durationMs`, `timings` (per phase) and
`logPath` (additive). On failure it rejects with an `Error` whose message is the useful part of
the output (and `err.logPath`).

CLI:

```
node builder/cli.mjs create C:\aa\t\sample --name "Sample"     [--slug sample] [--package com.anyapp.sample]
node builder/cli.mjs build  C:\aa\t\sample --build-number 1     [--quiet]
node builder/cli.mjs icon   C:\aa\t\sample
node builder/cli.mjs warm                                       # deps cache + a spare app folder
node builder/cli.mjs keys list | backup <file> | restore <file> | move <app dir>   # signing keys
```

## Tests

`npm test` (in `builder/`) runs `test/kotlin.test.mjs` (the Kotlin preset, below; set
`ANYAPP_SKIP_BUILD_TESTS=1` to skip its two real builds) and `test/isolation.test.mjs`: it creates an app, checks that none of
its ~34,000 `node_modules` files is a hard link or shares a file with the dependency cache or
`template/node_modules`, patches a file in the app's `node_modules`, runs `npm install left-pad`
in the app, and checks that the shared copies are byte-for-byte unchanged. App folders are made
with robocopy (independent copies) from the builder's own dependency cache; `makeAppTree` also
refuses to produce a hard-linked tree.

## Where things live

| What | Where |
| --- | --- |
| Template | `../template` (override: `ANYAPP_TEMPLATE_DIR`) |
| Dependency cache (`npm ci` of the template lockfile, once per lockfile) | `%USERPROFILE%\.anyappagent\cache\deps-<hash>\` |
| Spare app folders (ready copies of the template) | `C:\aa\.spare\` (same volume as the apps; override: `ANYAPP_SPARE_DIR`) |
| Signing key (PKCS12, RSA 3072, 100 years) and its password | `%USERPROFILE%\.anyappagent\keystore\anyapp-release.p12` + `keystore.json` (override root: `ANYAPP_HOME`) |
| Each app's own key (made by `createApp`, or moved from the shared key by key rotation, with `lineage.bin`) | `%USERPROFILE%\.anyappagent\keystore\apps\<package id>\release.p12` + `key.json` |
| APKs | `<app>\build\apk\<slug>-<n>.apk` (last 5 kept; `build/` is git-ignored) |
| Build logs | `<app>\build\logs\build-<n>.log` |
| JDK / SDK | `JAVA_HOME` / `ANDROID_HOME` if set, else `D:\tools\android\jdk` / `D:\tools\android\sdk` (docs/ENVIRONMENT.md) |

## createApp

Copying the template with its `node_modules` (≈34,000 files, 440 MB) takes 15–35 s on this PC
whichever way it is done (robocopy /MT, hard links: Windows file creation, not bytes, is the
cost). So the builder keeps a **spare**: a complete, installed copy of the template in
`C:\aa\.spare\spare-<id>`. `createApp` renames it into place (a single, instant NTFS move),
writes the name, slug and package id into `app.json`/`package.json`, and starts a detached
background process that makes the next spare (robocopy from the dependency cache, ≈18 s). If no
spare matches the current template (any template file or the builder changed) it copies directly
instead. Spares are full copies, not links, so apps never share files.

## buildApk

1. Takes a per-app lock (`build/.build.lock`), opens `build/logs/build-<n>.log`.
2. Makes the signing key on first use (`keytool`), outside the repository.
3. Runs `npm install` only if `package.json`/`package-lock.json` changed since the last install.
4. Starts `tsc --noEmit` in parallel; a type error fails the build (and stops Gradle early).
5. Runs `expo prebuild --platform android --no-install` only when its inputs changed (`app.json`,
   `package.json`, `assets/**`, config plugins); retries with `--clean` if it fails on an existing
   `android/`.
6. Runs the Gradle wrapper with `java -jar gradle-wrapper.jar` (no shell): `app:assembleRelease
   --build-cache -PreactNativeArchitectures=x86_64,arm64-v8a` plus `--init-script
   anyapp.init.gradle`, which signs with the shared key (passwords passed as
   `ORG_GRADLE_PROJECT_*` environment variables, never written into the app), sets
   `versionCode = buildNumber`, and turns off the release lint check. The Gradle daemon stays
   warm between builds and apps; the shared local build cache lets a new app reuse the compiled
   library modules of earlier apps.
7. Verifies package and versionCode with `aapt2 dump badging`, copies the APK to
   `build/apk/<slug>-<n>.apk`, returns its path, size and SHA-256. React Native apps also get one
   APK per ABI (`<slug>-<n>-arm64-v8a.apk`, `<slug>-<n>-x86_64.apk`, returned as `variants`), and
   their native libraries are stored compressed (`anyapp.init.gradle`). Prayer Alarm build 6 went
   from 89.4 MB (both ABIs, libraries uncompressed) to 50.0 MB for the full APK and 38.9 MB for
   the arm64-v8a one a phone downloads. `ANYAPP_ABI_SPLITS=0` builds only the full APK.

Two Windows/Expo specifics:

- Expo SDK 58 writes `android.enableMinifyInReleaseBuilds=true` into `gradle.properties`. R8
  shrinking cost ~95 s of a 130 s rebuild, so the builder passes
  `-Pandroid.enableMinifyInReleaseBuilds=false` (APK ~55 MB instead of ~47 MB for two ABIs).
  `ANYAPP_MINIFY=1` turns it back on.
- After native modules change, the warm Gradle daemon can keep a library jar inside the app open
  ("Unable to delete file …"). The builder then asks the Windows Restart Manager who holds it
  (`lib/who-locks.ps1`), stops that one Gradle/Kotlin daemon (only when this process runs no
  other build) and retries once.

Measured on this PC (24 cores, Expo SDK 58, two ABIs):

| Step | Time |
| --- | --- |
| `createApp` with a ready spare | 0.2 s |
| `createApp` without a spare (copy fallback) | 16 s |
| First build of the very first app (cold Gradle build cache) | 608 s |
| First build of a new app (warm caches) | 297 s |
| Rebuild after a JS-only change | 27 s quiet PC, 85 s while other threads' Gradle builds ran |
| Rebuild after adding a native dependency (`npx expo install expo-battery`) | 193 s |
| Failing build, TypeScript error | 1.6 s |
| Failing build, Metro or Kotlin error | ~29 s |

`ANYAPP_GRADLE_ARGS` adds Gradle arguments (e.g. `--profile`).

## The Kotlin preset

`createApp({ ..., preset: 'kotlin' })` makes a native Android app (Kotlin, Jetpack Compose,
Material 3) from `../template-kotlin` (override: `ANYAPP_KOTLIN_TEMPLATE_DIR`). With no `preset`
(or `'react-native'`) everything above is unchanged. `buildApk` and `getIconPath` tell the two
apart by the folder: a Kotlin app has `anyapp.json` (`{ preset, slug, package }`), a React Native
app has `app.json`.

Why a separate folder beside `template/` (and not `templates/kotlin/`): `template/` stays where
every caller, test, script and the other threads expect it, and nothing about the React Native
path moves. The two templates share no files.

How a Kotlin app is made and built:

- `createApp` copies the template's sources (about 40 files, no `node_modules`), writes slug and
  package into `anyapp.json` and the name into `app/src/main/res/values/strings.xml`. The Kotlin
  package of the code is always `com.anyapp.app`; only `applicationId` (read from `anyapp.json`
  by `app/build.gradle.kts`) differs per app, so a new app's compiled classes come from Gradle's
  build cache.
- `buildApk`: makes the launcher icon sizes (`res/mipmap-*/ic_launcher_foreground.png`, 108 dp)
  from the 1024 px `icon.png` when it changed (`lib/png.mjs`, no dependencies), then runs
  `app:assembleRelease` with the same wrapper launch, init script (shared key, `versionCode`),
  JVM settings and `--build-cache` as React Native apps, so both kinds share one warm Gradle
  daemon. No npm, TypeScript or prebuild step. R8 shrinking stays on (it is what makes the APK
  small). It also refuses an APK whose package id is not the one in `anyapp.json`.
- Spares: `C:\aa\.spare\kotlin\spare-<id>` (one, like React Native). Copying is instant anyway;
  the refill's real job is `warmKotlin`: once per Kotlin template version it builds a throwaway
  app so Gradle's dependency cache and local build cache (`%USERPROFILE%\.gradle`, shared and
  locked by Gradle itself, safe for concurrent builds) hold everything a new app needs. Each app
  keeps its own `.gradle/` and `build/` folders, so apps never share build output.
  `node builder/cli.mjs warm --preset kotlin` does the same by hand.

Measured on this PC (24 cores, emulator and other threads' builds running):

| Step | Time |
| --- | --- |
| `createApp` (copy) | 0.1 to 0.3 s |
| First build of the very first Kotlin app (downloads Compose, AGP for Kotlin) | 143 s |
| First build of a new Kotlin app (warm caches) | 20 s |
| Rebuild after a code change | 22 s |
| APK (starter, R8, both ABIs since it has no native code) | 0.93 MB (React Native starter: about 57 MB) |

`test/kotlin.test.mjs` covers creating (placeholders, XML escaping of the name), the icon path,
an unknown preset, the PNG code, two real builds (versionCode, size, icon sizes remade from a new
`icon.png`, the same signing certificate) and the package id guard.

Error messages are cut to what an agent needs: TypeScript errors, the Metro error (file, line,
code frame), Kotlin/Java compiler errors and Gradle's "What went wrong", npm `ERESOLVE`s, or
prebuild/config-plugin errors; never more than ~60 lines.

## The Expo Exact preset (alpha)

`createApp({ ..., preset: 'expo-exact' })` makes an [Expo Exact](https://github.com/expo/exact) app:
the view in Contract (`app.contract`), the data in TypeScript (`app.ts`), built for Android by
Exact's own scripts. Exact is pre-1.0 and changes daily, so the builder pins it
(`exact/pin.json`, commit `c3eb81b7`) and applies `exact/windows.patch`, because Exact does not
build Android on a Windows host yet. The fixes were sent upstream as issues (Exact takes fixes as
issues, not pull requests): expo/exact#147 (CRLF checkout; handled here by cloning with
`core.autocrlf=false`), #148 (NDK `windows-x86_64` tools), #149 (verbatim `\\?\C:\` roots) and
#150 (Gradle wrapper on Windows). The patch also adds `EXACT_GRADLE_ARGS`, through which the builder
passes `anyapp.init.gradle` (shared key, `versionCode = buildNumber`). Drop the patch and move the
pin once upstream has the fixes.

- **Where**: the checkout is two folders above the apps (`C:\aa\exact` for `C:\aa\apps\<slug>`),
  because an Exact app refers to it as `../../exact` (`ANYAPP_EXACT_DIR` overrides it, but then the
  app's own `bun exact.mjs` needs `EXACT2`). `ensureExact` clones it once, refuses a checkout at
  another commit, applies the patch if needed, and runs `exact setup` once (marker file).
- **Needs**: Bun 1.4.2 (`%USERPROFILE%\.bun-1.4.2`, or `ANYAPP_BUN`), rustup (`exact setup` adds
  the pinned toolchains and `aarch64-linux-android`), the SDK's NDK, JDK 17+. About 8.5 GB of tools
  once, then about 6.3 GB per app (each app has its own `target/`).
- **createApp**: `exact new <dir> --with android --name <name> --bundle-id <package>` (about 1 s,
  so no spare), then `anyapp.json`, `template-exact/AGENTS.md` above Exact's own block, a plain
  `CLAUDE.md` and `/build/` in `.gitignore`.
- **buildApk**: `bun <exact>/scripts/agent-android.mjs build <app> --apk` (Rust for
  `aarch64-linux-android`, then Gradle 9.8), then the same APK checks as the other presets.
- **Not there yet**: no launcher icon (Exact's Android shell has none, `getIconPath` returns null),
  no AI through AnyAppAgent (an Exact app's data runs in Hermes behind Exact's data seam; reaching
  AnyAppAgent's bound service needs an Android native data module, which Exact does not document
  yet), arm64 only (the emulator runs it through Android's arm64 translation).

Measured on this PC: `exact setup` (already set up) 2 min 20 s; `createApp` 0.9 s; first build of
a new app 6 min 25 s; rebuild after a one-line change 61 s; APK 28.0 MB.

`test/exact.test.mjs` checks the pin and the patch, creating an app (skipped without Bun or the
checkout), and with `ANYAPP_EXACT_BUILD_TEST=1` a real build.

## Signing keys

Plan and proof: [docs/DISTRIBUTION.md](../docs/DISTRIBUTION.md), "Signing".

- `createApp` makes the new app's own key first (`lib/keystore.mjs` `ensureAppKey`). An app with no
  folder under `keystore\apps\` (every app made before this) keeps building with the shared key.
- `moveAppToOwnKey({ packageName })` (CLI `keys move <dir>`) rotates a shared-key app to its own
  key (`apksigner rotate`, rollback to the shared key off). Its later builds are signed again by
  `lib/apksign.mjs` with shared + own + lineage (`--rotation-min-sdk-version 28`).
- After every build each APK (full and per ABI) is checked with `apksigner verify --print-certs`
  (and, for a moved app, `--max-sdk-version 27` and `apksigner lineage`): the certificates must be
  exactly the expected ones, or the build fails and the APK is deleted.
- `backupSigningKeys({ file, password })` and `restoreSigningKeys(...)` (`lib/keybackup.mjs`): one
  file, scrypt and AES-256-GCM; restore never overwrites a different key.
- Passwords reach `keytool` and `apksigner` only as environment variables.
- `npm test` includes `test/keys.test.mjs` (real keytool and apksigner in a throwaway
  `ANYAPP_HOME`, about 15 s).
