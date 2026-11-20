# Kiwimake: what we are building

Kiwimake is an Android app, side-loaded only (never published to a store), for making other
Android apps from the phone. The user has app ideas but does not want to sit at the PC: they type a
prompt on the phone, an agent on their PC builds the app, and the finished APK arrives on the phone
and installs over the previous version. It must be dead simple for a regular, non-technical user.

## The user's flow

1. **Connect your PC** (first run). The PC runs the companion; the phone connects to it with an
   address and a short pairing code. Nothing else to set up: the companion does Git and GitHub.
2. **Home**: a two-column grid of the user's apps, each with its icon and name, plus a "new app"
   tile. A new app asks only for a name and what it should do.
3. **Tap an app**: either **Open** it (launch it on the phone) or **Change it** (a chat with that
   app's agent).
4. **Prompt, wait, install**: when the agent finishes a turn, the PC builds the APK by itself and
   the phone downloads it and starts the install, replacing the app already there.

## The parts and who owns which folder

| Folder      | What                                                                            |
| ----------- | ------------------------------------------------------------------------------- |
| `shared/`   | `protocol.ts`: the wire contract between phone and PC. Types only.               |
| `shared/chat/` | The chat core both apps use: rows, tool titles, markdown blocks, build card, state line, composer, pictures. Plain TypeScript, tested with `node --test`. |
| `server/`   | The PC companion: pairing, one Claude Code session per app, Git/GitHub, builds.  |
| `template/` | The React Native (Expo) starter every new app is copied from.                    |
| `template-kotlin/` | The native Android starter (Kotlin, Compose) for the "Kotlin" preset.     |
| `template-exact/` | Kiwimake's files for the "Expo Exact" preset (alpha; apps come from `exact new`). |
| `template-web/` | The web app starter (Vite, React, TypeScript) for web apps and the web half of "Both" (docs/WEB-APPS.md). |
| `template-game/` | The game starter, laid over `template-kotlin/` for the "Game" preset: `game/` (Kotlin and Compose Multiplatform) and the Android `app/`. |
| `builder/`  | Creates an app from the template and builds its signed APK.                      |
| `app/`      | The Kiwimake Android app itself (React Native, Expo).                         |
| `docs/`     | This file and `ENVIRONMENT.md` (Android toolchain and emulator on this PC).       |
| `.reference/` | Reference checkouts (bb). Read only, git-ignored, never imported from.         |

Each folder has its own `package.json`; there is no root workspace. A thread edits only its own
folder(s).

## Decisions already made

- **Agent**: Claude Code over ACP (Agent Client Protocol), and nothing else. Do it the way bb does:
  `.reference/bb` is a checkout of https://github.com/get-bb/bb (MIT). Mirror how bb launches the
  Claude Code ACP agent, initializes, creates and resumes sessions, sets the permission mode,
  translates session updates, and answers permission requests. Do not invent another way. Start in
  `plugins/provider-acp`, `packages/provider-bridge-acp` (`client/`, `bridge/agent-connection.ts`,
  `session/`, `session-params.ts`, `delta-translation.ts`) and `packages/agent-runtime`. Copying bb
  code is fine; keep its MIT notice in `THIRD_PARTY_NOTICES.md`.
- **One session per app**: each app has exactly one long-lived Claude Code session on the PC,
  working in that app's project folder. It is the only thing the user talks to for that app. Model
  it on the Ghostex coordinator idea (`%USERPROFILE%\.claude\skills\ghostex-orchestrator\SKILL.md`,
  project at `C:\dev\Ghostex`): the session gets a short playbook that says it owns this one app
  for a non-technical user on a phone, answers in short plain language, never asks the user to run
  commands or open files, may hand large work to its own subagents, keeps the app building, and
  keeps a small goal-and-memory file for the app.
- **Unattended**: the user is on a phone, so sessions run without permission prompts wherever bb's
  "full access" mode allows it. A permission request that still arrives is shown in the chat.
- **Chat look**: copy bb's thread view (message layout, tool-call rows, composer, spacing, colours,
  typography). bb's own mobile app is a WebView around its web app, so the look to copy lives in
  `.reference/bb/packages/thread-view`, `packages/core-ui`, `packages/shared-ui` and `apps/app`.
- **Generated apps**: React Native with Expo, so over-the-air updates can be added later. Package
  ids are `com.anyapp.<slug>`. Every build of an app is signed with the same key and has a higher
  `versionCode` than the last, so it installs over the one on the phone.
- **Build after every turn**: when the agent's turn ends, the server builds the APK. If the build
  fails, the server sends the error back to the agent as a new prompt (at most 3 times), then shows
  the failure in the chat. After a successful build it commits and pushes, then announces the APK.
- **Git and GitHub**: each app is its own Git repository, with a private GitHub repository named
  `anyapp-<slug>` created through the `gh` CLI (already signed in on this PC). If GitHub fails, the
  app still works locally and the chat says so in one line.
- **Permissions**: Kiwimake may ask for any Android permission that makes the flow smoother
  (installing packages, querying and launching packages, notifications, foreground service,
  cleartext HTTP to the PC). It is never going to a store.
