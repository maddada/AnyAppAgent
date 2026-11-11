# AnyAppAgent: what we are building

AnyAppAgent is an Android app, side-loaded only (never published to a store), for making other
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
| `builder/`  | Creates an app from the template and builds its signed APK.                      |
| `app/`      | The AnyAppAgent Android app itself (React Native, Expo).                         |
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
  it on the Ghostex coordinator idea (`C:\Users\madda\.claude\skills\ghostex-orchestrator\SKILL.md`,
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
- **Permissions**: AnyAppAgent may ask for any Android permission that makes the flow smoother
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
  only on the same Wi-Fi, with nothing else to install. In AnyAppAgent it carries only the
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
createApp({ dir, name, slug, packageName, onLog? }) -> Promise<void>
    Copies the template into dir, fills in name and package id, and leaves it ready to build.
buildApk({ dir, buildNumber, onLog? }) -> Promise<{ apkPath, sizeBytes, sha256 }>
    Builds a signed, installable APK with versionCode = buildNumber. Rejects with an Error whose
    message is the useful part of the build output (the part an agent needs to fix it).
getIconPath({ dir }) -> string | null
    Absolute path of the app's launcher icon PNG, or null.
```

and a CLI for humans and tests: `node builder/cli.mjs create <dir> --name "<name>"` and
`node builder/cli.mjs build <dir> --build-number <n>`.

## The contract between `server/` and `app/`

`shared/protocol.ts`. Both sides implement exactly that. Additive changes only, listed in the
thread's report.

## Proof that it works

The finished system is proven on the Android emulator: AnyAppAgent is installed there, paired with
the companion on this PC, and used (through its own UI) to create a Muslim prayer alarm app for
Ajman, UAE: correct prayer times, each time adjustable by the user, and two announcements before
each prayer at offsets the user sets. The APK arrives and installs through AnyAppAgent, and a
second prompt produces an update that installs over it.

## Sharing this PC

Several threads work at once. Edit only your own folder. Use only your own Android package on the
emulator; never wipe the emulator, uninstall another thread's app, or kill the adb server. The
existing AVD named `ghostex` belongs to another project: do not use or change it.

## AI for your apps (added 2026-11-11)

The user: "I wanna add a ai token (Claude or open router) in AnyAppAgent and then all my sub apps
can use it to call ai, because I want my sub apps to support ai agents". And: the key is a
regular field in AnyAppAgent's Settings, not a separate screen.

- **The key lives only in AnyAppAgent** (`app/modules/anyapp-ai`): one field in Settings, "AI for
  your apps". Claude (`sk-ant-`) or OpenRouter (`sk-or-`) is detected from the key, or picked.
  Stored encrypted (AES-256-GCM, key in the Android Keystore), never read back into JavaScript
  (Settings shows only the last 4 characters). Default models: `claude-opus-5-5` (Claude),
  `anthropic/claude-opus-5.5` (OpenRouter); changeable. "Save and test" makes one tiny real call.
- **Apps use it through a local proxy, never the key.** AnyAppAgent exports a bound service
  (`AiProxyService`, action `com.anyappagent.action.AI`, Messenger). An app sends a neutral chat
  request (text, images, tools); AnyAppAgent adds the key, calls the provider, streams the answer
  back (text pieces, tool calls, done/error) and counts tokens. Wire format:
  `template/modules/ai/README.md`. The app-side API is `template/src/lib/ai.ts` (`chat`, `ask`,
  `runAgent`, `useAiStatus`, `AiSetupNotice`), documented in `template/AGENTS.md`, "AI".
- **Why a proxy and not handing the key over:** the key never leaves one process, so a buggy or
  chatty app cannot leak it (logs, crash reports, a WebView, its own backups), removing the key or
  switching an app off takes effect at once for every app, and usage per app and limits can be
  enforced in one place. Streaming and tool use work through it, so apps can run agent loops.
- **Who may call it: a certificate check, not an Android signature permission.** AnyAppAgent is
  signed with the React Native debug key (public, the same in every RN project), while generated
  apps are signed with the PC's own key (`builder/lib/keystore.mjs`, `CN=AnyAppAgent`). So a
  `signature` permission would refuse every generated app, and signing AnyAppAgent with the PC key
  is impossible because each user's PC makes its own key. Instead the service identifies the caller
  by the Binder UID Android attaches to every message and allows only apps whose signing
  certificate equals that of an app AnyAppAgent installed itself (learned from Android's install
  source record). Any other app, including one with a `com.anyapp.*` name signed with another key,
  is refused (`not_allowed`).
- **Limits and cost:** per app an on/off switch and a usage line (calls, tokens) in the same
  Settings group; per app at most 3 requests at once and 30 a minute; `maxTokens` default 8192,
  capped at 32000; requests up to 12 MB.
- **Testing without a key:** `app/dev/fake-ai-provider.mjs` speaks both provider APIs (SSE, tool
  calls). `adb shell setprop debug.anyapp.ai.url http://10.0.2.2:<port>` points AnyAppAgent at it;
  only adb can set it, and while it is set the stored key is never sent (a placeholder is).
