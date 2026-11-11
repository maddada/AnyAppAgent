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
| 1 | Per-app signing keys, moving existing apps by key rotation, an encrypted backup the user can restore | `builder/`, `server/`, `desktop/`, `shared/protocol.ts`, `template-kotlin/.gitignore` | Built, proven, in main |
| 2 | Per-app private repo as today, plus "Share with others": creates and fills the public releases-only repo (README, no code), secrets scan of what goes public | `server/`, `shared/protocol.ts` | Built, proven, in main |
| 3 | Publish a version: GitHub release on the releases repo with the APKs already built and `update.json`; Testing channel as a pre-release; Pull back | `server/`, `shared/protocol.ts` | Built, proven, in main |
| 4 | The updater module in the templates: check, notification, one-tap download, SHA-256 check, PackageInstaller install, honest states | `template/`, `template-kotlin/`, `builder/`, `server/` | Built, proven, in main; not in Expo Exact yet |
| 5 | AnyAppAgent takes over updates of shared apps when it is on the phone, with no double prompts | `app/` | Built and proven ("Stage 5 proof"); following a friend's app from a share link inside AnyAppAgent is not built yet |
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
- The repo name pattern stays strict: `server/src/github.ts` only ever creates, changes the
  visibility of, or writes to repos named `anyapp-<slug>-releases`, and the server never deletes a
  repo.

### As built (stage 2)

- `POST /api/apps/:id/share {"shared": true|false}` (admin token or a paired phone) -> the `App`,
  with `sharing` (`releasesRepoUrl`, `installUrl`, `feedUrl`, `since`) and `signing`.
- Order on the first share: secrets scan of the README text (refused with 400 before any GitHub
  call), the `gh` account, the private code repo (made now if GitHub failed when the app was
  created), the key move if the app still uses the shared key (then a plain build, no agent turn,
  so the owner's phone gets the build with the app's own key), the public releases repo, then its
  `README.md` and `icon.png` through the contents API. GitHub errors come back as 502 with one
  plain line.
- The README holds only the app's name, its icon and the install steps (`server/src/sharing.ts`
  `releasesReadme`); stage 3 rewrites it with the latest version.
- Off: the releases repo becomes private (`gh repo edit --visibility private`); the links are kept,
  so turning it on again makes the same repo public and touches nothing else.
- The secrets scanner (`server/src/secrets.ts`) knows Anthropic, OpenRouter, OpenAI, GitHub, AWS,
  Google, Slack and Stripe keys and private key blocks, and reports kind and place, never the key.
  Stage 3 also runs it over everything inside an APK and the release notes before upload.
- Publishing (stage 3) will refuse an APK whose signer is not the app's current key (a build made
  before the key move), and build again instead.

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
- Testing channel: one GitHub pre-release with the fixed tag `testing`, whose files are replaced
  at each Testing publish, so its feed never moves:
  `https://github.com/<owner>/anyapp-<slug>-releases/releases/download/testing/update-testing.json`.
  The updater reads it (as well as the stable feed, taking the higher build) only when the person
  switched the app to Testing. `releases/latest` never returns a pre-release.
- APK addresses are relative to the feed: an updater replaces `update.json` in the feed address
  with the APK's `name`, so a stable feed points at the latest release's files and the Testing feed
  at the `testing` release's.
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

### As built (stage 3)

- `POST /api/apps/:id/publish {notes?, channel?}` publishes the newest build (no rebuild). Version
  names count stable releases: `1.0`, `1.1`, ...; Testing: `1.<n>-test.<build>`. Stable tags are
  `v<version>-b<build>`. Default notes: the summaries of the builds since the last stable version
  (the "Build N: ..." commit subjects).
- Refused with 409: not shared, no finished build, the build already published, an older build
  than the latest stable one, or a build signed by a key the app no longer uses (a build made
  before its key moved, or before builds recorded their signer): that one is built again by
  itself. Refused with 400 before any upload: anything that looks like a secret inside the APK
  (every code, script, config and resource file is read, `server/src/apk-scan.ts`) or in the notes.
- A stable publish also rewrites the public README with the version.
- `POST /api/apps/:id/pullback {build}`: the version becomes a pre-release titled "(pulled back)",
  the stable version before it becomes the latest again and its `update.json` gets the build in
  `blocked`; without one, the README says no version is published.
- `GET /api/apps/:id/releases`: downloads of the APK files per release (GitHub counts downloads,
  and updates the counts some minutes later).
- GitHub's public download addresses lag behind changes by a few minutes: right after a publish
  `releases/latest` can still point at the version before, and a replaced file (the `update.json`
  of a pull back) can still be served as it was for several minutes. With checks at most every 6
  hours that only delays an update; the API (`gh release download`) shows the change at once.

### As built (stage 4)

