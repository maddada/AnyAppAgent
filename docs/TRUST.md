# Trust: never lose your apps, the usage meter, keep my apps healthy

The user picked three cards on `C:\aa\ideas\ideas.html` (2026-11-11): "Never lose your apps" (Q43),
"Usage meter" (Q45) and "Keep my apps healthy" (Q47). This file is what was built, what was chosen
and why, and the proof.

## Never lose your apps

One switch, desktop Settings, "Never lose your apps": **Back up my apps**. Turning it on asks for a
password (twice) and a folder. From then on the PC backs up by itself after every new version (two
minutes after the last one, so a run of changes makes one backup) and once a day, and keeps the
last five backups. "Back up now" is there too. "Restore on a new PC" brings everything back.

### What is in a backup

| What | Why |
| ---- | --- |
| Every signing key (the shared key, each app's own key, each lineage) | Without its key no phone takes an app's update again. It is the one loss nothing can undo. Taken from the builder's own key export (`builder/lib/keybackup.mjs` `exportKeyEntries`, the same entries the Settings "Signing keys" backup encrypts), not a second copy of that logic. |
| Each app's code with every version (`git bundle --all`) | The app can be built again, and its history is there. |
| Each app's chat and to-do list | So its chat on the new PC shows what was asked and done. |
| Each app's record (name, package, last version number, usage) | So the next build's version is higher than the phone's copy and installs over it. |

Not in it: APK files (the new PC builds each app once after a restore) and Claude's own session
files (the app's agent starts a new session, with the app's `overview.md` and memory file from the
code).

### Where it goes, and why a folder

A folder the person picks: a OneDrive (or Google Drive, Dropbox) folder, or a USB drive.

- It works for everyone, with or without GitHub, and a synced folder already leaves the PC by
  itself, which is the point of a backup.
- The keys never go to GitHub, not even encrypted: a repo can be made public by a later click
  ("Make code public" in `docs/DISTRIBUTION.md`), and a key file in a repo's history stays there.
- The private GitHub repos stay what they were: a second copy of each app's code, pushed after every
  build when GitHub is on. Settings says how many apps also have their code there.

### Encryption (the PC backs up without knowing the password)

- Turning it on makes a **recovery key pair** (X25519). The private half is encrypted with the
  password (scrypt N=2^16, r=8, p=1, then AES-256-GCM, the same as the key backup) and saved as
  `<folder>\AnyAppAgent backup\recovery.json`. The PC keeps only the public half
  (`<state>\backup.json`). The password is never stored or logged; it goes from the desktop to the
  companion on `127.0.0.1` only.
- Each backup file (`backup-<time>.anyappbackup`): a fresh X25519 key, ECDH with the recovery public
  key, HKDF-SHA256 to an AES-256-GCM key. The header (format, date, the fresh public key, the iv)
  is the GCM additional data, so a changed byte anywhere is refused. Nothing about the apps is in
  the clear: no names, no counts.
- So a lost USB stick or a leaked cloud folder opens with nothing but the password, and the PC can
  write backups it cannot read itself.
- Turning it on again on a folder that already holds a backup needs that backup's password (its
  recovery key is kept). After a restore, backups carry on into the same folder with the same
  password.

### Restore on a new PC (or a fresh state folder)

Desktop Settings, "Restore on a new PC": the password, then the folder. The companion:

1. Opens the recovery key with the password ("Wrong password, or the backup was changed." otherwise)
   and the newest backup in the folder.
2. Adds every signing key this PC lacks (`importKeyEntries`): a key it already has with the same
   certificate is skipped, a different one is kept and reported, never overwritten.
3. Brings back every app it does not have: `git clone` of the bundle into the apps folder (its
   GitHub repo stays its remote), its chat and to-dos, its record without an APK.
4. Builds each restored app once (a plain build, no agent turn). The build has the next version
   number and the app's own key, so the phone updates the app in place and keeps its data.

### Each app's data on the phone

Where Android allows it: AnyAppAgent cannot read another app's private data, and Android's own
`adb backup` is gone. What carries an app's data to a new phone today is Android's backup to the
person's Google account and the device-to-device transfer, which every generated app allows (Expo
and the Kotlin template both leave `allowBackup` on). An in-app export of an app's data to the PC
backup (the card's "exported by the template's storage on request") is not built: it needs the
templates, which another thread is changing now. It is the next step.

## Usage meter

Honest numbers only, from what Claude Code reports through ACP:

- **Each turn's tokens**: the `usage` of every `session/prompt` result (`claude-agent-acp` fills
  input, output, cache write and cache read tokens for that turn). The main chat's turns, every
  helper's turns, build fix turns and the reports' turns all count.
- **Per change**: each message from the person shows "Used 52k tokens" under it, growing while the
  work for it runs (its main-chat turn, the helpers that turn started, their fixes and reports).
