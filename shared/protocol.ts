// AnyAppAgent wire contract between the PC companion (server/) and the Android app (app/).
// TYPES ONLY: no runtime values in this file, so both sides can `import type` from it.
// Changes must be additive, and every change is listed in the thread's final report.

export type AppStatus =
  | "creating" // project is being scaffolded (template copy, git, GitHub, first session)
  | "idle" // nothing running
  | "working" // the agent is in a turn
  | "building" // the APK is being built after a turn
  | "error"; // creation or the last build failed (see App.error / App.build.error)

export interface BuildInfo {
  number: number; // 1, 2, 3 … also the APK's Android versionCode
  status: "running" | "succeeded" | "failed";
  startedAt: string; // ISO 8601
  finishedAt?: string;
  sizeBytes?: number; // set when succeeded
  sha256?: string; // set when succeeded
  signerSha256?: string; // certificate SHA-256 of the key that signed it (docs/DISTRIBUTION.md); absent from older PCs
  error?: string; // short, human readable, set when failed
  // Added for smaller downloads: the same build as one APK per phone processor type (ABI), each
  // much smaller than the full APK (sizeBytes/sha256 above), which holds every ABI. Set when
  // succeeded and the PC built them; absent from older PCs and from apps without native code.
  variants?: ApkVariant[];
  // Added with versions and undo (docs/VERSIONS.md). What changed in this version, in the person's
  // words (the agent writes it with its describe_change tool; the PC writes it for a go-back).
  // Set when succeeded; absent from older PCs and on builds made before.
  changes?: ChangeNotes;
  restoredFrom?: number; // this build went back to the code of that earlier version (Versions, Undo)
  // Added for the fast lane (docs/FAST-LANE.md). "quick": only JavaScript changed, so the PC made
  // this build in seconds without Gradle (the APK above is the last one with the new bundle) and
  // also a quick update (`ota`) that a phone whose app has the same native part (`runtime`) applies
  // without an install. "full": a normal build. Absent from older PCs (treat as "full").
  delivery?: "quick" | "full";
  // The build's native fingerprint (the app's string resource anyapp_runtime). React Native only.
  runtime?: string;
  ota?: OtaInfo;
}

// "What changed" (docs/VERSIONS.md): up to three short plain lines, never code words.
export interface ChangeNotes {
  changed: string; // what is different now: "The timer now rings three times"
  tryIt?: string; // what to try: "Start a 1 minute timer and wait for it"
  goodToKnow?: string; // anything to know: "Your saved timers are kept"
}

// A quick update: GET /api/apps/:id/ota serves the zip of the app's latest build (a signed
// manifest, the Hermes bundle and its pictures; the app checks the signature with its own key).
export interface OtaInfo {
  sizeBytes: number;
  sha256: string; // of the zip
  runtime: string; // the native fingerprint it needs; the app refuses it on other native code
}

// One APK of a build for one processor type: what GET /api/apps/:id/apk?abi=<abi> serves.
export interface ApkVariant {
  abi: string; // an Android ABI name: "arm64-v8a" (phones), "x86_64" (the emulator)
  sizeBytes: number;
  sha256: string;
}

// What an app is made from (chosen under "Advanced" in the New app sheet):
//   "react-native": Expo / React Native (the default; can come to iPhone later)
//   "kotlin": native Android (Kotlin, Jetpack Compose; smaller, faster, Android only)
//   "expo-exact": Expo Exact, alpha (Contract + TypeScript; one app for Android, iPhone, Mac, web)
export type AppPreset = "react-native" | "kotlin" | "expo-exact";

export interface App {
  id: string;
  name: string; // what the user typed, shown under the icon
  slug: string;
  packageName: string; // Android application id, e.g. com.anyapp.prayeralarm
  preset?: AppPreset; // absent on apps made before presets existed: those are "react-native"
  status: AppStatus;
  error?: string;
  iconVersion: number; // bumps whenever the icon file changes (cache key for GET /icon)
  latestBuild?: BuildInfo; // newest build of any status
  latestApk?: BuildInfo; // newest succeeded build: what GET /apk serves
  repoUrl?: string; // GitHub repository, when one was created
  lastMessagePreview?: string;
  // With helpers (docs/APP-COORDINATOR.md): status is "working" while the main chat OR any helper works.
  replying?: boolean; // the main chat itself is answering now (its Stop applies); absent from older PCs
  activeHelpers?: number; // helpers waiting, working or building now; set (0 or more) only when the chat uses helpers
  // Added with pages: a page with questions (a plan, "Ask me more") waits for the person. Cleared when it
  // is answered or the person sends any message. Absent from older PCs.
  waitingForAnswer?: boolean;
  signing?: "shared" | "own" | "moved"; // which key signs its builds (docs/DISTRIBUTION.md); absent from older PCs
  sharing?: AppSharing; // absent until the app is shared once (docs/DISTRIBUTION.md)
  openTodos?: number; // to-do items not ticked off yet (see "To-do"); absent from older PCs and when there are none
  createdAt: string;
  updatedAt: string;
}

