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
}

export interface App {
  id: string;
  name: string; // what the user typed, shown under the icon
  slug: string;
  packageName: string; // Android application id, e.g. com.anyapp.prayeralarm
  status: AppStatus;
  error?: string;
  iconVersion: number; // bumps whenever the icon file changes (cache key for GET /icon)
  latestBuild?: BuildInfo; // newest build of any status
  latestApk?: BuildInfo; // newest succeeded build: what GET /apk serves
  repoUrl?: string; // GitHub repository, when one was created
  lastMessagePreview?: string;
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
  | "error"; // something failed outside the agent's own text

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
  seq: number; // strictly increasing per app, orders the timeline
  kind: ChatItemKind;
  text?: string; // user, assistant, thought, error
  streaming?: boolean; // true while text is still growing
  tool?: ToolCallInfo;
  plan?: PlanEntry[];
  permission?: PermissionInfo;
  build?: BuildInfo;
  createdAt: string;
  updatedAt: string;
}

// ---------- HTTP (JSON). Everything except /api/health and /api/pair needs
// `Authorization: Bearer <token>`. Errors: non-2xx with ErrorBody.

export interface ErrorBody {
  error: string; // plain sentence the app can show
}

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

// GET /api/apps -> App[]
// GET /api/apps/:id -> App
// DELETE /api/apps/:id -> 204 (removes the app from the list; keeps files and repo on the PC)

// POST /api/apps -> App (returns at once with status "creating"; progress arrives over the socket)
export interface CreateAppRequest {
  name: string;
  prompt: string; // what the app should do: becomes the first message to the agent
}

// GET /api/apps/:id/icon -> image/png (the app's launcher icon; a generated placeholder until it has one)
// GET /api/apps/:id/apk -> application/vnd.android.package-archive (latestApk; supports Range; 404 if none)

// GET /api/apps/:id/messages?afterSeq=<n> -> ChatItem[] ordered by seq
// POST /api/apps/:id/messages -> 202 (the user's ChatItem arrives over the socket)
export interface SendMessageRequest {
  text: string;
}

// POST /api/apps/:id/cancel -> 202 (stops the agent's current turn)
// POST /api/apps/:id/build -> 202 (builds again without a new prompt)
// POST /api/apps/:id/permission -> 202
export interface PermissionAnswerRequest {
  requestId: string;
  optionId: string;
}

// ---------- WebSocket: GET /ws?token=<token>. Server to app only; JSON text frames.

export type ServerEvent =
  | { type: "hello"; serverName: string; protocol: 1 }
  | { type: "app.updated"; app: App } // also sent for a new app
  | { type: "app.deleted"; appId: string }
  | { type: "chat.item"; item: ChatItem } // upsert by item.id
  | { type: "apk.ready"; app: App }; // a new APK can be downloaded and installed now
