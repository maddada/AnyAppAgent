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
```

## Tests

`npm test` (in `builder/`) runs `test/isolation.test.mjs`: it creates an app, checks that none of
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
   `build/apk/<slug>-<n>.apk`, returns its path, size and SHA-256.

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

Error messages are cut to what an agent needs: TypeScript errors, the Metro error (file, line,
code frame), Kotlin/Java compiler errors and Gradle's "What went wrong", npm `ERESOLVE`s, or
prebuild/config-plugin errors; never more than ~60 lines.