// ---------- Sharing an app with other people (docs/DISTRIBUTION.md, "GitHub")
// The code stays in the app's private repo; sharing makes a second, public repo that holds only a
// README and the published versions (releases), so a friend can install it and get updates.
export interface AppSharing {
  shared: boolean; // true: the releases repo is public and new versions can be published
  releasesRepoUrl: string; // https://github.com/<owner>/anyapp-<slug>-releases
  installUrl: string; // the latest full APK, for a link or a QR (404 until a version is published)
  feedUrl: string; // the update.json the app's own updater reads
  since: string; // when it was first shared
  releases?: PublishedRelease[]; // newest first; absent until a version is published
}

// One published version (docs/DISTRIBUTION.md, "The release format").
export interface PublishedRelease {
  version: string; // "1.4" (Testing: "1.4-test.37")
  build: number; // the APK's versionCode
  channel: "stable" | "testing";
  tag: string; // the GitHub release tag: "v1.4-b37", or "testing" for the Testing channel
  url: string; // the release page on GitHub
  notes: string;
  publishedAt: string;
  pulledBack?: boolean; // stable only: no longer offered (Pull back)
}
// POST /api/apps/:id/publish PublishRequest -> App (publishes the newest build; 409 when the app is
// not shared or has no build, 409 + a new build when the newest build was signed by another key,
// 400 when the APK or the notes hold something that looks like a secret)
export interface PublishRequest {
  notes?: string; // default: the summaries of the builds since the last published one
  channel?: "stable" | "testing"; // default stable
}
// POST /api/apps/:id/pullback PullBackRequest -> App (stable only: the version is no longer offered;
// the version before it becomes the latest again, and update.json lists the build as blocked)
export interface PullBackRequest {
  build: number;
}
// GET /api/apps/:id/releases -> ReleaseStats[] (from GitHub: downloads per version)
export interface ReleaseStats {
  tag: string;
  downloads: number; // GitHub counts downloads of the APK files, not people
}
// POST /api/apps/:id/share ShareRequest -> App (turns sharing on or off; 400 with a plain sentence
// when something that looks like a secret would go public, 502 when GitHub fails)
export interface ShareRequest {
  shared: boolean;
}

export type ChatItemKind =
  | "user" // a prompt the user sent
  | "assistant" // agent message text (markdown)
  | "thought" // agent reasoning text
  | "tool" // one tool call
  | "plan" // the agent's todo list
  | "permission" // the agent asks to be allowed something
  | "build" // an APK build started by the server
  | "error" // something failed outside the agent's own text
  | "worker" // one row per worker in the app's main chat (ChatItem.worker); upserted as it moves
  | "stopped" // a plain "Stopped" line where the person stopped a turn (main chat or a helper's chat)
  | "page" // added: a page the agent published (ChatItem.page); the chat shows a card that opens it
  | "crash" // added: the app crashed on the phone (ChatItem.crash); the card offers "Fix it"
  | "diary"; // added: the agent read the app's diary from the phone (ChatItem.diary), one quiet line

export interface ToolCallInfo {
  title: string; // "Edit App.tsx", "Run npm install"
  kind: string; // ACP tool kind: read, edit, delete, move, search, execute, think, fetch, other
  status: "pending" | "in_progress" | "completed" | "failed";
  detail?: string; // command line, file path, or a short diff/output excerpt
}

export interface PlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface PermissionInfo {
  requestId: string;
  title: string;
  options: { optionId: string; label: string; kind: string }[];
  selectedOptionId?: string; // set once answered
}

