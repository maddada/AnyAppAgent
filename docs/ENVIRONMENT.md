# Android toolchain and emulator on this PC

Everything here was installed and proven on 2026-11-10. Follow it literally.

## Versions and paths

| What                    | Version                         | Path                                              |
| ----------------------- | ------------------------------- | ------------------------------------------------- |
| JDK (`JAVA_HOME`)       | Microsoft OpenJDK 21.0.12.1     | `D:\tools\android\jdk`                            |
| Android SDK             |                                 | `D:\tools\android\sdk` (`ANDROID_HOME`, `ANDROID_SDK_ROOT`) |
| SDK command-line tools  | 23.0 (sdkmanager, avdmanager)   | `D:\tools\android\sdk\cmdline-tools\latest\bin`   |
| Platform tools (adb)    | 37.0.1 (adb 1.0.41)             | `D:\tools\android\sdk\platform-tools`             |
| Emulator                | 37.2.12                         | `D:\tools\android\sdk\emulator`                   |
| SDK platforms           | android-37.0 (compileSdk 37), android-36 | `D:\tools\android\sdk\platforms`         |
| Build tools             | 37.0.0, 36.0.0                  | `D:\tools\android\sdk\build-tools`                |
| NDK                     | 27.1.12297006                   | `D:\tools\android\sdk\ndk\27.1.12297006`          |
| CMake                   | 3.30.5, 3.22.1                  | `D:\tools\android\sdk\cmake`                      |
| System image            | android-35 google_apis x86_64   | `D:\tools\android\sdk\system-images\android-35\google_apis\x86_64` |
| AVDs (`ANDROID_AVD_HOME`) | `anyapp` (ours), `ghostex` (NOT ours) | `D:\tools\android\avd`                     |
| Gradle caches           | default user home               | `%USERPROFILE%\.gradle` (warm)                    |
| Node                    | 24 (on PATH)                    |                                                   |

These are what **Expo SDK 58** (`expo@58.0.23`, `react-native@0.88.1`, React 19.3, Gradle 9.4.1,
AGP 9.2.1, Kotlin 2.2) asks for: `compileSdk 37`, `targetSdk 36`, `minSdk 24`,
`buildTools 37.0.0`, `ndkVersion 27.1.12297006` (from
`node_modules/react-native/gradle/libs.versions.toml`). Expo SDK 58 is the current stable
(`npm view expo dist-tags` → `latest: 58.0.23`). It builds fine with JDK 21, so no JDK 17 was
installed.

## Load the environment (every PowerShell session that builds or uses adb)

```powershell
. C:\dev\AnyAppAgent\scripts\android-env.ps1
```

Dot-source it (the leading `. `). It sets, for this session only, `JAVA_HOME`, `ANDROID_HOME`,
`ANDROID_SDK_ROOT`, `ANDROID_AVD_HOME`, `ANYAPP_ADB_SERIAL=emulator-5560`, and puts the JDK,
`platform-tools`, `emulator`, `cmdline-tools\latest\bin` and `build-tools\37.0.0` FIRST on `PATH`.
Set `$Quiet = $true` before dot-sourcing to suppress its one-line banner. Machine and user
environment variables are untouched, so a fresh shell without this has none of it.

From Node (builder/server), do not rely on the parent shell: pass the same variables explicitly
in the child process `env` (`JAVA_HOME=D:\tools\android\jdk`, `ANDROID_HOME=D:\tools\android\sdk`,
`ANDROID_SDK_ROOT=D:\tools\android\sdk`, and `PATH` with `D:\tools\android\jdk\bin` and
`D:\tools\android\sdk\platform-tools` in front).

## The emulator

```powershell
pwsh -NoProfile -File C:\dev\AnyAppAgent\scripts\start-emulator.ps1   # optional: -TimeoutSec 300 -ColdBoot
```

- Starts AVD `anyapp` if it is not already running, with a visible window, `-gpu auto`
  (NVIDIA RTX 4070 Ti), WHPX acceleration, and waits until `sys.boot_completed=1`. Safe to call
  any number of times; it returns at once when the emulator is already up.
- **adb serial: `emulator-5560`** (console port fixed at 5560; the `ghostex` AVD, if someone runs
  it, gets 5554). Always pass `-s emulator-5560` to adb: never assume a single device.
- AVD `anyapp`: Pixel 7 profile (1080x2400, 420 dpi), Google APIs, API 35 (Android 15), x86_64,
  4 GB RAM, 4 cores, 12 GB data partition, hardware GPU, hardware keyboard on. Files:
  `D:\tools\android\avd\anyapp.avd` and `anyapp.ini`.