- **Where apps live on the PC**: `C:\aa\apps\<slug>` by default (short on purpose: React Native
  builds on Windows break on long paths). Server state lives in `%USERPROFILE%\.anyappagent`
  (config, tokens, the signing keystore, chat history). Neither is inside this repository.
- **Ports**: the companion listens on `0.0.0.0:8787` (HTTP and WebSocket). The emulator reaches the
  PC at `10.0.2.2:8787`.

## Added by the user later (same night)

- **The desktop part is an Electron + TypeScript app** (`desktop/`). There is no terminal anywhere
  in the product: the user installs and opens one desktop app, and it runs the companion
  (`server/`) for them as a child process. `server/` stays a headless program that can also be
  started by hand for tests. The desktop app talks to it over `http://127.0.0.1:8787` with an
  admin token (see "Desktop app to companion" in `shared/protocol.ts`).
- **A very nice onboarding for people who are not technical**: imagine someone who does not know
  what GitHub is. The desktop app walks them through everything in plain words, checks each thing
  by itself, fixes what it can with one click, and lets them skip what is optional.
- **Easy Connect, copied from Ghostex** (`C:\dev\Ghostex`, the user's own project; read only):
  the phone pairs with the desktop by scanning one QR code and then reaches it from anywhere, not
  only on the same Wi-Fi, with nothing else to install. In Kiwimake it carries only the
  companion's HTTP and WebSocket port (no SSH, no terminal): chat, app list, and the APKs going
  back to the phone. The design, and the contract between the desktop side and the phone side,
  live in `docs/EASY-CONNECT.md`. The same-network path (address plus 6-digit code) stays as the
  fallback and is what the emulator uses at `10.0.2.2:8787`.
- **Toolchain for the builder**: the builder reads `JAVA_HOME` and `ANDROID_HOME` from its process
  environment. The desktop app sets them for the companion from its own tools folder, or from the
  paths the user's PC already has.

| Folder     | What                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| `desktop/` | The Electron desktop app: onboarding, runs the companion, connect a phone. |

## The contract between `builder/` and `server/`

`builder/index.mjs` (plain ESM, no build step) exports:

```
createApp({ dir, name, slug, packageName, preset?, onLog? }) -> Promise<void>
    Copies the template into dir, fills in name and package id, and leaves it ready to build.
    preset: "react-native" (default, template/), "kotlin" (template-kotlin/) or "expo-exact"
    (alpha: `exact new` from a pinned, patched Expo Exact checkout, builder/exact/). buildApk and
    getIconPath tell them apart by the folder (anyapp.json's preset, else app.json).
buildApk({ dir, buildNumber, onLog? }) -> Promise<{ apkPath, sizeBytes, sha256, variants? }>
    Builds a signed, installable APK with versionCode = buildNumber. Rejects with an Error whose
    message is the useful part of the build output (the part an agent needs to fix it).
    variants (React Native apps): [{ abi, apkPath, sizeBytes, sha256 }], one smaller APK per ABI
    (arm64-v8a for phones, x86_64 for the emulator) next to the full one; the phone downloads
    its own with GET /api/apps/:id/apk?abi=<abi> (shared/protocol.ts BuildInfo.variants).
getIconPath({ dir }) -> string | null
    Absolute path of the app's launcher icon PNG, or null.
adoptApp({ src, dir, name, slug, packageName, onLog? }) -> Promise<{ preset }>
    "Make my own version" (docs/CHANGE-THIS-APP.md): a separate app from another app's code, with
    its own name, package id and signing key. React Native and Kotlin. Duplicate uses it too.
renameApp({ dir, name, slug, packageName, onLog? }) -> Promise<{ preset, packageChanged }>
    Rename, in place: the new name and slug in app.json / anyapp.json and strings.xml; a new
    package id gets its own new key (and a React Native app's android/ is made again). The caller
    moves the folder. React Native, Kotlin and web.
addWebVersion({ dir, name, slug, onLog? }) -> Promise<{ webDir }>
    "Both" (docs/WEB-APPS.md): template-web into <dir>/web (refuses when it exists); the Android
    project's tsconfig.json and eslint.config.js are told to leave web/ alone.
buildWeb({ dir, buildNumber, onLog? }) -> Promise<{ distDir, files: [{ path, size, sha256 }], sizeBytes, build, slug, durationMs, timings, logPath }>
    A web app (preset "web", or the web/ of a "Both" app) into <dir>/dist: the TypeScript check and
    vite build, then no source maps, icon-192/512.png, manifest.webmanifest, version.json
    {"build": N} and sw.js (cache kiwi-<slug>-<N>). Paths in `files` use "/". Rejects like
    buildApk, with the useful part of the output.
```

createApp also takes preset "game" (template-kotlin/ with template-game/ on top; anyapp.json
`{ preset: "game", slug, package }`): buildApk, getIconPath, renameApp and adoptApp treat it as a
Kotlin app (builder/README.md, "The game preset").

createApp also takes preset "web" (template-web/: Vite, React, TypeScript; no signing key; anyapp.json
`{ preset: "web", slug, package, name }`); presetOf(dir) says "web", getIconPath returns its
assets/icon.png, buildApk refuses it.

buildApk also takes `changeOwner` and `changeOthers` (the "Change this app" values written into
the build).

and a CLI for humans and tests: `node builder/cli.mjs create <dir> --name "<name>"` and
`node builder/cli.mjs build <dir> --build-number <n>` (web: `create ... --preset web`,
`build-web <dir> --build-number <n>`, `add-web <dir> --name "<name>"`).

## The contract between `server/` and `app/`

`shared/protocol.ts`. Both sides implement exactly that. Additive changes only, listed in the
thread's report.

## Proof that it works

The finished system is proven on the Android emulator: Kiwimake is installed there, paired with
the companion on this PC, and used (through its own UI) to create a Muslim prayer alarm app for
Ajman, UAE: correct prayer times, each time adjustable by the user, and two announcements before
each prayer at offsets the user sets. The APK arrives and installs through Kiwimake, and a
second prompt produces an update that installs over it.

## Sharing this PC

Several threads work at once. Edit only your own folder. Use only your own Android package on the
emulator; never wipe the emulator, uninstall another thread's app, or kill the adb server. The
existing AVD named `ghostex` belongs to another project: do not use or change it.

## AI for your apps (added 2026-11-11)

The user: "I wanna add a ai token (Claude or open router) in AnyAppAgent and then all my sub apps
can use it to call ai, because I want my sub apps to support ai agents". And: the key is a
regular field in Kiwimake's Settings, not a separate screen.

- **The key lives only in Kiwimake** (`app/modules/anyapp-ai`): one field in Settings, "AI for
  your apps". Claude (`sk-ant-`) or OpenRouter (`sk-or-`) is detected from the key, or picked.
  Stored encrypted (AES-256-GCM, key in the Android Keystore), never read back into JavaScript
  (Settings shows only the last 4 characters). Default models: `claude-opus-5-5` (Claude),
  `anthropic/claude-opus-5.5` (OpenRouter); changeable. "Save and test" makes one tiny real call.
- **Apps use it through a local proxy, never the key.** Kiwimake exports a bound service
  (`AiProxyService`, action `com.anyappagent.action.AI`, Messenger). An app sends a neutral chat
  request (text, images, tools); Kiwimake adds the key, calls the provider, streams the answer
  back (text pieces, tool calls, done/error) and counts tokens. Wire format:
  `template/modules/ai/README.md`. The app-side API is `template/src/lib/ai.ts` (`chat`, `ask`,
  `runAgent`, `useAiStatus`, `AiSetupNotice`), documented in `template/AGENTS.md`, "AI".
- **Why a proxy and not handing the key over:** the key never leaves one process, so a buggy or
  chatty app cannot leak it (logs, crash reports, a WebView, its own backups), removing the key or
  switching an app off takes effect at once for every app, and usage per app and limits can be
  enforced in one place. Streaming and tool use work through it, so apps can run agent loops.
- **Who may call it: a certificate check, not an Android signature permission.** Kiwimake is
  signed with the React Native debug key (public, the same in every RN project), while generated
  apps are signed with the PC's own key (`builder/lib/keystore.mjs`, `CN=AnyAppAgent`). So a
  `signature` permission would refuse every generated app, and signing Kiwimake with the PC key
  is impossible because each user's PC makes its own key. Instead the service identifies the caller
  by the Binder UID Android attaches to every message and allows only apps whose signing
  certificate equals that of an app Kiwimake installed itself (learned from Android's install
  source record). Any other app, including one with a `com.anyapp.*` name signed with another key,
  is refused (`not_allowed`).
- **Limits and cost:** per app an on/off switch and a usage line (calls, tokens) in the same
  Settings group; per app at most 3 requests at once and 30 a minute; `maxTokens` default 8192,
  capped at 32000; requests up to 12 MB.
- **Testing without a key:** `app/dev/fake-ai-provider.mjs` speaks both provider APIs (SSE, tool
  calls). `adb shell setprop debug.anyapp.ai.url http://10.0.2.2:<port>` points Kiwimake at it;
  only adb can set it, and while it is set the stored key is never sent (a placeholder is).

## Sharing apps and updates (added 2026-11-11)

The user: "i want to make the app have distribution features built in ... you can send updates
through github to people ... integrate each app that i create with github so i can upload it there".
Decided: an updater in every app with Kiwimake handling updates first when it is on the phone,
private repos with a "Share with others" switch that makes a public releases-only repo, and one
signing key per app. The plan, the stages and their proofs: `docs/DISTRIBUTION.md`. Since stage 1,
new apps are signed with their own key (`%USERPROFILE%\.anyappagent\keystore\apps\<package id>`);
apps made before keep the shared key until they are moved by key rotation.

## Apps that know each other (added 2026-11-11)

The user: "We need an AnyAppAgent CLI that we install on the machine ... list all of the apps, and
then, for each app, ... list the specifications of that app ... an MD file in the root of the
directory, not a GitHub README. We call it, for example, overview.md ... It needs to be updated
after each prompt the user gives ... Just giving them access to the code is enough for most cases."

- **`overview.md`** in the root of every app folder: the app's main requirements from the person,
  high level and short. The PC writes a draft from the first message when the app is made (its
  first line marks it as a draft); the app's main chat replaces it on its first turn and updates
  it after every message that changes what the app should do. Helpers read it and leave it alone.
  It is committed with the app (the main chat's notes are saved after each of its turns, in the
  landing slot). While an app has no overview of the agent's own, each prompt carries a hidden note
  asking for one, so older apps get theirs on their next turn; `server/scripts/backfill-overviews.mjs`
  can write drafts from the chat history for all of them at once.
- **The `anyapp` command** (`server/src/apps-cli.ts`): `anyapp apps`, `anyapp overview <app>`,
  `anyapp path <app>`. The companion installs it in `<state>/bin` at start (so the desktop app
  installs it by running the companion) and every Claude Code session it starts has it on PATH. It
  reads the state folder and the app folders directly instead of calling the companion: the only
  HTTP token that could list apps is the admin token, which must never be in an agent's
  environment, and files need no running companion. A dev companion's launchers read its own state
  folder. Other apps are read only (playbook rule; the command itself never writes).
- **Reuse**: the playbooks tell the main chat to check the person's other apps before a new app or
  feature and point the helper at what to reuse, and tell helpers to read and copy that code.

## Pages in the chat, plan first, "Ask me more" (added 2026-11-11)

The user: "the agent should always write bullet points and subpoints and give HTML that explains the
app that it's going to build before it starts, so the user can confirm. Copy how inline HTML works in
Ghostex", answering questions inside the page, the same page on the phone and the PC, and an "Ask me
more" option in the New app sheet.

- An app's agent (or a helper it asks) publishes a self-contained HTML page into the app's main chat
  with the `show_page` tool (MCP server `pages`). The chat shows a card; the phone opens it in a web
  view, the PC in a window. Ghostex's page kit (question kit, drafts, answers, Mark as seen) is copied
  as is, with the Workbench theme. Answers reach the agent as one message (`<page-answers ...>`).
- Pages are sandboxed: an opaque origin, no bridge into the phone app, no session token (a signed
  ticket opens each page), fetches only to the page's own routes and https.
- Plan first: before a new app or a large change, the plan in bullets and a plan page, then wait for
  "Build it" or a yes. "Ask me more" adds a question page before the plan.
- Details, routes and the protocol additions: `docs/PAGES.md`.

## The fast lane: quick updates and the Reload popup (added 2026-11-11)

The user picked "Fast lane" and "Bundle swap builds" (`C:\aa\ideas\ideas.html`, Q19, Q20) and asked
for "a button that appears like a pop-up on the app itself that says 'Reload'" for both quick
updates and new APKs, so they never have to go back to Kiwimake to get a change.

- After every turn the builder decides by the app's native fingerprint: only JavaScript changed
  means a quick build in seconds (no Gradle): the last APK with the new bundle and version code
  (bundle swap), plus a quick update signed with the app's own key. Anything native means the
  full build, as before. Kotlin and Expo Exact apps always get the full build.
- Kiwimake hands a quick update to the app; inside every app a "Version N is ready" card with
  Reload starts it in place (or installs a new APK through Kiwimake and opens the app again).
  A quick update that fails at start rolls back by itself. Tiles show the version that runs.
- The playbooks and the templates' AGENTS.md explain it, and the chat says "Sent as a quick update,
  no install needed" when that is what happened.
- Design, security and the proof: `docs/FAST-LANE.md`.

## Versions, What changed, Crash catcher, the app's diary (added 2026-11-11)

The user picked "Versions and undo", "What changed card", "Crash catcher" and "A diary the agent can
read" from the ideas page. Every build is a version the person can go back to (built again as a new,
higher version, so it installs over the current one and keeps the app's data) or undo; each new
version arrives with up to three plain lines (Changed, Try it, Good to know) the agent writes with
its `describe_change` tool; generated apps catch their crashes and hand them to Kiwimake, which
shows "Tea Timer crashed. Fix it?" and sends the report to the app's agent on a tap; and apps keep a
small private diary on the phone that the agent reads with `read_diary` (phone and PC only). The
decisions, the Android wire format and the protocol additions: `docs/VERSIONS.md`.

## Never lose your apps, the usage meter, keep my apps healthy (added 2026-11-11)

The user picked "Never lose your apps", "Usage meter" and "Keep my apps healthy"
(`C:\aa\ideas\ideas.html`, Q43, Q45, Q47). Details and the proof: `docs/TRUST.md`.

- **Backup**: one switch in desktop Settings backs up every signing key, every app's code with its
  history (a Git bundle), its chat and to-dos into a folder the person picks (OneDrive or USB),
  after every new version and once a day. Encrypted to a recovery key whose private half only the
  person's password opens, so the PC backs up without keeping the password. Keys never go to
  GitHub. "Restore on a new PC" adds the keys and apps a PC lacks and builds each app once, so the
  phone updates it in place.
- **Usage meter**: each message shows what its work used (from each ACP turn's `usage`), each app
  its month and total, and the plan's limits only as Claude reported them; a heads-up before a big
  job. Phone and PC.
- **Keep my apps healthy**: an app behind the newest template (older Expo SDK or Android target,
  missing or older built-in parts) gets a yellow "!" on its icon and "Update it", which sends its
  agent the update message; a reminder once a month while any app is behind.

## Like this, but mine; Send app (added 2026-11-12)

The user picked "Like this, but mine" (Q15) and "Send it in WhatsApp" (Q39) from `C:\aa\ideas\ideas.html`.

- **Like this, but mine**: Kiwimake is in Android's share sheet for pictures (one or several)
  and text (links). Sharing opens one screen (`app/src/app/like-this.tsx`): what was shared, "Make
  a new app" (a name) or "Change one of my apps" (pick it), a box "What to keep and what to change",
  then the message goes to that app's agent with the pictures attached (as in the chat) and the link
  as a line of text. The PC adds a note only the agent sees (`server/src/playbook.ts`,
  `sharedInNote`): make it like this, the person's way, without the other app's name, logo or
  artwork; read a link with its web tools if it can, otherwise say in one line what it could not see.
  Native side: `ShareFiles.kt` copies shared pictures into the cache while Android's grant lasts.
- **Send app**: on an app's hold menu and the chat's menu (the three dots). One short note first
  (they allow installs from WhatsApp or Files; new versions do not reach them this way, sharing on
  GitHub does, `docs/DISTRIBUTION.md`), then the share sheet with the installed APK copied as
  `<App name>.apk`. Only that file is shared, never the signing key. On a phone the installed APK is
  the arm64 build (or the universal one when that was installed).
- **The diary during an install**: when the agent reads an app's diary (`read_diary`) while that
  app is being installed, the phone waits for the install (up to 42 s, then says it is still
  installing so the agent tries again) before it asks the app; the PC waits 56 s in all (was
  25 s; Claude Code gives up on a tool call after about 60 s).

Protocol (additive): `CreateAppRequest.images`, `CreateAppRequest.sharedIn`, `SendMessageRequest.sharedIn`,
`DiaryAnswer.problem` "installing".

## Change this app (added 2026-11-12)

The user picked, on `C:\aa\ideas\change-this-app.html`: Suggest a change by share text (Q240), code
in each public release (Q241), clones (Q242: "I will have my app, and they will have the same app,
but their own version of it ... everything is separate. I can ask my agent to copy from someone
else"), and the explanation in the app, then GitHub (Q243).

- Every app's Settings ends with "This app": **Change this app**, its version, "Made by <owner>
  with Kiwimake". The owner lands in the app's chat; anyone else can suggest a change (a text
  through the share menu, filed into the owner's "From others" inbox) or, with a paired PC, make
  their own version (a separate app from the published code). Without Kiwimake the app explains
  itself and links to Kiwimake's latest release.
- Shared apps' releases carry their code (`<slug>-source.zip`, without the app's notes about the
  owner, `.env` files or keys). "Show Change this app to others" in the Share dialog.
- `anyapp copy` lets any app's agent take something from another app, only on request.
- Details, the link, the message format and the protocol additions: `docs/CHANGE-THIS-APP.md`.

## Automate (added 2026-11-12)

The user answered `C:\aa\ideas\any-tasker.html`: automations you just describe, as a separate app
Kiwimake makes and keeps (**Automate**, a normal app in the grid), written by the agent as
scripts, typed in the app's one Change this app box, with every safety rail (a card before on, ask
before sending, run log, Stop all, hard limits, and a Settings, Advanced toggle that turns the locks
off) and all nine powers in the first version. Automations are JavaScript only, so they arrive
through the fast lane, never as a new APK unless a new native power is needed.

- The app's starter: `automate/app` (made through New app with one message, `automate/README.md`).
- Design, the fence around scripts, the powers, milestones and the proof: `docs/AUTOMATE.md`.
- No protocol, server, builder or phone app change.

## The name: Kiwimake (added 2026-11-12)

The product is **Kiwimake** (domain kiwimake.ai, being bought). The things people make are
**kiwis** ("Make me a kiwi", "Share your kiwi"). Earlier working names: AnyAppAgent, then Appwin.

- **Renamed: everything a person sees.** The phone app's label and screens, the desktop app's
  window, tray, installer (`Kiwimake-Setup.exe` from 0.3.0) and shortcuts, the "Made by ... with
  Kiwimake" line and "Get Kiwimake" in generated apps, share texts, notifications, the playbooks
  and templates' AGENTS.md (so agents say Kiwimake), the docs.
- **"Kiwi" in the UI** only on the button that makes a new app: **Make a kiwi** (the phone's tile
  and sheet title, the desktop's button and dialog title). Everywhere else it stays "app".
- **Kept, because installs, pairing and updates depend on them:** package ids (`com.anyappagent`,
  `com.anyapp.<slug>`), signing keys and their `CN=AnyAppAgent` subjects, the desktop app id
  `com.anyappagent.desktop` and its settings folder `%APPDATA%\AnyAppAgent`, the state folder
  `%USERPROFILE%\.anyappagent`, port 8787, the `anyapp` command, the `anyappagent://` link scheme,
  protocol names, the local folder names (`C:\dev\AnyAppAgent`), environment variables, the
  backup folder name `AnyAppAgent backup`, and the phone APK release assets `AnyAppAgent.apk` and
  `AnyAppAgent-universal.apk` (installed desktop apps download `latest/download/AnyAppAgent.apk`).
- **The repository moved** to `maddada/Kiwimake` on GitHub (2026-11-17). GitHub redirects the old
  `maddada/AnyAppAgent` URLs, so released apps keep working. The phone's release feed in
  `app/app.config.js` still names the old address: that file is part of the phone's over-the-air
  runtime version, so it changes with the next release that needs a new APK anyway.
- The separate domain for people's web apps (`docs/WEB-APPS.md`) is still to be picked.

## Two engines and a smaller installer (added 2026-11-13)

The user: "use the claude cli that's on the machine. use the recommended way on each OS to install
it. also we need [codex] support, we use sol 6.1 high always if codex is selected basically. dont
show model selector, just the user can pick either in setup."

- **The PC picks one engine: Claude or Codex.** Setup's second step ("Choose your AI") and Settings
  have the choice; there is no model selector anywhere. The choice is `engine` in the desktop's
  settings and reaches the companion as `ANYAPP_ENGINE`. Changing it waits until no app is working,
  restarts the companion and keeps every app, file and chat. Each app keeps one session id per
  engine (`engineSessions` in its record), so switching back resumes the old session.
- **Claude** is the `claude` CLI installed on the PC, passed to the ACP adapter as
  `CLAUDE_CODE_EXECUTABLE`. The installer no longer carries a Claude binary. On Windows only an
  `.exe` counts (the SDK spawns it directly, which a `.cmd` shim cannot do).
- **Codex** is the `codex` CLI, run as `codex app-server` over stdio, one private process per app
  session (no shared daemon). It uses model `gpt-6.1-sol` at `high` reasoning effort, with
  the app's MCP tools passed per thread (`server/src/acp/codex-session.ts`). A ChatGPT plan that
  does not include `gpt-6.1-sol` (a free plan) refuses every turn ("The 'gpt-6.1-sol' model is not
  supported when using Codex with a ChatGPT account."). Then the companion drops the refused turn
  from the thread, runs it again once on `gpt-6-luna` and remembers that in its state
  (`codex-model.json`, with a hash of the signed-in account and plan, never the account itself),
  so later chats start on `gpt-6-luna`. It tries `gpt-6.1-sol` again after a sign-in change or a
  day later, so a paid plan gets it back by itself (`server/src/acp/codex-model.ts`, added
  2026-11-20). The person sees nothing of this, only one quiet line under "The AI that makes your
  apps" in Settings naming the model in use (`AdminState.codexModel`, additive).
- **Install and update the way Ghostex does** (its `packages/shared/agent-cli-catalog.json` and
  `server/src/agent_cli`): find the CLI on PATH and in the official install folders, skipping a
  host's session wrappers; when missing, run the official installer (`claude.ai/install.ps1` or
  `.sh`, `chatgpt.com/codex/install.ps1` or `.sh`); update the copy that runs through the tool that
  owns it (`claude update`, `codex update`, npm, Homebrew, winget or mise), once a day while no app
  is working, plus "Check for updates" in Settings. An install Kiwimake does not recognise is left
  alone. Sign-in runs `claude auth login --claudeai` or `codex login`.
- **Usage**: plan limits are shown for the selected engine only, named after it ("Your Codex plan
  needs a rest"). The cloud keeps Claude and its own rules.
- **Smaller installer** (choices from `C:\aa\ideas\size\index.html`): no bundled phone APK (the
  desktop downloads the pinned arm64 `AnyAppAgent.apk` of its own version on first use and checks
  its SHA-256, `desktop/phone-release.json`), only en-US, en-GB and Arabic Electron locales, the
  companion's runtime packages staged with `npm ci --omit=dev`, without source maps, declaration
  files, tests, examples or theme previews. On the phone: resource shrinking, and the Go bridge
  built with `-trimpath -ldflags=-s -w`.

## Safer installs over an old copy (added 2026-11-16)

After moving to a new PC, the user's phone looped through Android's install prompt and Play Protect
and then "Failed to install" for every app made on the old PC or by the cloud ("Fix it so this
doesn't happen to users").

- Kiwimake checks the signing key before installing (`signedLikeInstalled`) and, instead of
  Android's prompt, Play Protect and a failure, shows "Remove old version" with one button that
  removes it and installs the new one. Android's install prompt is no longer opened twice.

## Feedback that sends (added 2026-11-16)

The user, after shake feedback seemed to vanish: "it should actually send", then picked on a page:
Send stays in the app, the agent starts at once, and pasting a copied picture is one tap. Also: a
toast after Save, a button to send to Kiwimake when it is their app, and Share for WhatsApp.

- **The feedback screen** (template core, `KiwimakeLink.kt`) has Send to Kiwimake (only when
  Kiwimake's `owns/<pkg>` says the app is the person's), Save (clipboard and gallery, a toast) and
  Share (Android's share sheet). Send hands the picture (a one-off `content://` grant from the
  app's feedback provider) and the notes to Kiwimake in an ordered broadcast
  (`com.anyappagent.action.FEEDBACK`, sender proven by a PendingIntent, as crash reports).
- **Kiwimake** (`AppReports.kt`) copies the picture, queues it, and keeps the broadcast open until
  its JavaScript has put it in the app's chat (`reports.ts` `sendFeedback`: a normal message with
  the picture), then answers SENT; no answer within 8 s answers WAITING (sent on the next connect).
  Without its JavaScript running it answers WAITING and posts "Feedback for <app> is ready to
  send". The app says "Sent to <app>'s chat" (Open chat) or "Kept in Kiwimake" (Open Kiwimake).
  `anyappagent://?chat=<package>` opens an app's chat. No protocol change.
- **Paste**: the chat shows "Paste the picture you copied" above the chat box while the clipboard
  holds a picture not pasted or turned down yet.

## Duplicate and Rename (added 2026-11-18)

The user picked, on the fork and rename page: Q40 A, Q41 B named "Duplicate", Q42 B with a toggle
for C. Both sit in the small row of the app's sheet on the phone (Pin to top, Hide, Duplicate,
Rename, Delete; the pencil next to the name also renames) and in the app row's menu on the desktop.
PC apps only (cloud apps keep only Delete there).

- **Duplicate** (`POST /api/apps/:id/duplicate`): `builder.adoptApp` from the app's own folder, plus
  its `.git` (history kept, the GitHub remote dropped), so the copy has the code, its Git history,
  `APP_MEMORY.md` and `overview.md`. A new slug and package id `com.anyapp.<slug>`, its own signing
  key, its own private repo `anyapp-<slug>`; versions start at 1. Its chat starts with one line,
  "Copied from Tea Timer, version 7." "What should be different?" filled in: that is its first
  message and the agent starts on it; empty: the PC only builds it (no agent turn) and the agent
  hears it is a duplicate with the person's first message. Data inside the app on a phone is never
  copied. Expo Exact apps are refused.
- **Rename** (`POST /api/apps/:id/rename`): the name, the folder (`~/aa/apps/<new slug>`) and the
  private repo (`gh repo rename`, only `anyapp-<old slug>` to `anyapp-<new slug>`; GitHub forwards
  the old address) change; the package id stays, so the phone updates in place with the next build
  (a full build: Android's app name is native). The agent starts a new session in the new folder
  (Claude and Codex keep sessions by folder) and is told about the rename with the next message; its
  notes are in the folder. A shared app's `anyapp-<slug>-releases` repo is never renamed: the record
  keeps `shareSlug`, and sharing, publishing and the install link keep using it. Refused while the
  app or a helper is working.
- **Make it a new app** (the toggle, off by default): also a new package id and signing key, so the
  phone gets it as a new app and the old copy stops getting updates; what the old one saved stays
  in it. Refused while the app is shared; an earlier, switched-off sharing is forgotten so it can be
  shared anew.

Protocol (additive): `DuplicateAppRequest`, `RenameAppRequest` and the two routes.

## Web apps (added 2026-11-18)

The user answered the web apps page (Q35 to Q39). Details, the reasons and what replaced the 12 Nov
plan: `docs/WEB-APPS.md`, section W19.

- **Per app: Web, Android or Both.** The plan says which and why, with the switch on the plan page;
  the agent records it with its `set_app_kind` tool. Both is one app: the Android app at the root
  plus a web version in `web/`, both built after every change.
- **A plain web template**, `template-web/` (Vite and React), the preset `"web"`; the builder's
  `buildWeb` makes the site (no source maps, a service worker, a manifest).
- **The person's own GitHub Pages**: every successful build goes live; the PC pushes only the built
  files (after the secrets scan) to a public repo `anyapp-<slug>-web`, the code stays private. Each
  app uses its own storage names (all of a person's apps share `<login>.github.io`).
- **Inside Kiwimake** on the phone: a tile opens it full screen, Add to home screen, offline after
  the first open, AI through Kiwimake's AI proxy, and "Version N is ready, Reload" in the app.

## Ready apps, the gallery of official apps (added 2026-11-18)

The user picked, on the gallery page (Q43 to Q48): the gallery on the empty Home and as a tile once
the person has apps (and a row in the desktop's app list); a line plus the badge "Official Kiwimake
App"; both Install (the signed APK, no PC) and Make it mine (`POST /api/clones`); the apps in their
public releases repos, the list as `website/public/gallery.json` served by kiwimake.ai, and the code
repos public; updates when the owner publishes; Water Glass, Prayer Alarm, Alarm Up and Kiwi Games
(Game renamed). The badge is earned by the signing certificate: Install checks the APK's, and a copy
on the phone shows it only when its certificate is the list's. Details and the proof: `docs/GALLERY.md`.

## Games (added 2026-11-19)

The user answered the game templates page (`~/aa/ideas/game-templates.html`): Q63 B, Kotlin and
Compose, built multiplatform-ready; Q64 A, one template; Q67 C, instructions only; Q68 A, Kiwi
Games stays as it is; Q66 A, the template and the game kit in 0.3.5.

- **The preset "game"** (`template-game/`, laid over `template-kotlin/`): the game in `game/`, a
  Kotlin Multiplatform module with Compose Multiplatform, built for Android today; the Android app
  around it in `app/` (the Kotlin starter's: feedback, updates, Change this app, AI, the diary).
  Built like a Kotlin app (full builds, no quick updates), about 1.3 MB.
- **Ready for iPhone and the web later**: the game's `AGENTS.md` says so first and gives the rules
  (only multiplatform libraries in `game/`, pictures and sounds in `composeResources`, phone
  abilities through the `GameHost` interface, no `android.*`, `java.*` or OpenGL in game code).
  Nothing in the build checks them (Q67: instructions only). Kiwimake builds Android games only.
- **The game kit** (`game/.../kit/`): `GameHost` (sound, vibrate, saves, AI, Settings), the frame
  loop, touch buttons that can be held, pressed and moved by the player, sounds, a pause menu, the
  game's look. The starter game is Kiwi Catch.
- **How a game is made**: the plan says it is a game (no "Web, Android or Both" question) and the
  agent calls `set_app_kind "game"`, which makes a new app (at most one version) again from the
  game template; or "Game" under Advanced in the New app sheet. A game never gets a web version
  yet, cannot move to or be kept ready in the cloud, and Duplicate and Rename work as for Kotlin
  apps.
- Kiwi Games stays a plain Kotlin app.

Proof (2026-11-19): a private companion (port 8851, its own state and apps folders, GitHub off,
the real builder) and a private emulator (AVD `gamesproof`, Android 15, port 5570). Asked for "a
little space game" with preset Game, the agent wrote a plan page with no Web/Android/Both question
("an Android game today, made ready for iPhone and the web later"), called set_app_kind "game",
and its helper made Star Rocket in `game/` (no Android or Java imports, its own sounds and icon,
portrait). Build 1: 42 s, 1.3 MB. Installed and played on the emulator: the rocket moves with the
arrow buttons, FIRE shoots, asteroids score, a hit costs a life, the best score is kept. The starter
(Kiwi Catch) was played too: touch buttons held and moved (their places kept across an update), the
pause menu, Settings over the game and back. Fixed from the run: the kiwi could leave the screen at
the edge; Settings got a "Back to the game" button (the game is full screen); the agent's per-button
colours and smaller word labels ("FIRE") went into the kit.

Protocol (additive): `AppPreset` gains `"game"`; the set_app_kind tool takes `"game"`. Older phones
and desktops show a game as an Android app; picking Game in the New app sheet needs the new phone
and desktop.

## Picking the kind in the conversation (added 2026-11-20)

The user: "Make picking the template a conversation with the agent based on the description I give
in the beginning about that game or app."

- **The person only describes it.** The New app sheet's Advanced (phone and PC) starts on "Let the
  agent decide" (the default, `shared/presets.ts`); the manual picks (React Native, Kotlin, Game,
  Expo Exact) stay there. "Let the agent decide" sends no `preset`; a manual pick is sent, React
  Native too, and the agent keeps it without asking.
- **The agent's first reply** starts with one friendly sentence on which kind it makes and why
  ("This sounds like a game, so I'll make it a game for Android that can move to iPhone and the web
  later."). Clear from the words: it calls `set_app_kind` (`android`, `web`, `both` or `game`) in
  that same turn and goes on (the plan, as before). Unclear ("something for my mom"): one short,
  never technical question with 2 to 4 answers to tap (the `ask_choice` tool), and it waits; the
  plan comes after the answer. With "Ask me more", an unclear kind is the first question on the
  question page instead. React Native or Kotlin is not asked: Android means React Native.
- **Changing it**: the person says so in the chat while the app is new; the agent calls
  `set_app_kind` again (the same limits as before: once an app has versions most switches are
  refused, and a game, a web app or an Expo Exact app stays what it is).
- **The plan page** no longer asks "Web, Android or Both" for a new app; its lede names the kind.
  A change to an app with versions that would add a web version asks "Also as a web page?".
- **Quick replies**: `ask_choice` puts one assistant item in the main chat with `choices` (held until
  the agent's turn ends, so it is the last thing in the chat, under one short line); phone and
  desktop draw the answers as buttons under the question, aligned right, while no message of the
  person's followed it; a tap sends the answer as their message. Helpers cannot use it.
- Server: `server/src/playbook.ts` (`appKindSection`, `kindNote`, `firstPrompt`), the coordinator
  playbook (version 9), `server/src/history.ts` (`ask_choice`), `server/src/pages/PAGE-KIT.md`.
  Clients: `shared/chat/rows.ts` (the `choices` row), `app/src/chat/ChatRows.tsx`,
  `desktop/src/renderer/src/Chat.tsx`, both New app sheets.

Protocol (additive): `ChatItem.choices`; `CreateAppRequest.preset` absent now means "Let the agent
decide" (the app still starts as React Native, as before). Older phones and desktops read the
question's answers as a list in its text, and their default (no preset) gets the agent's pick.

Proof (2026-11-20): a private companion (port 8861, its own state and apps folders, GitHub off,
Claude). "a little space shooter" became a game ("This sounds like a game, so I'll make it a game
for Android that can move to iPhone and the web later."); "a page for my bakery's menu" a web app
("I'll make your menu a web page: customers just open a link or scan a code in the shop, with
nothing to install."), and "Actually, make it an app I install on my phone instead." switched it to
Android; "a water reminder" an Android app ("Reminders need to arrive even when the app is closed,
so I'll make this an app you install on your phone."); "something for my mom" asked "What would your
mom enjoy most?" with three answers to tap, and "A page she opens from a link" made it a web app.
A manual Kotlin pick was kept with no question. No plan page asked the kind. Fixed from the run:
the kind sentence now comes before anything else, and the question is held to the end of the turn
(the agent had greeted before and after it). Codex was not tried live (not signed in on this PC).
