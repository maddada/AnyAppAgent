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
| `template-kotlin/` | The native Android starter (Kotlin, Compose) for the "Kotlin" preset.     |
| `template-exact/` | AnyAppAgent's files for the "Expo Exact" preset (alpha; apps come from `exact new`). |
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
    its own name, package id and signing key. React Native and Kotlin.
```

buildApk also takes `changeOwner` and `changeOthers` (the "Change this app" values written into
the build).

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

## Sharing apps and updates (added 2026-11-11)

The user: "i want to make the app have distribution features built in ... you can send updates
through github to people ... integrate each app that i create with github so i can upload it there".
Decided: an updater in every app with AnyAppAgent handling updates first when it is on the phone,
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
updates and new APKs, so they never have to go back to AnyAppAgent to get a change.

- After every turn the builder decides by the app's native fingerprint: only JavaScript changed
  means a quick build in seconds (no Gradle): the last APK with the new bundle and version code
  (bundle swap), plus a quick update signed with the app's own key. Anything native means the
  full build, as before. Kotlin and Expo Exact apps always get the full build.
- AnyAppAgent hands a quick update to the app; inside every app a "Version N is ready" card with
  Reload starts it in place (or installs a new APK through AnyAppAgent and opens the app again).
  A quick update that fails at start rolls back by itself. Tiles show the version that runs.
- The playbooks and the templates' AGENTS.md explain it, and the chat says "Sent as a quick update,
  no install needed" when that is what happened.
- Design, security and the proof: `docs/FAST-LANE.md`.

## Versions, What changed, Crash catcher, the app's diary (added 2026-11-11)

The user picked "Versions and undo", "What changed card", "Crash catcher" and "A diary the agent can
read" from the ideas page. Every build is a version the person can go back to (built again as a new,
higher version, so it installs over the current one and keeps the app's data) or undo; each new
version arrives with up to three plain lines (Changed, Try it, Good to know) the agent writes with
its `describe_change` tool; generated apps catch their crashes and hand them to AnyAppAgent, which
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

## Change this app (added 2026-11-12)

The user picked, on `C:\aa\ideas\change-this-app.html`: Suggest a change by share text (Q240), code
in each public release (Q241), clones (Q242: "I will have my app, and they will have the same app,
but their own version of it ... everything is separate. I can ask my agent to copy from someone
else"), and the explanation in the app, then GitHub (Q243).

- Every app's Settings ends with "This app": **Change this app**, its version, "Made by <owner>
  with AnyAppAgent". The owner lands in the app's chat; anyone else can suggest a change (a text
  through the share menu, filed into the owner's "From others" inbox) or, with a paired PC, make
  their own version (a separate app from the published code). Without AnyAppAgent the app explains
  itself and links to AnyAppAgent's latest release.
- Shared apps' releases carry their code (`<slug>-source.zip`, without the app's notes about the
  owner, `.env` files or keys). "Show Change this app to others" in the Share dialog.
- `anyapp copy` lets any app's agent take something from another app, only on request.
- Details, the link, the message format and the protocol additions: `docs/CHANGE-THIS-APP.md`.
