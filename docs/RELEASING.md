# Releasing Kiwimake

A release is a GitHub release on `maddada/AnyAppAgent` with four files. The desktop app's
download QR and the README link to `https://github.com/maddada/AnyAppAgent/releases/latest/download/<name>`,
so the phone APKs keep their old names for good (desktop apps already installed download
`AnyAppAgent.apk`, even after the rename to Kiwimake). The installer is `Kiwimake-Setup.exe` from
0.3.0 on (0.2.0 and earlier published it as `AnyAppAgent-Setup.exe`; nothing downloads it by name):

| File | What |
| --- | --- |
| `AnyAppAgent.apk` | The phone app, arm64-v8a only (nearly every phone). |
| `AnyAppAgent-universal.apk` | The phone app, arm64-v8a and x86_64 (emulator, x86 tablets). |
| `Kiwimake-Setup.exe` | The Windows installer (electron-builder names it `Kiwimake-Setup-<version>.exe`; upload it renamed). |
| `AnyAppAgent-Setup.exe` | An identical copy of the signed Windows installer, for older links. |

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
1Password, transfer them from `op read` into `gh secret set <name> --repo maddada/AnyAppAgent` through
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
user's live instance. The PC has no self-updater; run the downloaded installer to update it.
Update the phone by opening `AnyAppAgent.apk`, or scanning the desktop's phone-download QR.

## Build

From PowerShell, in a clean checkout of the commit to release (a worktree is fine), with the
toolchain from `docs/ENVIRONMENT.md`:

```powershell
. C:\dev\AnyAppAgent\scripts\android-env.ps1
cd app;     npm ci; npm run typecheck; npm run lint
node scripts/build-apk.mjs --clean --release   # prints both APKs with size and sha256
cd ..\desktop; npm ci; npm run typecheck; npm test
# Windows packaging and signing run in release-windows.yml after the APKs are on the draft.
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
gh release create v<version> --repo maddada/AnyAppAgent --verify-tag --draft `
  --title "Kiwimake <version>" --notes-file notes.md `
  app\dist\AnyAppAgent.apk app\dist\AnyAppAgent-universal.apk
gh workflow run release-windows.yml --repo maddada/AnyAppAgent --ref main -f tag=v<version>
```

5. The workflow definition runs from main so CI fixes do not require moving a release tag; its
   checkout always builds the supplied tag. Wait for it to succeed. Its `windows-signing-evidence` artifact contains the signed
   `Kiwimake.exe` and `signatures.json`. Download both installer names from the draft and run
   `signtool verify /pa /v` on them. Check the exact signer above, the certificate thumbprint, a valid
   timestamp, and identical hashes for the two installer names. Check the APKs against the locally
   verified signed outputs. Do not run the installer or change the user's running app.
6. Only when all four verified files are present, publish the draft:

```powershell
gh release edit v<version> --repo maddada/AnyAppAgent --draft=false --latest
```

7. Check that every `releases/latest/download/<name>` link returns the new file (size and SHA-256).
   A failed or interrupted Windows job must never expose a release with just the APKs. Rerun the
   workflow against the same draft; it replaces only the two Windows installer assets.

## Manual installer test builds

`windows-installer.yml` is retained for artifact-only test builds. It also uses this repository's
`desktop/dev/certum-simplysign-login.ps1` on a GitHub-hosted Windows runner and the signing hook in
`desktop/dev/sign-certum.cjs`. Its optional unsigned test mode does not publish releases. Use
`release-windows.yml` for releases: it requires signing, checks the tag and both APKs, uploads both
installer names, verifies the uploaded bytes, and keeps the release a draft.

Certum accepts each one-time code once. Avoid starting a signing job while a Ghostex or codex-swap
job is logging in to the same SimplySign account.

## macOS (not released yet)

`npm run dist:mac` in `desktop/` (on a Mac) runs `dev/build-mac.mjs`: `electron-vite build`, then
electron-builder's `mac` target, which writes two disk images with stable names, ready for
`releases/latest/download/<name>` links:

| File | What |
| --- | --- |
| `Kiwimake-mac-arm64.dmg` | Apple silicon (M1 and later). |
| `Kiwimake-mac-x64.dmg` | Intel Macs. |

Two images, not one universal app: the companion's runtime packages are staged per architecture
(`dev/after-pack.cjs` runs `npm ci --cpu=<arch> --os=darwin`), and a universal merge would need
both sets to be identical. No `.zip` is made: electron-builder needs one only for its auto-updater,
which Kiwimake does not use.

### Signing: ad-hoc today

No Apple Developer ID exists for Kiwimake yet, so the apps are **ad-hoc signed** (`"identity": "-"`)
and **not notarized**. Hardened runtime is off: only notarization needs it, and the ad-hoc build
was tested end to end without it. (A copy re-signed ad-hoc with hardened runtime and
`dev/entitlements.mac.plist` also opened and painted its window, in a quick check with the fake
companion.)

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

### What Developer ID signing and notarization need

1. An Apple Developer Program membership (99 USD a year) for the publisher, and a **Developer ID
   Application** certificate made in it (Certificates, Identifiers & Profiles).
2. The certificate and its key as a `.p12` for the build machine or CI: `CSC_LINK` (file or base64)
   and `CSC_KEY_PASSWORD`. Remove `"identity": "-"` (electron-builder then picks the Developer ID).
3. `"hardenedRuntime": true` with `"entitlements"` and `"entitlementsInherit"` set to
   `dev/entitlements.mac.plist` (JIT and unsigned executable memory for V8, library validation off
   for the companion's native modules run by Electron in Node mode, microphone for dictation).
   Run the real companion once with that combination (Electron in Node mode, Gradle, adb).
4. Notarization: `"notarize": true` and an App Store Connect API key (`APPLE_API_KEY`,
   `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) or an Apple ID with an app-specific password
   (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). electron-builder submits the app
   and staples the ticket; sign and notarize the `.dmg` too.
5. Then the first open shows only macOS's usual "Kiwimake is an app downloaded from the Internet.
   Are you sure you want to open it?" with an Open button.

