# Releasing Kiwimake

A release is a GitHub release on `maddada/Kiwimake` with thirteen files. The desktop app's
download QR and the README link to `https://github.com/maddada/Kiwimake/releases/latest/download/<name>`,
so the phone APKs keep their old names for good (desktop apps already installed download
`AnyAppAgent.apk`, even after the rename to Kiwimake). The installer is `Kiwimake-Setup.exe` from
0.3.0 on (0.2.0 and earlier published it as `AnyAppAgent-Setup.exe`; nothing downloads it by name):

| File | What |
| --- | --- |
| `AnyAppAgent.apk` | The phone app, arm64-v8a only (nearly every phone). |
| `AnyAppAgent-universal.apk` | The phone app, arm64-v8a and x86_64 (emulator, x86 tablets). |
| `Kiwimake-Setup.exe` | The Windows installer (electron-builder names it `Kiwimake-Setup-<version>.exe`; upload it renamed). |
| `AnyAppAgent-Setup.exe` | An identical copy of the signed Windows installer, for older links. |
| `Kiwimake-x86_64.AppImage` | Linux, x64, most distributions: download, make executable, run. |
| `kiwimake_amd64.deb` | Linux, x64, Ubuntu and Debian: `sudo apt install ./kiwimake_amd64.deb`. |
| `Kiwimake-mac-arm64.dmg` | macOS, Apple silicon (M1 and later): Developer ID signed and notarized. |
| `Kiwimake-mac-x64.dmg` | macOS, Intel. |
| `Kiwimake-mac-arm64.zip`, `Kiwimake-mac-x64.zip` | The same Mac apps, for the desktop's own updater (Squirrel.Mac reads a zip). |
| `latest.yml`, `latest-mac.yml`, `latest-linux.yml` | The desktop's update feeds ("Updates of the desktop app" below). |

The Linux names carry no version, so `releases/latest/download/<name>` always works; electron-builder
writes them under these names directly (`desktop/package.json`, `appImage.artifactName`,
`deb.artifactName` and the Mac `artifactName`). The website's download section links to the
Windows and Linux installers and the phone APK (not `AnyAppAgent-Setup.exe`,
`AnyAppAgent-universal.apk`, the Mac files, the zips or the feeds).

## The phone app's release key

The phone app (`com.anyappagent`) is signed with its own release key since 0.2.0. Before that it
was signed with the public React Native debug key, which anyone could use to make an "update" of
it. Phones only accept an update signed with the same key as the installed app, so **this key must
never be lost or replaced**: a different key means every user has to uninstall and reinstall.

It lives on the release PC only, never in Git:

| What | Where |
| --- | --- |
| The key (PKCS12, alias `anyappagent`, RSA 4096) | `%USERPROFILE%\.anyappagent-release\anyappagent-release.p12` |
| Encrypted backup (AES-256-GCM, scrypt from the password) | `%USERPROFILE%\.anyappagent-release\anyappagent-release.backup` |
| The password | Windows Credential Manager, generic credential `AnyAppAgent/phone-release-key` |

The folder is readable only by the Windows user who made it (and SYSTEM). Certificate SHA-256:
`0b0621e6b764ad9ade613848fe7ff97b881ade68454c01ca2be4cd4866702fd7`.

Keep a copy off this PC: copy the `.backup` file to another place (a USB stick, cloud storage) and
save the password in a password manager (`node app/scripts/release-key.mjs password` prints it).
The backup is useless without the password, and the password is only in Credential Manager on this
PC until you save it somewhere.

A copy of the key, its backup and its password live in the owner's 1Password item "AnyAppAgent phone release key".

`app/scripts/release-key.mjs`:

```
node app/scripts/release-key.mjs status              where the key is, its certificate SHA-256
node app/scripts/release-key.mjs password            prints the password
node app/scripts/release-key.mjs restore <backup>    puts the key back (on a new PC, set
                                                     ANYAPP_RELEASE_PASSWORD for that command)
node app/scripts/release-key.mjs create              only ever once; refuses if a key exists
```

Debug and test builds (`npm run apk` without `--release`, `expo run:android`) do not use it: they
keep the debug key, so the copies other work installs on the emulator are unchanged.

Apps made by Kiwimake are not signed with this key. They use the keys the companion makes on
the user's PC (`builder/lib/keystore.mjs`, `docs/DISTRIBUTION.md`).