- **Per app**: this month and in total, and how many changes (`App.usage`).
- **The plan**: only what Claude reported (`usage_update` `_meta["_claude/rateLimit"]`, Claude
  Code's own rate limit event): which limit (5-hour, weekly, ...), its status, the percentage only
  when Claude sent one, and when it resets. A limit that has reset is dropped. Without a report the
  meter says so: "Claude has not shared your plan's limits yet, so this shows what your apps used,
  not a percentage of your plan."
- **Tokens shown** are new work: input, output and cache writes. Cache reads (Claude reading the
  chat again on every step, at a fraction of the cost) are kept apart and named in the details, so
  a small change does not look like a million tokens.
- **Heads-up before a big job**: a new app, "Update it", or a message over 400 characters or with
  words like "redesign", "rewrite", "from scratch", "every screen". It says why, what this app's
  changes used on average so far, and the plan's state if Claude reported one; "Send anyway" or
  "Not now". A used-up limit warns before any message. The phone and the PC show the same card
  (`shared/chat/trust.ts`).
- **Where**: under each message in the chat (phone and PC), desktop Settings "Claude plan use"
  (the plan lines with a bar when a percentage is known, this month, each app with a bar against the
  biggest app, never against the plan), phone Settings "Your Claude plan and backup".

## Keep my apps healthy

- **Behind** means one of these, read from the app's files (`server/src/health.ts`):
  - React Native: an older Expo SDK than `template/package.json`, or one of the template's built-in
    parts the app must keep as they are (`modules/updates`, `modules/feedback`, `modules/ai`)
    missing or different (line endings and build output ignored).
  - Kotlin: a lower `targetSdk` (or `compileSdk`) than `template-kotlin`.
  - Expo Exact (alpha): not checked.
- **The yellow sign**: a mustard badge with "!" on the app's icon (phone home grid, PC app list,
  with "Needs an update" under the PC row). The colour is new in the Workbench theme:
  `attention` / `onAttention` / `attentionText` in `shared/theme/tokens.ts`.
- **Update it**: the app's sheet on the phone and the top of its chat on the PC say what is behind
  and offer "Update it". After the heads-up it sends the app's agent one message (as the person's
  own, so it shows in the chat) that names what is behind, where the newest template is (read
  only) and what to keep (everything the app does, its look and its data). The agent hands it to a
  helper as usual, and the PC builds it: the fast lane (`docs/FAST-LANE.md`) makes it a quick
  update or a full build by itself (a module or SDK change is a full build).
- **Monthly reminder**: while any app is behind, a card on the phone's home and at the top of the
  PC's app list ("Your monthly app check: 2 apps are behind ..."). "Got it" puts it away for 30
  days. The apps are checked at start, after every build and every 6 hours.
- **Later (the card's batch flow)**: updating every app in one go, each on a branch that merges only
  when its build passes. Not built.

## Protocol additions (all additive)

`App.usage`, `App.health`, `ChatItem.usage`, `AdminState.backup`, the `care.updated` event, the
types `TokenUsage`, `AppUsage`, `PlanLimit`, `UsageState`, `AppHealth`, `HealthReminder`,
`BackupSummary`, `BackupState`, `CareState`, `BackupSetupRequest`, `BackupRestoreRequest`,
`BackupRestoreResult`, and the routes `GET /api/care`, `POST /api/care/reminder`,
`POST /api/apps/:id/keep-healthy`, `POST /api/admin/backup`, `POST /api/admin/backup/run`,
`POST /api/admin/backup/restore`.

## Proof (2026-11-11 and 12)

My own dev desktop app and companion on port 8795, `ANYAPP_GITHUB=off`, state folders
`C:\aa\t\trust\A-state` and `B-state` (each also its `ANYAPP_HOME`, so its own keystore), my own
phone app copy `com.anyappagent.trust` on `emulator-5560`. Screenshots: `C:\aa\e2e\trust\`.

| Step | Result |
| ---- | ------ |
| PC A: New app "Trust Tally" (Kotlin), plan, "Yes, build it", then "Show the word Today ..." | Real Claude turns with helpers; builds 1 and 2; the phone installed both (v2 over v1); count tapped to 3 |
| Usage under each message | 33k, 46k, 27k tokens (later 49k for the update); Settings: November 106k, Trust Tally 3 changes, about 35k each |
| The plan | Claude reported a weekly limit with no percentage: shown as "Weekly limit: Claude says there is room, resets at Sun 14:00", no made-up percentage. On the fresh PC B nothing was reported yet: "Claude has not shared ..." |
| Heads-up | "Redesign every screen ..." on the phone shows "A big job" with this app's average; not sent |
| Back up my apps (Settings: password twice, folder) | `recovery.json` + one `.anyappbackup` (1 MB: 1 app, 2 keys). The password, the app key's store password and the app's name are in no file and no log |
| Stop A; start PC B on an empty state folder; Restore with a wrong password | "Wrong password, or the backup was changed." |
| Restore with the right password | "Brought back 1 app: Trust Tally"; the app's Git history (10 commits) in `B-apps\trusttally`; its key in B's keystore with the same certificate; build 3 made by itself |
| Phone, paired with B | Trust Tally updated to version 3 by itself: `firstInstallTime` still 23:52:44 (v1 from PC A), same signature, count still 3, "Today" shown |
| App made behind (its `targetSdk` lowered to 34, as an app from an older template) | Yellow sign on the PC row and the phone tile, "Needs an update", the monthly reminder on both, the notice above its chat |
| "Update it" on the phone (heads-up, then Update it) | The update message in the chat as the person's own; a helper moved it to API 36; full build 4 installed in place (`targetSdk=36`, count kept); the sign and the reminder went away by themselves |
| "Got it" on the reminder (PC) | Put away until 2026-12-11 |
| The health check on the PC's real apps in `C:\aa\apps`, read only | All five are behind: made before the template's updates, feedback and AI parts (`health-check-real-apps.txt`); a fresh template copy is not |

Not proven on the device: tapping the yellow sign itself (it now opens the app's sheet, built after
the run above); the emulator kept showing "Android System isn't responding" at that point. The
dark phone sheet shot is missing for the same reason.

Tests: `server` 105 (11 new in `test/trust.test.ts`: usage parsing, plan limits, month rollover,
behind reasons, the reminder, the encryption, backup and restore through Git bundles, a missing
folder), `shared/chat` 58 (5 new), `builder/test/keys.test.mjs` 3 (real keytool, after the
export/import split), `shared/theme` 8 (new contrast pairs), `desktop` 58 and typecheck, `app`
typecheck and lint.