export interface ChatItem {
  id: string; // stable: an update to the same item reuses the id (upsert)
  appId: string;
  seq: number; // strictly increasing per app, orders the timeline (assigned when the item is created; an update keeps it)
  kind: ChatItemKind;
  text?: string; // user, assistant, thought, error; on a build item: its latest progress line
  streaming?: boolean; // true while text is still growing
  tool?: ToolCallInfo;
  plan?: PlanEntry[];
  permission?: PermissionInfo;
  build?: BuildInfo;
  // On a user item (added for the chat on the PC): true while the message waits for the agent's
  // current turn (and its build) to end; set back to false when the agent gets it.
  queued?: boolean;
  // On a user item: true when Stop removed it from the queue, so it never reached the agent.
  dropped?: boolean;
  // On a user item: the pictures sent with it (GET /api/apps/:id/images/:imageId serves each one).
  images?: ChatImage[];
  worker?: WorkerInfo; // on a "worker" row: the worker it stands for (tap opens its chat)
  workerId?: string; // set on the items of a worker's own chat; never on the main chat
  page?: PageInfo; // added: on a "page" item (its text is the page's title, for older apps); upserted when answered
  crash?: CrashInfo; // added: on a "crash" item; upserted when it happens again or "Fix it" is tapped
  diary?: DiaryReadInfo; // added: on a "diary" item
  createdAt: string;
  updatedAt: string;
}

// ---------- Workers ("helpers" in everything the person sees). Each app's main chat is a coordinator: it
// answers at once and hands every real piece of work (a change, a fix, a look into something) to a worker,
// another Claude Code session for the same app. Each worker shows as one "worker" row in the main chat and
// has its own chat, read only.
// See docs/APP-COORDINATOR.md.

export type WorkerState =
  | "waiting" // its change waits for another change to land in the app first
  | "working" // in a turn
  | "building" // its change is being built into a new version
  | "done" // finished; its report went to the coordinator
  | "failed" // stopped by an error, or its change did not build
  | "stopped"; // the person (or the coordinator) stopped it

export interface WorkerInfo {
  id: string;
  appId: string;
  title: string; // its task in a few words, e.g. "Make the button green"
  state: WorkerState;
  latest?: string; // its latest line: what it is doing now, or its result once finished
  changesApp: boolean; // false: it only looks into something and changes no files
  buildNumber?: number; // the build its change produced, when it built
  createdAt: string;
  updatedAt: string;
  finishedAt?: string; // when it last went done, failed or stopped
}

// ---------- Pages (added): self-contained HTML pages an app's agent (or one of its helpers) publishes into
// the app's main chat, copied from Ghostex pages: explainers of a plan, mockups, and questions the person
// answers on the page itself. The companion stores and serves them; the phone opens one in a web view and
// the PC in a window. Answers go back to the agent as ONE message from the person whose text is
//   <page-answers page="<id>" title="<title>">\n<pretty JSON>\n</page-answers>
// (shared/chat/pages.ts formats and reads it; a client shows it as an answers card, not as raw text).

export interface PageInfo {
  id: string; // 32 hex characters
  appId: string;
  title: string;
  // The titles of the questions it asks (its <gx-question> elements), in page order; absent or empty
  // for a page that only shows something.
  questions?: string[];
  awaitsSeen?: boolean; // asks nothing: it ends with a reply box and "Mark as seen"
  answeredAt?: string; // when the person sent its answers (or marked it seen); the page is locked after
  seen?: boolean; // the answer was "Mark as seen"
  from?: { workerId: string; title: string }; // a helper published it (it still shows in the main chat)
  createdAt: string;
}

// POST /api/apps/:id/pages/:pageId/open -> PageOpenResponse. The page itself is served without a
// Bearer token at the path it returns (the ticket in it is the grant, signed by the PC, valid for a
// day), so a web view can load it, reload it and send its answers. Append "#gx-theme=dark" or
// "#gx-theme=light" to open it in that theme. The page runs sandboxed (opaque origin, no cookies or
// storage; it can only reach its own routes under that path and https).
export interface PageOpenResponse {
  path: string; // "/page/<pageId>/<ticket>": the page; its own routes (answers, draft, image) are under it
  expiresAt: string;
}
// GET /api/apps/:id/pages -> PageInfo[] (oldest first)

// ---------- Versions and undo (added, docs/VERSIONS.md). Every build that succeeded is a version. Going back
// never installs an old APK (Android refuses a lower version code): the PC builds the old code again as a
// new version with a higher number, so it installs over the current one and the app's data stays.