## Versions

- Desktop: `desktop/package.json` `version` (and the root of `desktop/package-lock.json`).
- Phone: `app/app.json` `expo.version` and `expo.android.versionCode`, and `app/package.json`
  `version`. `versionCode` is `major * 10000 + minor * 100 + patch` (0.2.0 is 200) and must grow
  with every release, or phones refuse the update.
- Companion: `server/package.json` and both version fields at the root of `server/package-lock.json`.
- Keep the phone and desktop package-lock root package versions in sync too.

## Windows signing (required from 0.3.1)

`npm run dist` in `desktop/` runs `dev/release-windows.ps1`. It requires the same Certum
SimplySign certificate as [Ghostex](https://github.com/maddada/Ghostex/blob/main/docs/code-signing.md):

- Subject: `Open Source Developer Mohamad Yahia Youssef`.
- Issuer: `Certum Code Signing 2021 CA`.
- SHA-1 thumbprint: `E81BEDC91DEA38C8BB2DA3651E161ADA280B6734` (public certificate metadata).
- SHA-256 file digest and RFC 3161 timestamp at `http://time.certum.pl`.

Windows releases are signed in **GitHub Actions**, not on the user's PC. The workflow
`.github/workflows/release-windows.yml` runs on a disposable `windows-2025` runner. It checks out
an existing release tag, requires that its release is still a draft, downloads both APKs and checks
their GitHub SHA-256 digests, installs the companion and desktop dependencies, and runs their checks.
Then it installs the pinned SimplySign Desktop MSI on the runner, verifies the MSI's hash and Asseco
signature, logs in, builds and signs the desktop app, and uploads both installer names to the draft.
It downloads the uploaded installers and verifies their signatures and hashes again. It never makes
the release public.

The login implementation is copied and adapted from Ghostex's
`tooling/release-gpui/certum-simplysign-login.ps1`, called by its Windows workflow through
`release-amend-existing.yml`'s `sign_windows` input. It uses the same RFC 6238 code generation and
SimplySign window interaction. This repository contains its own copy and never imports from Ghostex.
Install, login and logout refuse to run outside GitHub-hosted Windows runners. No signing software
needs to be installed on the user's PC. No screenshots or credential files are uploaded.

Required repository Actions secrets:

- `CERTUM_SIMPLYSIGN_EMAIL`: the SimplySign account email.
- `CERTUM_SIMPLYSIGN_TOTP`: the current activation `otpauth://` URI or base32 seed, not a temporary code.

The release operator can set these in GitHub Settings, Secrets and variables, Actions. When stored in
1Password, transfer them from `op read` into `gh secret set <name> --repo maddada/Kiwimake` through
stdin only. Never print values, put them in command arguments, write them to the repository, or try to
read GitHub secrets back. If either value is unavailable, stop before publishing. The private signing
key stays in Certum's cloud. The login step receives the credentials through its environment; later
build steps do not. A failed login or signature check leaves the release as a draft.

The script finds the Windows SDK's **x64** signtool (or uses `SIGNTOOL_PATH`). After certificate
renewal, set the repository variable `CERTUM_CERT_SHA1` to the replacement certificate's public
thumbprint. The workflow passes it as `KIWIMAKE_CERTUM_CERT_SHA1`.
Electron-builder signs `Kiwimake.exe` before it goes into the installer, and signs the NSIS
uninstaller and final installer. It requires signing, rather than silently producing an unsigned
release. The script checks `signtool verify /pa /v`, the expected signer and a timestamp, then
creates and checks `desktop/dist/Kiwimake-Setup.exe` and `desktop/dist/AnyAppAgent-Setup.exe`.
Never sign only the outer installer: that would leave the installed app unsigned.

Do not run the installer or quit the user's running desktop app during a release. The user updates
the PC themselves. Keep any smoke test's settings, state, tools, apps and port separate from the
user's live instance. The desktop app updates itself from the first release after 0.3.3 ("Updates of
the desktop app" below); 0.3.3 and earlier are updated by running the downloaded installer once.
The phone app updates itself from the first release after 0.3.3 ("Updates of the phone app" below);
0.3.3 and earlier are updated by opening `AnyAppAgent.apk`, or scanning the desktop's
phone-download QR.

## Linux packages

The `linux` job of the same workflow (`release-windows.yml`, kept under its old name so existing
commands still work) runs on a disposable `ubuntu-24.04` runner, in parallel with the Windows job.
It checks the tag, the versions and that the release is still a draft, downloads both APKs and
checks their GitHub SHA-256 digests, runs the companion and desktop checks, pins the draft's APK
(`desktop/dev/pin-phone.mjs`), and runs `npm run dist:linux` in `desktop/`. It checks the .deb's
control file and contents, installs it with apt (which proves its dependencies resolve on Ubuntu
24.04), then starts the AppImage and the installed app with `desktop/dev/smoke-linux.sh` under
`xvfb-run` (own state folder, apps folder and port 8797) and waits for the companion to answer.
Only then does it upload both packages to the draft and download them again to compare the bytes.
It never makes the release public. The Linux packages are not signed (Linux has no equivalent of
Authenticode for AppImages and loose .deb files); the release page's SHA-256 digests are the check.

- **No Snap or Flatpak**: Kiwimake runs claude, codex, Git, adb and Gradle from the user's PC, so it
  must not be sandboxed.
- **AppImage**: built with electron-builder's static AppImage runtime (`toolsets.appimage`
  `1.0.3`), which needs no `libfuse2` (Ubuntu 22.04 and later do not install it). Its launcher
  (AppRun) tests `unshare -Ur true`; where unprivileged user namespaces are blocked (Ubuntu 23.10+
  AppArmor, some hardened kernels) it starts Electron with `--no-sandbox`, otherwise with
  Chromium's sandbox.