- `com.anyapp.updates` (`AppUpdater`, `UpdateJob`, `UpdateActivity`, `InstallReceiver`), plain
  Android APIs only, the same four files in `template-kotlin/app/src/main/java/com/anyapp/updates/`
  and in the React Native module `template/modules/updates` (an Expo module that starts it and
  gives JavaScript `checkForUpdate`, `openUpdate`, `updatesOn`, `get/setUpdateChannel`).
  `builder/test/updater-copies.test.mjs` keeps the copies byte for byte the same.
- The feed: the companion passes a shared app's `feedUrl` and Testing feed to `buildApk`
  (`updateFeed`, `updateTestingFeed`, only GitHub release addresses of a `.json` file); the
  builder's init script writes them as the string resources `anyapp_update_feed` and
  `anyapp_update_testing_feed` (`buildFeatures.resValues`). `res/raw/anyapp_keep.xml` keeps them
  through R8 resource shrinking, which removed them in the first try. A build of an app that is
  not shared has no feed, and the updater does nothing at all.
- When: on open, at most every 6 hours (the slot is claimed before the check, so two starts check
  once), and a daily JobScheduler job when online (it needs `ACCESS_NETWORK_STATE`, which the first
  try lacked: `SecurityException`). Note: force-stopping an app cancels its jobs until it opens again.
- Before notifying, it asks AnyAppAgent (stage 5); then: compare `build` with `versionCode`, skip a
  `blocked` build, refuse a feed whose `signer` is not this app's key, pick the APK for the phone's
  first ABI, else the full one.
- One notification per build ("<App> <version> is ready", the notes), channel "App updates". A tap
  opens the update box, which starts at once: the first time, Android's "Install unknown apps"
  page for this app (once per app), then the download with MB progress, then size and SHA-256
  (one retry), then the file's package, build number and signing key against the installed copy,
  then a PackageInstaller session. Android shows its own "Do you want to update this app?" for a
  copy that came from a browser (the app is not its installer of record).
- Plain words for every state; a download from another key or of another app offers Close, not
  Try again.
- Expo Exact apps do not have the updater yet (their native module support was not looked at);
  they still get updates on the owner's phone through AnyAppAgent.

### As built (stage 5)

- `app/modules/anyapp-native`: an exported `UpdatesProvider` (authority `<AnyAppAgent's package>.updates`)
  and an exported `UpdatesHostService` with the action `com.anyappagent.action.UPDATES`, which only
  lets apps find AnyAppAgent (Android 11+ package visibility: the templates query that action).
- An app asks `content://<host>.updates/handles/<its package>`; the answer is 1 when AnyAppAgent
  installed it (it is the installer of record: the owner's phone, where every build comes from the
  PC) or the package is in AnyAppAgent's "followed" list (`setFollowedApps`, for a later "Add a
  shared app"). The provider answers only the app that asks about itself (the caller's package
  must be the package asked about), so no app learns anything about another.
- Because hosts are found by the action, a copy of AnyAppAgent under another package (as in the
  proof) works the same.