- Boot time: quick boot (from snapshot) ~12 s; a cold boot took ~5 min the first time.
- Logs: `D:\tools\android\logs\anyapp-emulator-stdout.log` / `-stderr.log`.
- Network: the emulator reaches this PC at **`10.0.2.2`** (verified: ping, and an HTTP request
  from the emulator to a server listening on `0.0.0.0` on the PC) and the internet (verified).
- Stop it (only if you really must, it is shared): `adb -s emulator-5560 emu kill`.

## The second emulator: anyapp2

- **AVD `anyapp2`**, **adb serial `emulator-5562`** (console port fixed at 5562). Same profile and
  image as `anyapp` (Pixel 7, API 35 Google APIs x86_64, 4 GB RAM, 4 cores, 12 GB data, hardware
  GPU). Files: `D:\tools\android\avd\anyapp2.avd` and `anyapp2.ini`.
- **It is for the end-to-end run** (AnyAppAgent installed, paired with the companion, building the
  prayer alarm app), so that run has a device no other thread is driving. Other work stays on
  `anyapp` (`emulator-5560`).
- Start it (idempotent, same detached launch as `anyapp`):

  ```powershell
  pwsh -NoProfile -File C:\dev\AnyAppAgent\scripts\start-emulator.ps1 -Name anyapp2
  ```

  `-Name` accepts `anyapp` (the default) or `anyapp2`. Logs:
  `D:\tools\android\logs\anyapp2-emulator-stdout.log` / `-stderr.log`.
- Verified on 2026-11-10: booted (`sys.boot_completed=1`, API 35), reaches this PC at `10.0.2.2`
  (ping and HTTP to a server on `0.0.0.0`) and the internet. First cold boot took ~225 s.
- `android-env.ps1` sets `ANYAPP_ADB_SERIAL=emulator-5560`; a thread using `anyapp2` must pass
  `-s emulator-5562` itself.

## Building an Expo app (what was proven)

```powershell
. C:\dev\AnyAppAgent\scripts\android-env.ps1
cd C:\aa\probe                       # SHORT path, see pitfalls
npx expo prebuild --platform android --no-install
cd android
.\gradlew.bat assembleRelease '-PreactNativeArchitectures=x86_64,arm64-v8a' --console=plain
# APK: android\app\build\outputs\apk\release\app-release.apk
adb -s emulator-5560 install -r app\build\outputs\apk\release\app-release.apk
adb -s emulator-5560 shell monkey -p <package> -c android.intent.category.LAUNCHER 1
```

Set this in the project's `android/gradle.properties` (the template should carry it; prebuild
writes 2 GB / 512 MB, and the first build ran out of metaspace with that):

```
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g
```