export interface AppVersion {
  build: number; // its version number (the APK's versionCode)
  title: string; // one plain line: what changed (ChangeNotes.changed, or the PC's summary for older builds)
  changes?: ChangeNotes;
  createdAt: string;
  restoredFrom?: number; // it went back to that version
  current: boolean; // the newest version (App.latestApk): what the phone gets
  canRestore: boolean; // false when the PC no longer has its code (or it is the current one)
}
// GET /api/apps/:id/versions -> AppVersion[] (newest first)
// POST /api/apps/:id/versions/:build/restore -> App (202: the go-back build starts; it arrives as a build
//   item whose BuildInfo.restoredFrom is set). 409 + ErrorBody while the app is busy, 404 for an unknown version.
// POST /api/apps/:id/undo -> App (202): goes back to the version before the newest one (409 when there is none).

// ---------- Crash catcher (added, docs/VERSIONS.md). An app made with AnyAppAgent that crashes (or shows its
// "something went wrong" screen) tells AnyAppAgent on the phone, which sends the report here when connected.

export interface CrashReport {
  kind: "crash" | "error"; // crash: the app closed; error: it caught the error and showed its error screen
  message: string; // the error's own message (one line), e.g. "TypeError: undefined is not a function"
  stack?: string; // Java and/or JavaScript stack, at most 16 KB
  screen?: string; // the screen it was on, when the app knows it
  versionCode?: number; // the build the phone runs
  at: string; // when it happened, ISO 8601
  diary?: DiaryEntry[]; // the app's latest diary notes (at most 50), oldest first
}
export interface CrashInfo {
  id: string;
  appId: string;
  kind: "crash" | "error";
  message: string; // one line
  screen?: string;
  versionCode?: number;
  count: number; // the same crash again within a day bumps this instead of adding a card
  firstAt: string;
  lastAt: string;
  fixAskedAt?: string; // "Fix it" sent it to the app's agent
}
// POST /api/apps/:id/crashes CrashReport -> CrashInfo (also arrives as a "crash" chat item)
// POST /api/apps/:id/crashes/:crashId/fix -> 202 (sends "Fix the crash" to the app's chat as the person's
//   message; the agent gets the whole report with it)

// ---------- The app's diary (added, docs/VERSIONS.md): a small private log the app keeps on the phone of what
// it did ("Asr alarm set for 15:42", "Alarm rang"). The agent reads it when fixing something; it goes from the
// phone to this PC only, and is not kept by the PC (the agent's own session on the PC has it).

export interface DiaryEntry {
  at: string; // ISO 8601
  text: string; // one short line, at most 200 characters
}
export interface DiaryReadInfo {
  ok: boolean;
  entries: number; // how many notes were read
  problem?: string; // plain sentence when it could not be read
}
// The PC asks a phone for an app's diary with the ServerEvent "diary.request"; the phone answers with
// POST /api/apps/:id/diary DiaryAnswer -> 204 (within 25 s, else the agent hears that the phone did not answer)
export interface DiaryAnswer {
  requestId: string;
  entries?: DiaryEntry[]; // oldest first, at most 300
  problem?: "not_installed" | "no_answer" | "not_supported"; // the app is not on this phone / did not answer / is too old to keep a diary
}

// ---------- HTTP (JSON). Everything except /api/health and /api/pair needs
// `Authorization: Bearer <token>`. Errors: non-2xx with ErrorBody.

export interface ErrorBody {
  error: string; // plain sentence the app can show
}

// Pairing QR code (printed by the PC in the terminal), a URI:
//   anyappagent://pair?url=<encodeURIComponent("http://<pc-address>:8787")>&code=<6 digits>

// GET /api/health
export interface HealthResponse {
  ok: true;
  name: string; // PC name
  version: string;
  protocol: 1;
}

// POST /api/pair
export interface PairRequest {
  code: string; // the 6-digit code the PC shows
  deviceName: string;
}
export interface PairResponse {
  token: string;
  serverName: string;
}

// POST /api/pair/easy-connect -> PairResponse (no token). Sent through the Easy Connect tunnel with
// the secret from the Easy Connect code; see docs/EASY-CONNECT.md for the code and the tunnel.
export interface EasyConnectPairRequest {
  secret: string; // from the scanned Easy Connect code
  deviceName: string;
  clientKey: string; // the phone's tailcat client public key, "nodekey:<64 hex>"
}