- **.deb**: installs to `/opt/Kiwimake`, links `/usr/bin/kiwimake`, adds the menu entry and icon,
  and installs electron-builder's AppArmor profile `/etc/apparmor.d/kiwimake` (allows user
  namespaces for `/opt/Kiwimake/kiwimake` only), so the Chromium sandbox stays on. Where there are no
  user namespaces at all it makes `chrome-sandbox` setuid root instead. Depends on Git (the
  companion needs it; Kiwimake downloads the JDK, Android SDK and Node itself).
- **Size**: about 126 MB AppImage and 106 MB .deb (310 MB installed); the companion's own copy of
  Claude Code's binary is left out as on Windows (the user's installed CLI is used).

Test a workflow change without a release: push a branch, then run
`gh workflow run release-windows.yml --repo maddada/Kiwimake --ref <branch> -f tag=<branch> -f dry_run=true`.
A dry run skips the Windows and verify jobs (no Certum login), needs no draft and uploads nothing
to any release: it builds, installs and smoke-tests both Linux packages, builds, signs, notarizes and
checks both Macs (ad-hoc when the Developer ID secrets are not all set, "macOS" below), and keeps
them with their update feeds as the `linux-packages` and `mac-packages-release` (or
`mac-packages-adhoc`) workflow artifacts for 7 days. `-f dry_run_version=0.3.98` builds them as
another version, so two dry runs give an older and a newer copy to test an update with (the artifact
names end with the version).

Locally on Linux: `cd desktop && npm run dist:linux`, then `dev/smoke-linux.sh dist/Kiwimake-x86_64.AppImage`.
On Arch, electron-builder's bundled fpm needs `libcrypt.so.1` (package `libxcrypt-compat`) for the .deb.

## Updates of the desktop app

Copied in spirit from Ghostex (read only, never imported): Ghostex updates its native Mac app with
Sparkle and an EdDSA-signed appcast, its Windows app with Velopack and its AppImage with
AppImageUpdate. Kiwimake is one Electron app, so it uses **electron-updater**
(`desktop/src/main/updates.ts`), which does the same for all four installers from one kind of feed.
Sparkle itself is a native Mac framework and does not fit an Electron app.

