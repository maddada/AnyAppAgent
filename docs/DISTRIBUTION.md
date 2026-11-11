# Sharing apps and sending updates

The user: "i want to make the app have distribution features built in ... you can send updates
through github to people (just update the app on github releases and then people get notification
about the update they can click to dl/install) ... integrate each app that i create with github so
i can upload it there on public/private repo if i want so i dont lose code for it. sharing app
with others requires public repo tho".

Decided on the page `C:\aa\ideas\distribution.html` (2026-11-11):

- **Q54, updates:** an updater in every app, and AnyAppAgent handles updates first when it is on
  the phone (option C).
- **Q55, repos:** every new app gets a private repo. "Share with others" makes a second, public,
  releases-only repo; the code stays private.
- **Q56, signing:** one signing key per app.

This file is the plan and, stage by stage, the record of what was built and proven.

## The flow in one picture

```
Your phone (every build, as today)
  you ask for a change -> PC builds and signs -> push to private repo -> AnyAppAgent installs it

Other people's phones (only what you publish)
  Publish version -> GitHub release on the public releases repo (APKs + update.json)
  -> a friend installs once (link or QR)
  -> next release: the app's own notification -> one tap -> PackageInstaller -> installed
```

## Stages

| # | Stage | Folders | Status |
| - | ----- | ------- | ------ |
| 1 | Per-app signing keys, moving existing apps by key rotation, an encrypted backup the user can restore | `builder/`, `server/`, `desktop/`, `shared/protocol.ts`, `template-kotlin/.gitignore` | Built and proven (below) |
| 2 | Per-app private repo as today, plus "Share with others": creates and fills the public releases-only repo (README, no code), secrets scan of what goes public | `server/`, `builder/` (README writer) | Planned |
| 3 | Publish a version: GitHub release on the releases repo with the APKs already built and `update.json`; Testing channel as a pre-release; Pull back | `server/`, `shared/protocol.ts` | Planned |
| 4 | The updater module in the templates: check, notification, one-tap download, SHA-256 check, PackageInstaller install, honest states | `template/`, `template-kotlin/`, `template-exact/` (if its native modules allow it), `builder/` | Planned |
| 5 | AnyAppAgent takes over updates of shared apps when it is on the phone, with no double prompts | `app/`, `shared/protocol.ts` | Planned |
| 6 | The controls on the PC and the phone: Publish, Share with others, link and QR, downloads per version, channel, key backup | `desktop/`, `app/` | Partly in stage 1 (key backup) |

Each stage ends with a proof on `emulator-5560` and test GitHub repos that are deleted afterwards.

## 1. Signing

### Today (before stage 1)

One key per PC, `%USERPROFILE%\.anyappagent\keystore\anyapp-release.p12` (RSA 3072, 100 years,
`CN=AnyAppAgent`), signs every build of every app. Android lets an update replace an app only
when it is signed by the same key, so that key is what keeps updates safe. With one key, whoever
copies that one file can sign an update for every app the user ever shared, and every friend's
phone accepts it.

### After stage 1

- **New apps get their own key when they are made** (`createApp`):
  `keystore\apps\<package id>\release.p12` + `key.json` (its password and certificate
  SHA-256). The Gradle build signs with it directly. A key is never replaced or deleted: an app
  made again with the same package id gets the same key, so it can still update the copy on a
  phone.
