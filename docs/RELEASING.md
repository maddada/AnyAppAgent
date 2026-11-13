# Releasing Kiwimake

A release is a GitHub release on `maddada/AnyAppAgent` with three files. The desktop app's
download QR and the README link to `https://github.com/maddada/AnyAppAgent/releases/latest/download/<name>`,
so the phone APKs keep their old names for good (desktop apps already installed download
`AnyAppAgent.apk`, even after the rename to Kiwimake). The installer is `Kiwimake-Setup.exe` from
0.3.0 on (0.2.0 and earlier published it as `AnyAppAgent-Setup.exe`; nothing downloads it by name):

| File | What |
| --- | --- |
| `AnyAppAgent.apk` | The phone app, arm64-v8a only (nearly every phone). |
| `AnyAppAgent-universal.apk` | The phone app, arm64-v8a and x86_64 (emulator, x86 tablets). |
| `Kiwimake-Setup.exe` | The Windows installer (electron-builder names it `Kiwimake-Setup-<version>.exe`; upload it renamed). |

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

## Build

From PowerShell, in a clean checkout of the commit to release (a worktree is fine), with the
toolchain from `docs/ENVIRONMENT.md`:

```powershell
. C:\dev\AnyAppAgent\scripts\android-env.ps1
cd app;     npm ci; npm run typecheck; npm run lint
node scripts/build-apk.mjs --clean --release   # prints both APKs with size and sha256
cd ..\desktop; npm ci; npm run typecheck; npm test
npm run dist                                   # dist\Kiwimake-Setup-<version>.exe
```

`build-apk.mjs --release` reads the key and password (above), loads
`app/scripts/release.init.gradle` (release signing, one APK per ABI plus a universal one,
compressed native libraries, R8 as Expo configures it), and writes `app/dist/AnyAppAgent.apk`
(arm64-v8a) and `app/dist/AnyAppAgent-universal.apk`. The desktop installer bundles the universal
one (`desktop/package.json`, `extraResources`), which the companion serves to phones on the same
Wi-Fi for the download QR.

Check the signature before publishing:

```powershell
apksigner verify --print-certs app\dist\AnyAppAgent.apk   # SHA-256 digest must be the one above
```

## Test, then publish

1. Install `AnyAppAgent-universal.apk` on the emulator (`docs/ENVIRONMENT.md`), pair it with a
   companion of your own (own port and state folder), and let it receive an app.
2. Run the installed desktop app (or `desktop\dist\win-unpacked\Kiwimake.exe` from the build)
   against a test state folder and check it starts and its companion answers.
3. Tag the commit (`git tag -a v<version>`), push main and the tag, then:

```powershell
gh release create v<version> --repo maddada/AnyAppAgent --title "Kiwimake <version>" --notes-file notes.md `
  app\dist\AnyAppAgent.apk app\dist\AnyAppAgent-universal.apk "Kiwimake-Setup.exe"
```

4. Check that each `releases/latest/download/<name>` link returns the new file (size and sha256).

## Windows code signing

`Kiwimake-Setup.exe` is Authenticode-signed with the Certum "Open Source Code Signing in the Cloud"
certificate that also signs Ghostex and codex-swap (`CN=Open Source Developer Mohamad Yahia Youssef`,
serial `0436c352e3cb5e9769206a31b40ce463`, SHA-1 `E81BEDC91DEA38C8BB2DA3651E161ADA280B6734`, valid
until 2027-11-09). Its private key stays in Certum's SimplySign cloud, so the signed installer is
built on GitHub, not on the release PC: the **Windows installer** workflow
(`.github/workflows/windows-installer.yml`, manual only, never publishes) builds it on a Windows
runner, logs in to SimplySign Desktop with Ghostex's `certum-simplysign-login.ps1` (pinned to a commit
in `GHOSTEX_SIGNING_COMMIT`), and signs through `desktop/dev/electron-builder.signed.cjs` and
`desktop/dev/sign-certum.cjs`: `Kiwimake.exe`, Electron's DLLs, the uninstaller and the installer,
SHA-256 with a `time.certum.pl` timestamp. Files a vendor already signed keep their signature. Any
file that does not come out Valid, from that certificate and timestamped fails the run. The
companion's npm packages may carry third-party binaries; the run lists them and leaves them unsigned.
A local `npm run dist` stays unsigned.

It needs the repository secrets `CERTUM_SIMPLYSIGN_EMAIL` and `CERTUM_SIMPLYSIGN_TOTP` (same values as
on `maddada/Ghostex`; the TOTP value is the `otpauth://` URI from the SimplySign activation QR code,
and anyone with it and the e-mail can sign as the certificate's owner). Certum accepts each one-time
code once, so do not run it while a Ghostex or codex-swap release is logging in to SimplySign.

For a release, the installer bundles the phone APK from a release, so:

1. Create the release as a draft with the two APKs:
   `gh release create v<version> --repo maddada/AnyAppAgent --draft --title "Kiwimake <version>" --notes-file notes.md app\dist\AnyAppAgent.apk app\dist\AnyAppAgent-universal.apk`
2. Run the workflow on the release commit with that tag:
   `gh workflow run windows-installer.yml --repo maddada/AnyAppAgent --ref main -f apk_release=v<version>`
3. Download its `Kiwimake-Setup` artifact, check it on Windows (`Get-AuthenticodeSignature` shows
   `Valid` and the thumbprint above), upload it to the draft as `Kiwimake-Setup.exe`, and publish.

Without `apk_release` the run bundles the latest published APK, which is fine for a test. With `sign`
off it builds an unsigned test installer (`Kiwimake-Setup-unsigned` artifact).