**The feed.** `desktop/package.json` `build.publish` is electron-updater's generic provider at
`https://github.com/maddada/Kiwimake/releases/latest/download`; electron-builder writes it into each
build as `resources/app-update.yml`. The app reads `latest.yml` (Windows), `latest-mac.yml` or
`latest-linux.yml` from the newest public release, so a draft is never offered. CI writes each feed
from the final signed and stapled files under their stable names with `desktop/dev/update-feed.mjs`
(the version, and each file's size and SHA-512), and checks it again after the upload.

**What is checked before an update is installed:**

- Every download: its size and SHA-512 against the feed, which comes from GitHub over HTTPS.
- Windows: the downloaded installer must carry a valid Authenticode signature by
  `Open Source Developer Mohamad Yahia Youssef` (`win.signtoolOptions.publisherName`, written into
  `app-update.yml`); anything else is refused.
- macOS: Squirrel.Mac replaces the app only with one that satisfies the running app's code
  signature requirement (the same Developer ID team). An ad-hoc build cannot update itself.
- Linux: the SHA-512 only (Linux has no signature check for AppImages or loose .debs). The feed
  itself is not separately signed; see "Signing the feed" below.

**How each installer updates:**

| Installer | How |
| --- | --- |
| Windows (NSIS, per user) | Downloads `Kiwimake-Setup.exe`, checks its signature, runs it silently, which replaces the app and starts it again. No administrator prompt. |
| macOS | Downloads the zip for this Mac (`arm64` or `x64`); Squirrel.Mac checks it, swaps the app and starts it again. |
| AppImage | Downloads `Kiwimake-x86_64.AppImage`, replaces the file the person started (same path and name) and starts it. |
| .deb | Downloads `kiwimake_amd64.deb` and installs it with `pkexec dpkg -i`: the PC asks for the person's password. Cancelling leaves the old version running. |

A copy from anywhere else (a source checkout, an unpacked Linux folder) says in Settings that it does
not update itself, and never looks.

**The person stays in control.** With "Update Kiwimake by itself" on (Settings, Updates; the default)
it looks 30 seconds after it starts and every 6 hours, and downloads a new version in the background.
Nothing is installed until they click **Restart to update** in the notice over the apps list (or in
Settings). If an app is being changed or built at that moment (an agent turn or a build), or the
Android tools, the AI engine or dictation are being installed, Kiwimake says what it is waiting for
and restarts only when that is done ("Don't wait" cancels). Before the installer starts, Kiwimake stops
its companion and lets go of its one-copy lock, so the new copy starts cleanly. If the installer does
not start (a cancelled password prompt, a refused signature), the companion starts again and the
notice offers Try again. With automatic updates off it never looks by itself; Check now still works.
It never installs on quit, never downgrades and never takes a prerelease.

Settings, apps, the state folder, tools and the phone pairing live outside the app, so an update
keeps them (proven with the AppImage, below).

**Test an update without a release.** Build two copies with different versions, serve a folder with
the newer file and its feed, and start the older one against it with its own state:

```bash
cd desktop && npx electron-vite build
npx electron-builder --linux AppImage --x64 --publish never -c.extraMetadata.version=0.3.98 -c.directories.output=/tmp/k-old
npx electron-builder --linux AppImage --x64 --publish never -c.extraMetadata.version=0.3.99 -c.directories.output=/tmp/k-new
# a folder with the newer Kiwimake-x86_64.AppImage and a latest-linux.yml for it, served on any port
ANYAPP_UPDATE_FEED=http://127.0.0.1:<feed port>/ ANYAPP_UPDATE_FIRST_CHECK_MS=3000 \
  ANYAPP_STATE_DIR=<dir>/state ANYAPP_APPS_DIR=<dir>/apps ANYAPP_PORT=<not 8787> ANYAPP_ENGINE_UPDATES=off \
  <dir>/Kiwimake-x86_64.AppImage
```

`ANYAPP_UPDATE_FEED` points any packaged copy at another feed; `ANYAPP_UPDATE_FIRST_CHECK_MS` makes
the first look sooner. `desktop/dev/prove-update-linux.sh` does all of it and checks the result. On a
Mac, the same works with two disk images from dry runs of the release workflow (macOS, below):
install the older one in /Applications, serve the newer zip with a `latest-mac.yml`.

**Signing the feed** (not done, a possible next step): Sparkle signs Ghostex's appcast with an
EdDSA key. electron-updater has no such check, so a changed feed on GitHub plus a changed Linux file
would pass on Linux (Windows and macOS still check the publisher's signature). Adding it means a new
Ed25519 key, kept like the phone's update key, and a check of a `latest-*.yml.sig` before the
updater reads the feed.

## Updates of the phone app

Copied from Ghostex's phone app (read only, never imported). A release APK (built with `--release`,
which sets `KIWIMAKE_RELEASE=1` for `app/app.config.js`) updates itself in two ways. Debug and test
builds do neither, so a debug-signed copy never offers the release APK.

**A newer APK** (`app/src/lib/appUpdate.ts`, `app/src/lib/releaseFeed.ts`). At start, when it comes
back to the front (at most every 6 hours) and on Settings, Updates, Check now, the phone reads
`https://api.github.com/repos/maddada/Kiwimake/releases/latest`. That GitHub release is the
update metadata; there is no other feed. The phone takes the release's version from its tag
(`v<version>`) and, when it is newer than its own `versionName`, the asset for its processor:
`AnyAppAgent.apk` (primary ABI arm64-v8a) or `AnyAppAgent-universal.apk` (anything else, the
emulator). It downloads it into its cache, checks the size and the SHA-256 GitHub lists for the
asset (`digest`), checks it is signed with the same key as itself, and opens Android's installer.
Android replaces Kiwimake keeping its data (the pairing, the apps list, the settings) and offers
Open. The home screen shows a notice ("Kiwimake <version> is ready to install", Not now, Install).
It does not offer the APK when the update server already gives this APK that release over the air
(`/v1/status`, below). So a release must keep:

- The tag `v<version>` equal to `app/app.json` `expo.version` (MAJOR.MINOR.PATCH), and the release
  marked latest, not a draft or prerelease (`gh release edit --latest`, step 6 below).
- The two APK names. They are the same files `desktop/phone-release.json` pins, so the desktop's
  download and the phone's own update are always the same bytes.
- The release key. An APK signed with any other key is refused before Android sees it.

**Over-the-air JavaScript** (`expo-updates`, `app/src/lib/overTheAir.ts`). A change to JavaScript
only reaches phones without a new APK, from Kiwimake's update server: a Cloudflare Worker with one
R2 bucket at `https://ota.kiwimake.ai` (`website/ota-server/`, its README has the setup and the
local test). The phone checks at every launch and when it comes back to the front (at most every
30 minutes), downloads in the background, and runs the update at the next launch or when the
person taps Restart now. Only APKs with the same **runtime version** take an update: a hash of the
native inputs (`node app/scripts/ota-runtime-version.js --explain` lists them; the release version
fields are left out). Change any of them and the release needs a new APK.

Every update is signed. The app carries the certificate `app/certs/certificate.pem` (CN "Kiwimake
phone app updates", valid until 2056, SHA-256
`B0:9F:7F:AD:F6:4B:32:42:49:87:36:30:EB:BB:F8:EE:7D:1C:DC:E6:C3:67:86:86:8F:FD:46:FB:6F:A6:3F:6D`)
and refuses anything else. The release PC keeps, never in Git:

| What | Where |
| --- | --- |
| The update signing key (RSA, PEM) | `~/.anyappagent-release/ota-signing/private-key.pem` (folder `700`, file `600`) |
| The update server's upload token | `~/.anyappagent-release/ota-upload-token`, or `KIWIMAKE_OTA_UPLOAD_TOKEN` |

Both are backed up, with the public key and the certificate, in the owner's 1Password item
"Kiwimake OTA" (vault Personal); `bash ~/.appwin-secrets/restore-secrets.sh ota` restores them on a
new release PC. Losing the key stops updates until every phone installs an APK with a new
certificate. The server is live since 2026-11-17 (`website/ota-server/README.md`).

`app/scripts/ota-export.mjs` and `app/scripts/ota-publish.mjs` (run from `app/`):

```
node scripts/ota-export.mjs <dir> [--whats-new '["One short line."]']   the update, from a clean checkout
node scripts/ota-publish.mjs publish <dir> [--new-runtime] [--dry-run]  signs and uploads it
node scripts/ota-publish.mjs status [--runtime <rv>]                    what phones on a runtime get now
node scripts/ota-publish.mjs rollback-to-embedded --runtime <rv>        phones go back to the APK's own code
node scripts/ota-publish.mjs history --runtime <rv>
node scripts/ota-publish.mjs republish --runtime <rv> --from <name>     serve an earlier update again
```

`publish` refuses a runtime the server has never served unless `--new-runtime`: no installed app
runs it, which is right only when the APK with that runtime is released at the same time. An
update that crashes before its first screen is rolled back on the phone by expo-updates itself.

A fix that is only JavaScript can go out without a GitHub release: commit it, then from a clean
checkout `node scripts/ota-export.mjs <dir>` and `node scripts/ota-publish.mjs publish <dir>`. It
carries `app.json`'s version (the newest release's), so phones read it as that release plus a fix.
Never publish an update a thread has not been told to publish.