// POST /api/unpair -> 204 (phone token as Bearer, no body): the phone forgets this PC (the user tapped
// Disconnect) and the PC forgets the phone at once, as DELETE /api/admin/devices/:id does: its token stops
// working, its Easy Connect key leaves the allow-list and its socket closes.

// GET /download/anyappagent.apk (no token) -> the AnyAppAgent phone app's own APK, for the desktop's
// install QR (the companion serves the file named by its env var ANYAPP_HOST_APK; 404 + ErrorBody when unset)

// GET /api/apps -> App[]
// GET /api/apps/:id -> App
// DELETE /api/apps/:id -> 204 (removes the app from the list; keeps files and repo on the PC)

// POST /api/apps -> App (returns at once with status "creating"; progress arrives over the socket)
export interface CreateAppRequest {
  name: string;
  prompt: string; // what the app should do: becomes the first message to the agent
  preset?: AppPreset; // default "react-native"; an unknown value is refused with 400
  // Added: "Ask me more": before it plans, the agent asks the person questions about the app (on a page).
  askMore?: boolean;
}

// GET /api/apps/:id/icon -> image/png (the app's launcher icon; a generated placeholder until it has one)
// GET /api/apps/:id/apk -> application/vnd.android.package-archive (latestApk; supports Range; 404 if none)
//   ?abi=<abi> (added): the APK of latestApk.variants for that ABI; an ABI the build has no variant for
//   gets the full APK; 404 when the variant is listed but no longer on the PC. ETag is the served
//   file's sha256 in quotes, and If-Range with that ETag resumes a cut download (a different
//   ETag gets the whole file with 200, so a newer build never mixes into a resumed one).

// GET /api/apps/:id/messages?afterSeq=<n> -> ChatItem[] ordered by seq
// POST /api/apps/:id/messages -> 202 (the user's ChatItem arrives over the socket)
export interface SendMessageRequest {
  text: string; // may be "" when images are sent
  images?: ImageUpload[]; // pictures sent with the message (limits: shared/chat/images.ts)
}

// A picture as it is sent: already downscaled on the device to at most 1568 px on the long edge.
export interface ImageUpload {
  mimeType: string; // image/png, image/jpeg, image/webp or image/gif
  data: string; // base64, without a data: prefix
  width?: number;
  height?: number;
}

// A picture as the chat shows it.
export interface ChatImage {
  id: string;
  mimeType: string;
  width?: number;
  height?: number;
}

// GET /api/apps/:id/images/:imageId -> the picture's bytes (image/*), for a ChatItem's images

// POST /api/apps/:id/cancel -> 202 (stops the agent's current turn)
// POST /api/apps/:id/build -> 202 (builds again without a new prompt)
// POST /api/apps/:id/permission -> 202
export interface PermissionAnswerRequest {
  requestId: string;
  optionId: string;
}

// Workers (see "Workers" above):
// GET /api/apps/:id/workers -> WorkerInfo[] (newest last)
// GET /api/apps/:id/workers/:workerId/messages?afterSeq=<n> -> ChatItem[] of that worker's chat, ordered by seq
//   (seq counts per worker chat; every item has workerId set). A worker's chat is read only: the person
//   talks to it through the main chat.
// POST /api/apps/:id/workers/:workerId/cancel -> 202 (stops that worker; the main chat's cancel never does)

// ---------- To-do (added): the person's own short list of ideas for an app. Kept by the PC per app, shown on
// the phone and the desktop; the app's agent never sees it (not in its prompt, its repo or its tools).

export interface TodoItem {
  id: string;
  text: string; // one line
  done: boolean; // ticked off
  sentAt?: string; // when "Send to agent" sent it to the chat (it is done from then on)
  createdAt: string;
  updatedAt: string;
}

// GET /api/apps/:id/todos -> TodoItem[] (oldest first)
// POST /api/apps/:id/todos -> TodoItem (201)
export interface AddTodoRequest {
  text: string;
}
// PATCH /api/apps/:id/todos/:todoId -> TodoItem
export interface UpdateTodoRequest {
  done?: boolean;
  text?: string;
}
// DELETE /api/apps/:id/todos/:todoId -> 204
// POST /api/apps/:id/todos/:todoId/send -> TodoItem (sends its text to the app's chat as the person's
//   message, as POST /messages does, then marks it done)
// Every change also arrives over the socket as "todos.updated" (the whole list) and "app.updated" (openTodos).

