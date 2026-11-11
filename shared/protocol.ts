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
  error?: string; // short, human readable, set when failed
  // Added for smaller downloads: the same build as one APK per phone processor type (ABI), each
  // much smaller than the full APK (sizeBytes/sha256 above), which holds every ABI. Set when
  // succeeded and the PC built them; absent from older PCs and from apps without native code.
  variants?: ApkVariant[];
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
export type AppPreset = "react-native" | "kotlin";

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
  createdAt: string;
  updatedAt: string;
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
  | "stopped"; // a plain "Stopped" line where the person stopped a turn (main chat or a helper's chat)

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
  | { type: "worker.item"; item: ChatItem }; // upsert into the chat of worker item.workerId (never the main chat)

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
}

// POST /api/admin/pairing/new -> AdminState (a fresh 6-digit code and, when on, a fresh Easy Connect code)
// POST /api/admin/easy-connect -> AdminState (turn it on or off)
export interface EasyConnectToggleRequest {
  enabled: boolean;
}
// DELETE /api/admin/devices/:id -> 204 (unpair: its token stops working at once)
// GET /api/admin/events -> the same WebSocket events as /ws, plus:
export type AdminEvent = ServerEvent | { type: "admin.state"; state: AdminState };