## Build

From PowerShell, in a clean checkout of the commit to release (a worktree is fine), with the
toolchain from `docs/ENVIRONMENT.md`:

```powershell
. C:\dev\AnyAppAgent\scripts\android-env.ps1
cd app;     npm ci; npm run typecheck; npm run lint
node scripts/build-apk.mjs --clean --release   # prints both APKs with size and sha256
cd ..\desktop; npm ci; npm run typecheck; npm test
# Windows signing and Linux packaging run in release-windows.yml after the APKs are on the draft.
```

`build-apk.mjs --release` reads the key and password (above), loads
`app/scripts/release.init.gradle` (release signing, one APK per ABI plus a universal one,
compressed native libraries, R8 as Expo configures it), and writes `app/dist/AnyAppAgent.apk`
(arm64-v8a) and `app/dist/AnyAppAgent-universal.apk`. The desktop installer bundles no APK:
`desktop/dev/release-windows.ps1` first runs `desktop/dev/pin-phone.mjs`, which writes the
version, size and SHA-256 of `app/dist/AnyAppAgent.apk` into `desktop/phone-release.json`. The
installed desktop downloads `releases/download/v<version>/AnyAppAgent.apk` the first time it
offers the phone download, checks it against that pin and keeps it in its state folder; the
companion serves that file for the download QR. So the release must publish the exact APK that was
pinned, which the workflow guarantees by building from the draft's assets.

