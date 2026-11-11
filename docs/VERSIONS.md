# Versions and undo, What changed, Crash catcher, the app's diary

The user picked four ideas from `C:\aa\ideas\ideas.html` (2026-11-11): "Versions and undo" (Q21),
"What changed card" (Q24), "Crash catcher" (Q25) and "A diary the agent can read" (Q26). They fit
together around an app's history and health. This file is what was decided and built.

## Versions and undo

- **A version is a build that succeeded.** The PC records each one when it is built
  (`<state>/versions/<appId>.json`: number, commit, what changed, when). Builds made before this
  feature are read from the app's Git history (commits `Build N: ...`).
- **Go back** (phone: Versions in the chat's menu; PC: the History button in the chat header) to
  any earlier version: the PC puts that version's files back with one new commit
  (`Back to version 2`), never rewriting history, and builds it as a **new version with a higher
  number**, so it installs over the current app and the app's data stays (Android refuses an older
  version code). An old APK is never reinstalled: the PC keeps only the last three, and their
  version code is lower.
- **Undo** goes back to the version before the newest one. After a go-back, Undo brings back what
  was there before it. Nothing is ever lost: every version stays in the list.
- Only while the app is not busy (no reply, no helper, no build): the PC answers 409 with a plain
  sentence otherwise, and the buttons say why.
- **The agent is told** on its next message, in a note the person does not see: which version the
  app went back to, and that the newer code is still in Git history (`git show <commit>:<file>`),
  so "keep this, but bring back the old colours" works. The playbooks say how versions map to
  commits.
- A go-back that does not build (rare: it built before) is not sent to the agent to fix; the
  app's files are put back as they were and the card says so.

Protocol (additive): `AppVersion`, `GET /api/apps/:id/versions`,
`POST /api/apps/:id/versions/:build/restore`, `POST /api/apps/:id/undo`, `BuildInfo.restoredFrom`.

## What changed

- Each new version comes with up to three short plain lines: **Changed**, **Try it**,
  **Good to know** (`ChangeNotes`, on `BuildInfo.changes`). The build card shows them under
  "Your app is ready", in the chat on the phone and on the PC; the install notification on the
  phone uses the Changed line; the Versions list shows the Changed line of every version.
- The agent writes them: the agent that changed the app (a helper, or the main chat without
  helpers) calls the `describe_change` tool (MCP server `app`) before it ends its turn, in the
  person's words, never code words. Without it, the PC uses the helper's task title, or the
  first sentence of the agent's last message.
- A go-back writes its own: "Back to version 2, as it was on 3 Nov 18:00."

## Crash catcher

What the person sees: a notification and a card in the app's chat, phone and PC:
**"Tea Timer crashed. Fix it?"** with the error's one line, the version and when. One tap on
**Fix it** sends "Fix the crash" to the app's chat as the person's message; the agent gets the
whole report (message, stack, screen, version, the app's latest diary notes). The same crash again
within a day counts up on the same card instead of adding cards.

How it gets there:

1. **In the app** (React Native template, `modules/diary`; Kotlin template, `diary/`): a handler
   for uncaught exceptions on every thread (Java, and fatal JavaScript errors, which reach it as
   `JavascriptException`), installed when the app process starts; in React Native also a global
   JavaScript handler (better stack, the screen name) and an error boundary around the app that
   shows a calm "Something went wrong" screen with Try again instead of a white screen (kind
   `error`). The crash is also written to the diary.
2. **To AnyAppAgent on the phone**: an explicit broadcast to **the app that installed it**
   (Android's install source record: AnyAppAgent, whatever its package name), never to anyone else:

   | | |
   | --- | --- |
   | Action | `com.anyappagent.action.CRASH` |
   | Package | the installer (`getInstallSourceInfo(own).installingPackageName`, API 30+; `getInstallerPackageName` before) |
   | Extra `report` | JSON `CrashReport` (shared/protocol.ts), stack at most 16 KB, diary at most 50 notes |
   | Extra `sender` | a `PendingIntent` the app made (`getBroadcast`, `FLAG_IMMUTABLE`): Android stamps its creator, so it proves which app sent the broadcast |

   An app installed by something else (adb, a file manager) sends nothing.
3. **AnyAppAgent** (`app/modules/anyapp-native`, `CrashReceiver`) accepts a report only when the
   `sender`'s creator package is an app AnyAppAgent installed itself (install source), keeps at
   most 20 waiting reports, posts the notification, and the JavaScript side sends them to the PC
   (`POST /api/apps/:id/crashes`) as soon as it is connected. The notification opens the app's
   chat.

## The app's diary

The card: "Apps keep a small private log of what they did ("Asr alarm set for 15:42", "rang at
15:42"), so "why didn't it ring?" gets a real answer."

- **In the app**: `diary("Asr alarm set for 15:42")` (`src/lib/diary.ts`; Kotlin `Diary.note`)
  appends one line to `files/anyapp-diary.jsonl` in the app's private storage, newest 300 kept.
  The template's alarms write their own notes (set, rang, missed because of a permission), and so
  do crashes. Lines are at most 200 characters.
- **What goes in** (template AGENTS.md, "The diary"): what the app did and why, never what the
  person wrote or who they are: no names, messages, places, health data, or anything typed.
- **Privacy**: the diary never leaves the phone except to the person's own PC, and only when the
  app's agent asks for it. It is not kept by the PC (the agent's own session on the PC has what it
  read). The chat shows a quiet line each time it is read, with "The diary stays on your phone and
  this PC."
- **How the agent reads it**: the `read_diary` tool (MCP server `app`). The PC sends
  `diary.request` to the connected phones; AnyAppAgent asks the app with an explicit broadcast
  (action `com.anyapp.action.DIARY_REQUEST`, package = the app, extra `requestId`); the app's
  receiver answers only to its installer (action `com.anyappagent.action.DIARY`, extras
  `requestId`, `diary` = JSON array of `{at, text}`, `sender` as above); AnyAppAgent posts it to
  the PC (`POST /api/apps/:id/diary`). While that app is being installed, the phone first waits
  for the install (up to 42 s; still installing then: the tool says so and the agent tries again).
  No phone connected, or no answer within 56 s (the agent's tool call
  gives up at about 60 s): the tool says so in
  a sentence, and the chat line says so too.

Protocol (additive): `ChatItemKind` `crash` and `diary`, `ChatItem.crash`, `ChatItem.diary`,
`CrashReport`, `CrashInfo`, `DiaryEntry`, `DiaryReadInfo`, `DiaryAnswer`,
`POST /api/apps/:id/crashes`, `POST /api/apps/:id/crashes/:crashId/fix`, `POST /api/apps/:id/diary`,
ServerEvent `diary.request`.

## Presets

- React Native: everything above.
- Kotlin: crash catcher and diary in Kotlin (`app/src/main/java/com/anyapp/app/diary/`).
- Expo Exact (alpha): versions, undo and What changed work (they are on the PC); the crash
  catcher and the diary are not in it yet.