- AI proxy (`AiTrust`): an app whose signing history (Android's key rotation record) holds a
  trusted certificate is trusted too, so a moved app keeps AI after its own updater installed the
  rotated build.
- Not built: "Add a shared app" in AnyAppAgent for a friend who has AnyAppAgent (it would add the
  package to the followed list and watch its feed). Without it, a friend's AnyAppAgent does not
  handle the friend's copy, and the app's own updater does the work, as in stage 4.

## Stage 5 proof

2026-11-11, `emulator-5560`. My own copy of the phone app (`com.anyappagent.dist`, built from this
branch with `app.json` changed only for that build) paired with my test companion on port 8797
(same-network code). "Dist Friend Test" build 5 was on the phone from the stage 4 proof, installed
from the public link (no installer of record).

| Step | Result |
| ---- | ------ |
| After pairing | AnyAppAgent offered build 6 by itself; Android asked once ("Do you want to update this app?", AnyAppAgent did not install the copy there); after it `installerPackageName=com.anyappagent.dist` |
| The provider asked by the shell for that app | `handles=0` (only the app itself gets an answer) |
| The app's own daily check | `check: AnyAppAgent handles this app's updates`; no notification |
| Build 7 on the PC, also published to GitHub as 1.4 | AnyAppAgent installed it by itself (no prompt now that it is the installer) with its own notification "Getting Dist Friend Test onto your phone"; `versionCode=7` |
| The app's own check after that | Still "AnyAppAgent handles this app's updates", 0 notifications from the app: one update, one notification, through AnyAppAgent |

## Stage 4 proof

2026-11-11, `emulator-5560` (Android 15) as the friend's phone, the companion setup of stage 2,
a new Kotlin app "Dist Friend Test" (`com.anyapp.disttestfriend`, own key, a launch counter) made
from the updated template and shared: repos `anyapp-disttest-friend` (private) and
`anyapp-disttest-friend-releases` (public).

| Step | Result |
| ---- | ------ |
| Publish 1.0; on the "friend's phone" download `disttest-friend.apk` from the public install link and install it (no installer of record, as from a browser) | Installed, `launches=1` |
| First try of the daily job | Not scheduled: `SecurityException: ACCESS_NETWORK_STATE required` (fixed, then 1.2 published and installed from the link the same way) |
| Publish 1.3 (build 5); the app's daily job (`cmd jobscheduler run -f`) | `check: build 5 (1.3) is available`; one notification "Dist Friend Test 1.3 is ready" with the notes (`C:\aa\t\shots\friend-1-notification.png`) |
| Tap | Android's "Install unknown apps" page for the app (first time only); allowed, back |
| The update box | Downloaded, checked, handed to Android: "Do you want to update this app?"; Update |
| After | `versionCode=5`, `launches=6` (data kept), the notification gone |
| A release whose `update.json` has a wrong SHA-256 | "The download was damaged twice, so it was not installed. Try again later."; still build 5 |
| A release whose APK is signed with another key (its SHA-256 honest) | "This update can't replace your copy (it is signed differently). Ask whoever shared the app for a new link."; still build 5 (`C:\aa\t\shots\tamper-B.png`) |
| React Native: a new app from the updated template, built with a feed | The module compiles; the APK has the feed string, the activity, job and receiver; on the emulator `daily check scheduled: true`, `check: up to date` (the feed belongs to another package, so nothing is offered) |

The two tampered releases (`tampered-sha-test`, `tampered-key-test`) are left on the test releases
repo as pre-releases titled "Tampered test ... (not a real version)".

## Stage 3 proof

2026-11-11, the same companion setup as stage 2, on `anyapp-disttest-share-releases`.

| Step | Result |
| ---- | ------ |
| Publish build 2 (made before builds recorded their signer) | 409 "This version was made before the app got its own key. It is being built again...", and build 3 built by itself |
| Publish build 3 | Release `v1.0-b3` "Dist Share Test 1.0", Latest, files `disttest-share.apk` and `update.json` |
| `releases/latest/download/update.json`, anonymous | 302, 302, 200, no `X-RateLimit` headers (not the API); build 3, the APK's size and sha256, the signer |
| The README link `.../latest/download/disttest-share.apk` | 200, 941,605 bytes, sha256 equal to `update.json` |
| A fake GitHub token in the app's code, shrunk away by R8 (only `ghp_` left) | Published (`v1.1-b4`): nothing secret was in the APK |
| The whole token used by the code, build 5 | 400 "Not published: found what looks like a secret (GitHub token in classes.dex)"; no release made |
| Testing publish of build 6 | Pre-release `testing` "1.2-test.6 (testing)"; `update-testing.json` build 6; the stable feed still build 4 |
| Stable publish of build 6, then Pull back | `v1.2-b6` became Latest, then a pre-release "(pulled back)"; `releases/latest` points at `v1.1-b4` again, whose `update.json` lists `blocked: [6]` (through the API at once, the public address some minutes later) |
| Every APK of the user's own apps in `C:\aa\apps` (read only) | No secret found (after narrowing the OpenAI pattern, which first matched words such as `sk-removeDuplicates` in a bundle) |

Tests: `server` 66 (8 new in `test/publish.test.ts`: the zip reader and scanner, the stable and
Testing releases and their `update.json`, every refusal, the stale signer, pull back) and `tsc` pass.

## Stage 2 proof

2026-11-11, my own companion (port 8797, state `C:\aa\t\dist-state2`, key folder
`C:\aa\t\dist-home`, helpers off so a build never starts an agent), the `gh` account signed in on
this PC, a throwaway Kotlin app "Dist Share Test" (`com.anyapp.disttestshare`, its key folder
removed so it looks like an app made before per-app keys) and a second record whose name holds a
fake Anthropic key. Repos created: `anyapp-disttest-share` (private) and
`anyapp-disttest-share-releases` (public). Nothing else was created or changed on GitHub.

| Step | Result |
| ---- | ------ |
| Build 1 | Shared key, as every app made before per-app keys |
| Share | `signing: moved`, private code repo made and pushed, releases repo public, build 2 started by itself |
| The code repo | `PRIVATE`, all the app's files; an anonymous request gets 404 |
| The releases repo | `PUBLIC`, only `README.md` and `icon.png`; the README has the name, icon and install link |
| Build 2 | Signed with the app's own key (moved); on the emulator it installed over build 1 with past signatures = shared, own |
| Share the app whose name holds an API key | 400 "Not shared: found what looks like a secret (Anthropic API key in README.md)...", and no `anyapp-disttest-leak*` repo exists |
| Share off | Releases repo `PRIVATE`, anonymous 404 |
| Share on again | Same repo `PUBLIC` again, same `since`, README not rewritten (still 2 commits) |

Tests: `server` 58 (7 new in `test/sharing.test.ts`: call order, no key move for an own-key app,
reuse of a private releases repo, refusal before any GitHub call, GitHub errors as one plain 502
line, unshare, the scanner) and `tsc` pass.

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