`--release` also turns on the phone's own updates (above): it regenerates `android/` every time,
with the runtime version of this checkout. Export the over-the-air update of the same commit right
after the build, from the same clean checkout (it refuses uncommitted changes):

```powershell
node scripts/ota-export.mjs ..\ota-<version> --whats-new '["One short line per change."]'
```

Rebuild the Easy Connect bridge before a phone release so it gets the strip flags
(`node server/easy-connect/build-android-bridge.mjs`, then `npm run apk` stages it).

Check the signature before publishing:

```powershell
apksigner verify --print-certs app\dist\AnyAppAgent.apk   # SHA-256 digest must be the one above
```

## Test, then publish

1. Install `AnyAppAgent-universal.apk` on the emulator (`docs/ENVIRONMENT.md`), pair it with a
   companion of your own (own port and state folder), and let it receive an app.
2. Run the installed desktop app (or `desktop\dist\win-unpacked\Kiwimake.exe` from the build)
   against a test state folder and check it starts and its companion answers.
3. Before any push, scan every unpushed commit, including removed lines and intermediate versions,
   for API keys, private keys, credential files and passwords. Print file and line only for matches.
   If an actual secret is found, stop and push nothing. Commit the version and release automation.
4. Tag the commit (`git tag -a v<version>`), push main and the tag, then create a **draft** with the APKs:

```powershell
gh release create v<version> --repo maddada/Kiwimake --verify-tag --draft `
  --title "Kiwimake <version>" --notes-file notes.md `
  app\dist\AnyAppAgent.apk app\dist\AnyAppAgent-universal.apk
gh workflow run release-windows.yml --repo maddada/Kiwimake --ref main -f tag=v<version>
```

5. The workflow definition runs from main so CI fixes do not require moving a release tag; its
   checkout always builds the supplied tag. Wait for all four jobs (`windows`, `mac`, `linux`, then
   `verify`) to succeed. `verify` downloads all thirteen files from the draft and checks the three
   update feeds against them; it is the gate for step 6. The `windows-signing-evidence` artifact contains the signed
   `Kiwimake.exe` and `signatures.json`. Download both installer names from the draft and run
   `signtool verify /pa /v` on them. Check the exact signer above, the certificate thumbprint, a valid
   timestamp, and identical hashes for the two installer names. Check the APKs against the locally
   verified signed outputs. Do not run the installer or change the user's running app.
   Download both Linux packages from the draft and check their SHA-256 against the `linux` job's
   summary. The `mac` job already ran `desktop/dev/verify-mac.sh` (Developer ID, hardened runtime,
   notarized, stapled, accepted by Gatekeeper) on both disk images and both zips.
6. Publish the over-the-air update exported with the build (`app/`, with the signing key and the
   upload token from "Updates of the phone app"). Add `--new-runtime` when this release changed
   the runtime version (the export prints it; `status` says whether the server has served it):