// ---------- WebSocket: GET /ws?token=<token>. Server to app only; JSON text frames.
// The app may send the text frame "ping" every few seconds: writing is how a phone notices a dead
// connection whose close never reached it. The companion ignores frames from the app.

export type ServerEvent =
  | { type: "hello"; serverName: string; protocol: 1 }
  | { type: "app.updated"; app: App } // also sent for a new app
  | { type: "app.deleted"; appId: string }
  | { type: "chat.item"; item: ChatItem } // upsert by item.id
  | { type: "apk.ready"; app: App } // a new APK can be downloaded and installed now
  | { type: "worker.updated"; worker: WorkerInfo } // a worker started or changed (its main-chat row also arrives as chat.item)
  | { type: "worker.item"; item: ChatItem } // upsert into the chat of worker item.workerId (never the main chat)
  | { type: "todos.updated"; appId: string; todos: TodoItem[] } // added: the app's whole to-do list after a change
  | { type: "diary.request"; appId: string; packageName: string; requestId: string }; // added: send this app's diary (POST /diary)

// ---------- Desktop app (desktop/, Electron) to companion. The desktop app starts the companion
// as a child process with the env var ANYAPP_ADMIN_TOKEN=<random secret>. That token is accepted
// as a Bearer token on every route above and is the only thing accepted on /api/admin/*.
// Phone tokens never work on /api/admin/*.

export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt?: string;
  connected: boolean; // has a live socket right now
  via: "same-network" | "easy-connect"; // how it paired (and reaches the PC)
}

export interface EasyConnectState {
  state: "off" | "starting" | "ready" | "error";
  code?: string; // when ready: the one-time Easy Connect code the QR encodes (opaque to the desktop)
  expiresAt?: string;
  error?: string; // plain sentence
  detail?: string; // while starting: what it is doing now, a plain sentence
  // When ready without a code, no code is live (it was used or is older than 5 minutes):
  // POST /api/admin/pairing/new makes a new one.
}

// GET /api/admin/state
export interface AdminState {
  serverName: string;
  version: string;
  port: number;
  pairing: {
    code: string; // the 6-digit code for the same-network path
    lanUrls: string[]; // http://<address>:8787, most likely first
    qrPayload: string; // the anyappagent://pair?... URI for the same-network path
  };
  easyConnect: EasyConnectState;
  devices: PairedDevice[];
  signing?: SigningKeysState; // absent with the fake builder (added for docs/DISTRIBUTION.md)
}

// ---------- Signing keys (docs/DISTRIBUTION.md, "Signing"). Nothing here ever holds a password or
// a private key; certificates are public.
export interface SigningKeysState {
  keys: SigningKeyInfo[];
  lastBackupAt: string | null; // ISO time of the last backup made on this PC, null if never
  notBackedUp: string[]; // ids of keys made since the last backup (all of them if never)
}
export interface SigningKeyInfo {
  id: string; // "shared" (the PC's key for apps made before per-app keys) or an app's package id
  kind: "shared" | "own" | "moved"; // moved: rotated from the shared key (Android 9+ refuses the shared key for it)
  certSha256: string;
  appName?: string; // the app with this package id, when the companion knows it
}
// POST /api/admin/keys/backup  KeysBackupRequest  -> KeysBackupResult (writes one encrypted file)
// POST /api/admin/keys/restore KeysRestoreRequest -> KeysRestoreResult (adds the keys this PC lacks)
export interface KeysBackupRequest {
  file: string; // absolute path on the PC, chosen in a save dialog
  password: string; // at least 8 characters; never stored or logged
}
export interface KeysBackupResult {
  file: string;
  count: number;
  createdAt: string;
}
export interface KeysRestoreRequest {
  file: string;
  password: string;
}
export interface KeysRestoreResult {
  added: string[]; // key ids written to this PC
  same: string[]; // already here with the same certificate
  conflicts: { id: string; reason: string }[]; // here with a different certificate: kept, never overwritten
}

// POST /api/admin/pairing/new -> AdminState (a fresh 6-digit code and, when on, a fresh Easy Connect code)
// POST /api/admin/easy-connect -> AdminState (turn it on or off)
export interface EasyConnectToggleRequest {
  enabled: boolean;
}
// DELETE /api/admin/devices/:id -> 204 (unpair: its token stops working at once)
// GET /api/admin/events -> the same WebSocket events as /ws, plus:
export type AdminEvent = ServerEvent | { type: "admin.state"; state: AdminState };