Proven on 2026-11-10 with a fresh `create-expo-app --template default@sdk-58` in `C:\aa\probe`
(release variant, signed with the template's debug key, ABIs `x86_64,arm64-v8a`):

| Step                                                     | Time        |
| -------------------------------------------------------- | ----------- |
| `create-expo-app` + `npm install`                        | 6 s + 69 s  |
| `expo prebuild --platform android`                       | 6 s         |
| First build, cold Gradle caches (Gradle 9.4.1 download, all deps, all C++) | ~10.5 min to the C++ step, plus 10 min 13 s for the retry after the ninja fix below; expect **~15-20 min** on a cold machine |
| First build of a NEW project with warm Gradle caches     | expect ~8-10 min (the C++ of every native module is compiled per project; not measured separately) |
| Second build of the same project after a JS change       | **1 min 50 s** |
| `adb install -r` of the 60 MB APK                        | 75-165 s (the emulator was loaded by other threads; normally much faster) |
| Launch to first frame (`am start -W`)                    | ~2 s        |

The APK installed over itself (`install -r`), launched (`com.anonymous.probe/.MainActivity`
resumed, "Welcome to Expo" rendered), and the rebuilt bundle with the JS change installed over
it. Only `x86_64` is needed for the emulator and `arm64-v8a` for real phones; building all four
default ABIs makes every build slower and the APK bigger.

Gradle caches stay warm in `%USERPROFILE%\.gradle` (5 GB). Do not run `gradlew --stop`: it
stops the daemons other threads are building with.

## Pitfalls and fixes

1. **Long paths break the C++ build (`ninja: error: mkdir(...): No such file or directory`).**
   The ninja bundled with SDK CMake 3.22.1 and 3.30.5 is 1.10.2, which cannot create paths over
   260 characters, and React Native codegen paths under `app\.cxx\...` are longer than that even
   from `C:\aa\probe`. **Fixed machine-wide for this SDK**: `ninja.exe` in
   `D:\tools\android\sdk\cmake\3.22.1\bin` and `...\3.30.5\bin` was replaced with ninja 1.13.2
   (official GitHub release; a copy is in `D:\tools\android\ninja\ninja.exe`; the originals are
   kept beside them as `ninja-1.10.2.exe`). Windows `LongPathsEnabled=1` was already on. If an SDK
   update reinstalls CMake, copy `D:\tools\android\ninja\ninja.exe` over the new `bin\ninja.exe`
   again. After this failure, delete `android\app\.cxx` before retrying. Still keep project paths
   short (`C:\aa\apps\<slug>`).
2. **`sdkmanager` package syntax changed.** cmdline-tools 23 prints that `sdkmanager` is
   deprecated in favour of the `android sdk` CLI, and the `.bat` wrapper splits arguments on `;`.
   Use slashes: `sdkmanager --sdk_root=D:\tools\android\sdk platforms/android-37.0 build-tools/37.0.0`.
   Licences no longer need `--licenses`. compileSdk 37 is the package `platforms/android-37.0`.
3. **Old tools on the user PATH.** `java` on PATH is Java 8 and `adb` on PATH is
   `C:\Program Files (x86)\Minimal ADB and Fastboot\adb.exe` (1.0.39). Running that old adb
   restarts the shared adb server with a version mismatch and drops every thread's connection.
   Always load `android-env.ps1` (it puts the right ones first) or call
   `D:\tools\android\sdk\platform-tools\adb.exe` by full path. This really happens: at 09:05 the
   running server was version 39 (someone had used the old adb), and the next SDK adb call
   printed `adb server version (39) doesn't match this client (41); killing...` and restarted it.
   Both emulators reconnected within seconds, but any adb command in flight at that moment fails.
4. **The emulator dies when the shell that started it ends.** Agent tools (Claude Code's
   PowerShell/Bash tools) kill the process tree when a command finishes, so an emulator started
   with `Start-Process` or `&` from an agent shell is closed seconds later. `start-emulator.ps1`
   launches it through `Win32_Process.Create` (parent: `WmiPrvSE`), which survives. Use the
   script; do not start the emulator any other way.
5. **The emulator is shared and can be killed by someone else.** At 07:54 the running `anyapp`
   emulator exited without anyone in this thread asking, and another thread restarted it with
   `start-emulator.ps1` two minutes later. Before using it, always run `start-emulator.ps1`
   (idempotent). Never run `adb emu kill`, `adb kill-server`, `emulator -wipe-data` or uninstall
   another thread's package. Other threads also bring their apps to the foreground at any time,
   so check UI state right after launching your own app (`am start -W -n <pkg>/.MainActivity`).
6. **Git Bash rewrites device paths.** In Git Bash, `adb shell cat /sdcard/x` becomes
   `C:/Program Files/Git/sdcard/x`. Prefix with `MSYS_NO_PATHCONV=1` or use PowerShell.
7. **Gradle metaspace.** With prebuild's default `-Xmx2048m -XX:MaxMetaspaceSize=512m` the daemon
   ran out of metaspace in the first build ("Daemon will be stopped at the end of the build after
   running out of JVM Metaspace"). Use `-Xmx4g -XX:MaxMetaspaceSize=1g`.
8. **PowerShell and Gradle properties with commas.** `-PreactNativeArchitectures=x86_64,arm64-v8a`
   unquoted in PowerShell is parsed as an array ("Missing argument in parameter list"). Quote it:
   `'-PreactNativeArchitectures=x86_64,arm64-v8a'`, or set `reactNativeArchitectures` in
   `android/gradle.properties`.
9. **First cold boot is slow.** The very first boot of a new AVD took ~5 minutes; after that the
   quick-boot snapshot makes it ~12 s. `start-emulator.ps1` waits up to 300 s by default; pass
   `-TimeoutSec 600` after `-ColdBoot`.
10. **JDK.** Expo SDK 58 / AGP 9.2.1 build fine with the existing JDK 21 (`D:\tools\android\jdk`);
    JDK 17 is not needed and was not installed.
11. **Emulator not upgraded.** sdkmanager offers emulator 37.2.13; it was left at 37.2.12 because
    the `ghostex` project shares this SDK.