```powershell
node scripts/ota-publish.mjs publish ..\ota-<version> [--new-runtime]
node scripts/ota-publish.mjs status   # the new version and its date
```

   Do it before the release goes public: phones whose APK has this runtime then take it over the
   air, and the APK updater offers the new APK only to phones on an older runtime.
   Then, only when the `verify` job passed (all thirteen files present, feeds matching), publish the draft:

```powershell
gh release edit v<version> --repo maddada/Kiwimake --draft=false --latest
```

7. Check that every `releases/latest/download/<name>` link returns the new file (size and SHA-256).
   Check that `releases/latest/download/latest.yml` (and the Mac and Linux feeds) name the new
   version: from then on every desktop copy with automatic updates on downloads it within 6 hours.
   A failed or interrupted job must never expose a release without all thirteen files.
   Rerun the workflow against the same draft; it replaces only the installer, package and feed assets.

## Release notes

Each release's notes end with these two paragraphs (adjust the versions):

```markdown
Kiwimake on your computer updates itself from this version on: it downloads the update in the
background and installs it when you click Restart to update (Settings, Updates). From 0.3.3 or
earlier, download and install it once: Kiwimake-Setup.exe (Windows), Kiwimake-mac-arm64.dmg
(Apple silicon Macs) or Kiwimake-mac-x64.dmg (Intel Macs), Kiwimake-x86_64.AppImage or
kiwimake_amd64.deb (Linux). The Windows installer and app are signed by Open Source Developer
Mohamad Yahia Youssef using Certum; the Mac app is signed with Apple Developer ID Mohamad Youssef
(KTKP595G3B) and notarized by Apple.

Update your phone by opening AnyAppAgent.apk, or scanning the phone-download code in the desktop
app. Install over your existing copy to keep your data. AnyAppAgent-universal.apk also supports
x86_64 devices. AnyAppAgent-Setup.exe is the same Windows installer under its old name.
```

From the next release on, the first paragraph is only: Kiwimake on your computer updates itself
(Settings, Updates). New downloads: the same file names as above.


## Manual installer test builds

`windows-installer.yml` is retained for artifact-only test builds. It also uses this repository's
`desktop/dev/certum-simplysign-login.ps1` on a GitHub-hosted Windows runner and the signing hook in
`desktop/dev/sign-certum.cjs`. Its optional unsigned test mode does not publish releases. Use
`release-windows.yml` for releases: it requires signing, checks the tag and both APKs, uploads both
installer names, verifies the uploaded bytes, and keeps the release a draft.

Certum accepts each one-time code once. Avoid starting a signing job while a Ghostex or codex-swap
job is logging in to the same SimplySign account.

## macOS

The `mac` job of `release-windows.yml` runs on a disposable `macos-15` runner (Apple silicon), in
parallel with the Windows and Linux jobs. `npm run dist:mac` in `desktop/` runs `dev/build-mac.mjs`:
`electron-vite build`, then electron-builder's `mac` target for both processors, with stable names
ready for `releases/latest/download/<name>` links:

| File | What |
| --- | --- |
| `Kiwimake-mac-arm64.dmg` | Apple silicon (M1 and later), for people. |
| `Kiwimake-mac-x64.dmg` | Intel Macs. |
| `Kiwimake-mac-arm64.zip`, `Kiwimake-mac-x64.zip` | The same apps for the updater (Squirrel.Mac reads a zip). |
| `latest-mac.yml` | Their update feed (`dev/update-feed.mjs`). |

Two images, not one universal app: the companion's runtime packages are staged per architecture
(`dev/after-pack.cjs` runs `npm ci --cpu=<arch> --os=darwin`), and a universal merge would need
both sets to be identical.

### Developer ID signing and notarization

The same Apple Developer ID Application certificate and notarization account as Ghostex:
`Developer ID Application: Mohamad Youssef (KTKP595G3B)`, valid until 2031-02-09.

1. The job makes a keychain of its own with a random password, imports the certificate into it, and
   stores the notarization credentials in it as the notarytool profile `kiwimake-notary`
   (`notarytool store-credentials` checks them with Apple first). The keychain is deleted at the end.