- **Existing apps stay on the shared key** (Tea Timer, Water Glass, Prayer Alarm, Tip Split). Any
  app without a folder under `keystore\apps\` is a shared-key app, and builds exactly as before.
- **Moving an existing app to its own key** (`moveAppToOwnKey`; stage 2 calls it the first time
  the app is shared, and the CLI can do it by hand) uses Android's signing key rotation (APK
  Signature Scheme v3, `apksigner rotate`): a new key for the app, plus a lineage file signed by
  the shared key that says "this new key replaces me". Every later build is signed with both
  (`apksigner sign --ks <shared> --next-signer --ks <own> --lineage <file>
  --rotation-min-sdk-version 28`):
  - Android 9 and newer (API 28+) take the new key as the app's key, keep the app's data, and from
    then on **refuse updates signed with the shared key alone** (the old key's "rollback"
    capability is set to false in the lineage).
  - Android 7 and 8 (API 24 to 27; the Kotlin template's minimum is 26) do not know v3: they keep
    checking the v2 signature, made with the shared key. On those phones a moved app is still only
    as safe as the shared key. All phones seen so far run Android 13 or newer.
- **Every build is checked** after signing with `apksigner verify --print-certs`: every APK (the
  full one and each per-ABI one) must verify, and the certificates it reports must be exactly the
  ones expected (own key; or shared + own for a moved app). If the tool prints no certificate at
  all the build fails: Ghostex once shipped a check that silently read nothing after an
  `apksigner` output change.
- **Passwords never appear** in a command line, a log or the app folder: Gradle gets them as
  `ORG_GRADLE_PROJECT_*` environment variables (as before), `keytool` and `apksigner` as
  `env:` references. Keys live only under `%USERPROFILE%\.anyappagent\keystore`, never in an app
  folder, so they are never committed; the templates' `.gitignore` also drops `*.p12`, `*.jks`,
  `*.keystore` as a second guard.
- **The AI proxy** trusts an app by its signing certificate, learned when AnyAppAgent installed
  it. A new app's own certificate is learned the same way the shared one was. Stage 5 adds:
  accept an app whose signing history (`signingCertificateHistory`) holds a trusted certificate,
  so a moved app keeps AI even when its rotated update was installed by its own updater.

### Proven on the emulator (stage 1)

Done by hand first (2026-11-11, `emulator-5560`, Android 15, a throwaway Kotlin app
`com.anyapp.disttestrot` whose launch counter is kept in SharedPreferences):

| Step | Result |
| ---- | ------ |
| Build 1 with the shared key, installed, launched twice | `launches=2` |
| Build 2 signed shared + own + lineage, installed over it | Installed, `launches=3` (data kept), `dumpsys package`: signature = own key, past signatures = shared + own |
| An update signed with the shared key alone | `INSTALL_FAILED_UPDATE_INCOMPATIBLE: ... signatures do not match` |
| An update signed with the own key alone, no lineage | Installed (`launches=4`), but the device forgot the history (`past signatures:[]`) |

So the builder always signs moved apps with the lineage, never with the own key alone. The same
proof was then run through the builder itself (see "Stage 1 proof" at the end).

### Backup and restore

Losing a key means nobody can ever update that app again: they would have to uninstall it (and
lose its data) and install it fresh. So:

- **Back up** writes one file with every key on the PC (the shared key, each app's own key and
  each lineage), encrypted with a password the user chooses: scrypt (N=2^16, r=8, p=1) derives an
  AES-256-GCM key; the file holds only the format, the date, the number of keys and the ciphertext.
  The password is never stored. A wrong password or a changed file is refused (GCM tag).
- **Restore** adds every key the PC does not have. A key the PC already has with the same
  certificate is skipped; one with a different certificate is never overwritten and is reported
  by name. Restored paths are rewritten to this PC's keystore folder.
- **Where:** desktop Settings, "Signing keys": how many apps have their own key, when the last
  backup was made, Back up and Restore (Electron's save and open dialogs, a password field). The
  companion does the work (`/api/admin/keys/*`); the password goes over the admin connection on
  `127.0.0.1` only and is never logged.
- The CLI has the same: `node builder/cli.mjs keys list | backup <file> | restore <file> | move
  <app dir>` (password from `ANYAPP_KEYS_PASSWORD`, else asked for).

## 2. GitHub

### Today

`server/src/git.ts`: each app is its own Git repository with a **private** GitHub repo
`anyapp-<slug>` created with `gh repo create --private --source <dir> --push` on the account `gh`
is signed in with. Every successful build commits and pushes. `ANYAPP_GITHUB=off` turns it off; if
GitHub fails the app stays on the PC and the chat says so.

### Stage 2: "Share with others"

Release files of a private repo can only be downloaded with a token for that repo, and a token
must never be inside an app (it would give anyone who opens the APK the owner's GitHub account).
So sharing makes a second repo:

- `anyapp-<slug>-releases`, **public**, created on the first "Share with others". It holds only a
  `README.md` (what the app does, a screenshot, an Install link to the latest APK) and the
  releases. No code and no history from the private repo. (An APK can be unpacked, so this keeps
  the source private, not how the app works.)
- Before anything goes public, the files that go there are scanned for secrets (keys, tokens,
  `.env` content). A hit blocks the switch and names the file.
- The private repo stays private. "Make code public" is a separate, rarer switch (with a scan of
  the whole history), not part of the first release.
- Turning sharing off makes the releases repo private: friends then stop getting updates (their
  copy keeps working), and the chat says so.
- The repo name pattern stays strict (`REPO_NAME_PATTERN` gains `-releases`), and the server never
  deletes a repo.

## 3. The release format (stage 3)

A release on `anyapp-<slug>-releases`, tag `v<versionName>-b<build>` (only for people; nothing
parses it), made from the APKs the PC already built and the owner already ran (no rebuild):

| Asset | What |
| ----- | ---- |
| `<slug>.apk` | The full APK (every ABI) |
| `<slug>-arm64-v8a.apk`, `<slug>-x86_64.apk` | One APK per ABI, when the build made them (React Native) |
| `update.json` | What the updater reads |

```json
{
  "format": 1,
  "package": "com.anyapp.prayeralarm",
  "build": 37,
  "version": "1.4",
  "notes": "Fixed the Asr time in Ajman. Added a dark mode.",
  "publishedAt": "2026-11-20T18:00:00Z",
  "apks": [
    { "abi": "universal", "name": "prayeralarm.apk", "size": 52428800, "sha256": "..." },
    { "abi": "arm64-v8a", "name": "prayeralarm-arm64-v8a.apk", "size": 40789012, "sha256": "..." },
    { "abi": "x86_64", "name": "prayeralarm-x86_64.apk", "size": 41234567, "sha256": "..." }
  ],
  "signer": "<SHA-256 of the app's signing certificate>",
  "blocked": []
}
```

- The updater reads `https://github.com/<owner>/anyapp-<slug>-releases/releases/latest/download/update.json`:
  a download redirect on github.com, not the REST API, so it is not counted against the API's 60
  requests an hour per IP without a token (checked: `X-RateLimit-Limit: 60` on
  `api.github.com`). Ghostex's Android updater calls the API and needed a "rate limit reached"
  message; its Linux updater already reads a JSON file this way.
- It compares only `build` with the installed `versionCode`. It picks the APK for the phone's
  first supported ABI, else `universal`, and checks its size and SHA-256 before installing.
- `signer` lets the app refuse a download signed by another key before Android does, with a clear
  message instead of a failed install.
- Testing channel: a GitHub pre-release with `update-testing.json`; the updater reads it only when
  the person switched the app to Testing. `releases/latest` never returns a pre-release.
- `blocked`: builds pulled back, so an updater that has not installed one yet skips it. Android
  never installs a lower `versionCode`, so "Pull back" also rebuilds the older commit with a new,
  higher build number and publishes that.
- GitHub limits: release files up to 2 GiB each, downloads of public releases free and without an
  account. Our APKs are 1 to 50 MB.

## 4. The updater in every app (stage 4)

One Kotlin core in each template, shared by the presets (`template-kotlin` uses it directly; for
React Native and Expo Exact it is wrapped as an Expo module, like `template/modules/ai`):

- **When:** on open (at most every 6 hours, remembered across restarts) and once a day in the
  background (WorkManager), so the notification can come while the app is closed.
- **Notification:** "<App> <version> is ready. Tap to update." with the notes. Its own channel
  ("Updates"), so it can be switched off alone. A quiet line inside the app too.
- **Tap:** downloads with progress (cancellable), checks size and SHA-256, then installs with a
  PackageInstaller session (the code AnyAppAgent's `anyapp-native` already has), with the
  `ACTION_VIEW` intent as the fallback. The first time, Android asks to allow this app to install
  updates (`REQUEST_INSTALL_PACKAGES`, once per app).
- **States, in plain words:** Up to date; Version 1.4 is ready; Updating to 1.4 (18 of 42 MB); Tap
  Update in Android's box to finish; Allow <App> to install updates; nothing at all when offline
  (only "Check now" says "Couldn't check, no internet"); The download was damaged, trying again;
  This update can't replace your copy, ask whoever shared it for a new link (never loops).
- **The owner's phone:** AnyAppAgent already installs every build, so the release is never newer
  than what is installed and the app's updater stays silent.
- The updater knows its feed from a build-time value the builder writes (`anyapp.json` or
  `app.json` extra), set only when the app is shared. An app that is not shared never checks.
- Expo Exact (`template-exact/`): the updater goes in if Exact's native module support allows a
  Kotlin module; otherwise Exact apps update only through AnyAppAgent (stage 5) until it does.

## 5. AnyAppAgent first (stage 5)

- AnyAppAgent shows shared apps it did not build (a friend's app, or the owner's app on a friend's
  phone) in its grid when the person adds the share link, and watches their `update.json`.
- When AnyAppAgent is on the phone, the app's updater asks it first (a bound service like the AI
  proxy, `com.anyappagent.action.UPDATES`): if AnyAppAgent says it handles this package, the app
  shows no notification of its own. One notification, from AnyAppAgent, one install.
- AnyAppAgent's own phone app is signed with the React Native debug key, which is public. Before
  AnyAppAgent updates itself from GitHub it needs a real release key (a one-time reinstall for
  every current user). Its desktop app can use `electron-updater` with the GitHub provider.

## 6. Where each control lives (stage 6)

| Control | Desktop | Phone (AnyAppAgent) |
| ------- | ------- | ------------------- |
| Publish a version | App page: Publish version (notes drafted by the app's agent, channel) | App sheet: Publish this version |
| Share with others | Switch on the app page and in the Publish sheet | Same switch |
| Link and QR | App page | App sheet: Share |
| Downloads | Per version (GitHub counts downloads, not people) | Same number |
| Pull back a version | Versions list | Versions list |
| Signing keys backup, GitHub account | Settings | Not on the phone |

## Risks

| Risk | What we do |
| ---- | ---------- |
| A key leaks | Per-app keys: one app. Moved apps refuse the shared key on Android 9+. |
| A key is lost | Backup in Settings, and a reminder after the first share. |
| Play Protect, Google's developer verification (four countries since 2026-09-30, global in 2027) | Out of scope for these stages; needs its own look before 2027 (advanced flow, or a free limited-distribution account). |
| A bad update reaches everyone | Testing channel, publishing only builds the owner already ran, Pull back. |
| Rate limits | `releases/latest/download/update.json`, not the API; at most every 6 hours plus once a day. |

## Stage 1 proof

2026-11-11, on `emulator-5560` (Android 15) only, with SDK adb, a throwaway key folder
(`ANYAPP_HOME=C:\aa\t\dist-home`, never `%USERPROFILE%\.anyappagent`), test apps under `C:\aa\t\`
with their own package ids, and for the desktop part a separate desktop instance
(`ANYAPP_DESKTOP_USERDATA=C:\aa\t\dist-desktop`) with its own companion on port 8797 and state folder
`C:\aa\t\dist-state`. No GitHub repo was made (stage 1 has none). The user's desktop app, companion,
keys and apps were not touched.

**An existing app moves to its own key** (Kotlin, `com.anyapp.disttestrot`, a launch counter in
SharedPreferences):

| Step | Result |
| ---- | ------ |
| Build 4 (shared key, as every existing app today), fresh install, two launches | `launches=2` |
| `cli.mjs keys move`, then build 5 | Builder: "moved key"; the certificate check passed |
| Build 5 installed over build 4 | `Success`, `launches=5` (data kept), signature = own key, past signatures = shared, own |
| Build 7 re-signed with the shared key alone (a leaked shared key) | `INSTALL_FAILED_UPDATE_INCOMPATIBLE: ... signatures do not match` |
| The real build 7, then 8 and 10 | `Success`, counter still counting |

The first try of build 5 failed the certificate check on purpose: `apksigner verify` prints only the
newest scheme's signer, so the check now reads the Android 8 signer separately
(`--max-sdk-version 27`) and the lineage stored in the APK (`apksigner lineage`, which also confirms
`Has rollback capability: false` for the shared key).

**React Native, one APK per ABI** (`com.anyapp.disttestrn`, made as an "old" app with no key folder):
build 1 with the shared key, installed (`x86_64`); moved; build 2's three APKs (full, `arm64-v8a`,
`x86_64`) each verify with the own key on Android 9+ and the shared key for Android 8 and older, are
16 KB aligned (`zipalign -c -P 16 4`), and the `x86_64` one installed over build 1 and launched.

**A new app gets its own key** (`cli.mjs create`, `com.anyapp.disttestown`): "Generating the signing
key for com.anyapp.disttestown", build 1 signed with it, installed; the same build re-signed with the
shared key was refused (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Its password appears in no file under
either app folder or in the build log, and no `.p12` or lineage file is in any app folder.

**Backup and restore** (CLI and the desktop's Settings, "Signing keys"):

| Step | Result |
| ---- | ------ |
| Back up 3 (later 4) keys | One file; no password, app id or certificate text in clear |
| Wrong password; one byte of the ciphertext changed; the header's key count changed | "Wrong password, or the backup file was changed." |
| Password shorter than 8 | "The password must be at least 8 characters." |
| Keystore folder deleted, then restore | All keys added; ids, kinds and certificates identical; both apps rebuilt and installed over the phone's copies (`launches=8`) |
| Restore again | Everything "same", nothing written |
| Restore on a PC that already has a different shared key and a different key for one app | Both kept and reported as conflicts; building the moved app there fails with "was moved from a shared key this PC does not have ... Restore the key backup made on the PC that made this app" |
| Desktop: Back up (mismatched passwords, then right), Restore (wrong password, then right) | Screenshots in `C:\aa\t\shots\settings-*.png`; after restore "Last backup" shows the backup's date |

Tests: `builder/test/keys.test.mjs` (new, real keytool and apksigner), `builder/test/kotlin.test.mjs`
(two real builds) pass; `server` 51 tests (4 new in `test/signing-keys.test.ts`) and `tsc` pass;
`desktop` 45 tests and `tsc` pass.

**What this means for the user's apps today** (Tea Timer, Water Glass, Prayer Alarm, Tip Split): they
have no key folder, so they keep building with the shared key exactly as before, and the phone notices
nothing. Each one moves to its own key only when it is first shared (stage 2) or by hand with
`cli.mjs keys move`, keeping its data on Android 9 and newer as proven above. Apps made after this
change get their own key from the start.