2. electron-builder signs every binary in the app with the Developer ID, hardened runtime and
   `dev/entitlements.mac.plist` (JIT and unsigned executable memory for V8; library validation off,
   for the companion's native modules run by Electron in Node mode; the microphone for dictation),
   with a secure timestamp, then notarizes the app and staples its ticket before it makes the disk
   images and zips (`-c.forceCodeSigning=true`: no Developer ID, no build).
3. `build-mac.mjs` then signs each disk image (`dmg.sign`), notarizes it and staples it too, so
   Gatekeeper accepts it before it is opened, even offline.
4. `dev/verify-mac.sh` checks, in CI, for both processors: the disk image (`codesign --verify --strict`,
   the Developer ID authority, `spctl --assess --type open --context context:primary-signature`,
   `stapler validate`), and the app inside it and inside the zip (`codesign --verify --deep --strict`,
   authority and team, hardened runtime flag, secure timestamp, the entitlements,
   `spctl --assess --type execute`, `stapler validate`).
5. The job starts the Apple silicon app from its disk image with its own state folder, apps folder and
   port 8797, and waits for the companion to answer (Electron in Node mode under hardened runtime).

The first open then shows only macOS's usual "Kiwimake is an app downloaded from the Internet. Are you
sure you want to open it?" with an Open button.

Required repository Actions secrets (the names Ghostex uses for the same values):

| Secret | What | Where the value is kept |
| --- | --- | --- |
| `APPLE_DEVELOPER_ID_P12_BASE64` | The certificate and its private key, `.p12`, base64 | 1Password, Personal, "2026-02-09 Apple Developer Certificate (Outside App store)" (the `.p12` file) |
| `APPLE_DEVELOPER_ID_P12_PASSWORD` | That `.p12`'s password | Not in 1Password; Ghostex's copy is in its GitHub secrets only |
| `APPLE_NOTARY_APPLE_ID` | The Apple ID that notarizes | 1Password, Personal, "2026-03-25 Apple Dev Generated Password and certificate to sign apps" |
| `APPLE_NOTARY_TEAM_ID` | `KTKP595G3B` | Same item |
| `APPLE_NOTARY_APP_PASSWORD` | An app-specific password of that Apple ID | Same item |

Transfer them like the Certum secrets: `op read` into `gh secret set <name> --repo maddada/Kiwimake`
through stdin only, never printed. For the certificate: `base64 -w0 <file.p12> | gh secret set
APPLE_DEVELOPER_ID_P12_BASE64 --repo maddada/Kiwimake`. A new `.p12` can be exported from the Mac
that holds the certificate (Keychain Access, My Certificates, "Developer ID Application: Mohamad
Youssef", Export, with a new password); set both P12 secrets from that export.

A release run stops when any of them is missing. A dry run builds an ad-hoc copy instead (and still
checks the notarization credentials with Apple when they are set) and says so in the job summary.

### On a Mac by hand

`npm run dist:mac` makes the signed and notarized build too, with the Developer ID in the login
keychain and a notarytool profile: `xcrun notarytool store-credentials kiwimake-notary --apple-id
<id> --team-id KTKP595G3B` (it asks for the app-specific password), then
`APPLE_KEYCHAIN_PROFILE=kiwimake-notary npm run dist:mac`. Without a Developer ID,
`npm run dist:mac -- --adhoc` makes an ad-hoc signed copy (no hardened runtime, not notarized), which
cannot update itself and which macOS opens only after "Open Anyway":

What a person sees (checked on macOS 27.0.1, Apple silicon, with a DMG carrying the browser's
quarantine flag): they open the DMG, drag Kiwimake to Applications and open it. macOS refuses:

> **"Kiwimake.app" Not Opened**
> Apple could not verify "Kiwimake.app" is free of malware that may harm your Mac or compromise your privacy.
> [Move to Trash] [Done]

There is no Open button, and since macOS 15 Control-click, Open no longer gets past it. To open it they click
**Done**, then go to System Settings, Privacy & Security, scroll to Security, click **Open Anyway**
next to "Kiwimake.app was blocked…", confirm with their password or Touch ID, and choose **Open
Anyway** once more. (Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/Kiwimake.app`.)
(The dialog above was seen in the test; the Settings steps are macOS's standard way and were not
clicked through, because answering security prompts is the person's own decision.) After that it
opens normally, until a new version is downloaded. While the first "Not Opened" prompt is still on
screen, macOS holds that copy: opening it again stops before it starts, and even a copy started
another way from that folder never shows its window. Click Done first.
