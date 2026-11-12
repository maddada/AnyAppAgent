// Types shared by the Electron main process, the preload bridge and the renderer.
// The companion's own wire types come from ../../../shared/protocol.ts (types only).
import type { AdminState, App, AppPreset, AppVersion, BackupRestoreResult, BackupState, CareState, ChatImage, ChatItem, ImageUpload, KeysRestoreResult, PageInfo, ReleaseStats, Suggestion, TodoItem, WorkerInfo } from "../../../shared/protocol.ts";

export type { AdminState, App, AppPreset, AppVersion, ChatImage, ChatItem, ImageUpload, PageInfo, TodoItem, WorkerInfo };

/** One self-check in the setup checklist. */
export type CheckState = "checking" | "done" | "needed" | "working" | "skipped" | "problem";

export interface ClaudeCheck {
  state: CheckState;
  /** Plain words for the user. */
  summary: string;
  email?: string;
  plan?: string; // "Max", "Pro", "API billing"
  signingIn?: boolean;
  loginUrl?: string; // the page the sign-in opened, for "Open the page again"
  error?: string;
}

export interface GitHubCheck {
  state: CheckState;
  summary: string;
  login?: string;
  /** Where gh came from: the PC's own install, or our tools folder (downloaded). */
  source?: "system" | "tools" | "none";
  flow?: {
    phase: "downloading" | "starting" | "code" | "waiting" | "finishing";
    code?: string; // one-time code, e.g. "ABCD-1234"
    url?: string; // https://github.com/login/device
    progress?: number; // 0..1 while downloading gh
  };
  error?: string;
}

export interface ToolPiece {
  id: "jdk" | "sdk" | "node" | "git" | "deps";
  label: string; // plain words: "Java kit", "Android kit", "Node.js", "Git"
  ok: boolean;
  /** Where it was found (shown only in the advanced corner). */
  path?: string;
  source?: "system" | "tools" | "none";
  missing?: string[]; // e.g. sdk packages that are missing
  version?: string;
}

export interface ToolsCheck {
  state: CheckState;
  summary: string;
  pieces: ToolPiece[];
  install?: {
    running: boolean;
    progress: number; // 0..1 overall
    label: string; // plain words: "Downloading the Android kit…"
    detail?: string; // "312 MB of 1.1 GB"
    error?: string;
  };
  /** JAVA_HOME / ANDROID_HOME / extra PATH entries handed to the companion. */
  env?: { JAVA_HOME?: string; ANDROID_HOME?: string; path: string[]; gitBash?: string };
}

export interface PhoneCheck {
  state: CheckState;
  summary: string;
  pairedCount: number;
  connectedCount: number;
}

/** One speech model Hex has ready. */
export interface HexModelView {
  id: string;
  name: string;
}

/** Hex (anoma.ly/hex), the free dictation app this PC can use to type by voice. Optional. */
export interface HexCheck {
  state: "checking" | "unsupported" | "notInstalled" | "notRunning" | "noModels" | "problem" | "ready";
  /** Plain words for the user. */
  summary: string;
  /** What Hex's local API says it runs. */
  version?: string;
  /** What is installed on disk (may be newer than the running one). */
  installedVersion?: string;
  /** The models Hex has ready, in Hex's order. */
  models: HexModelView[];
  /** The model dictation uses. */
  model?: string;
  install?: { running: boolean; line?: string; error?: string };
}

export interface Checks {
  claude: ClaudeCheck;
  github: GitHubCheck;
  tools: ToolsCheck;
  phone: PhoneCheck;
  hex: HexCheck;
}

export type CompanionPhase = "starting" | "running" | "restarting" | "stopped" | "failed";

export interface CompanionStatus {
  phase: CompanionPhase;
  /** Plain sentence for the user. */
  message: string;
  mode: "real" | "fake";
  port: number;
  pid?: number;
  restarts: number;
  /** True when the companion answers /api/admin/state (the admin routes exist). */
  adminRoutes: boolean;
  startedAt?: string;
}

export interface Settings {
  onboardingDone: boolean;
  githubSkipped: boolean;
  startWithWindows: boolean;
  closeHintShown: boolean;
  /** The Kiwimake phone APK to offer (empty: look in the usual places). */
  phoneApkPath: string;
  /** The Hex model dictation uses (empty: Hex's first ready model). */
  hexModel: string;
  /** The dictation step was skipped in the setup. */
  hexSkipped: boolean;
}

/** The phone app on this project's public GitHub release (always the newest release). */
export const PHONE_RELEASE_URL = "https://github.com/maddada/AnyAppAgent/releases/latest/download/AnyAppAgent.apk";

export interface PhoneRelease {
  url: string;
  qrSvg: string;
}

export interface PhoneDownload {
  available: boolean;
  url?: string;
  qrSvg?: string;
  sizeBytes?: number;
}

export interface PairingView {
  kind: "easy-connect" | "same-network" | "none";
  qrSvg?: string;
  code?: string; // the 6-digit code, "123 456"
  address?: string; // http://192.168.1.10:8787
  otherAddresses: string[];
  easyConnect: AdminState["easyConnect"]["state"];
  easyConnectError?: string;
  /** While Easy Connect starts: what it is doing now. */
  easyConnectDetail?: string;
  /** Easy Connect is on but its one-time code was used or expired. */
  needsNewCode?: boolean;
  /** anyappagent://pair?ec=<code>: the Easy Connect code as a link, for a phone that cannot scan. */
  easyConnectLink?: string;
}

export interface Snapshot {
  companion: CompanionStatus;
  admin: AdminState | null;
  pairing: PairingView;
  apps: App[];
  care: CareState | null; // the usage meter, the monthly reminder and the backup (docs/TRUST.md); null on older companions
  icons: Record<string, string>; // appId -> data URL
  checks: Checks;
  settings: Settings;
  advanced: {
    toolsDir: string;
    stateDir: string;
    appsDir: string;
    companionDir: string;
    logTail: string[];
  };
}

/** A chat action's answer: errors come back as a plain sentence. */
export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Back up or restore signing keys (docs/DISTRIBUTION.md): cancelled when the file dialog was closed. */
export type KeysAction =
  | { cancelled: true }
  | { ok: true; file: string; count?: number; restored?: KeysRestoreResult }
  | { ok: false; error: string };

/** "Never lose your apps" (docs/TRUST.md): cancelled when the folder dialog was closed. */
/** The Account page's actions (the PC link, cloud milestone 7). phones: how many connected phones were asked. */
export type AccountAction = { ok: true; phones?: number } | { ok: false; error: string };

export type BackupAction =
  | { cancelled: true }
  | { ok: true; state?: BackupState; restored?: BackupRestoreResult }
  | { ok: false; error: string };

/** What the preload bridge exposes as window.anyapp. */
export interface AnyAppBridge {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  onChatItem(listener: (item: ChatItem) => void): () => void;
  /** Helpers (docs/APP-COORDINATOR.md; the wire calls them workers): a helper started or changed. */
  onHelper(listener: (worker: WorkerInfo) => void): () => void;
  /** An item of a helper's own chat (item.workerId says whose). */
  onHelperItem(listener: (item: ChatItem) => void): () => void;
  onNavigate(listener: (where: "connect-phone" | "home") => void): () => void;
  /** An app's whole to-do list after a change (from the phone or this PC). */
  onTodos(listener: (appId: string, todos: TodoItem[]) => void): () => void;

  recheck(): Promise<void>;
  claudeSignIn(): Promise<void>;
  claudeCancel(): Promise<void>;
  /** The code the fallback sign-in page shows, pasted into the app. */
  claudeSubmitCode(code: string): Promise<void>;
  githubStart(): Promise<void>;
  githubOpenPage(): Promise<void>;
  githubCancel(): Promise<void>;
  githubSkip(skipped: boolean): Promise<void>;
  toolsInstall(): Promise<void>;
  toolsCancel(): Promise<void>;

  phoneDownload(): Promise<PhoneDownload>;
  /** The QR code for the phone app's GitHub release download. */
  phoneRelease(): Promise<PhoneRelease>;
  newPairingCode(): Promise<void>;
  setEasyConnect(enabled: boolean): Promise<void>;
  /** Turns Easy Connect on once when the phone step opens, if it is off. */
  easyConnectAuto(): Promise<void>;
  removeDevice(id: string): Promise<void>;
  /** Asks where to save, then writes every signing key there, encrypted with `password`. */
  backupKeys(password: string): Promise<KeysAction>;
  /** Turns backups on: asks for the folder, then the companion makes the recovery key from the password and backs up. */
  backupOn(password: string): Promise<BackupAction>;
  backupOff(): Promise<BackupAction>;
  /** The PC link: starts the browser sign-in and opens its page. */
  accountSignIn(): Promise<AccountAction>;
  accountOpenPage(): Promise<void>;
  accountCancel(): Promise<AccountAction>;
  accountUnlink(): Promise<AccountAction>;
  /** Asks the connected, signed-in phones to link this PC (they show a notice). */
  accountAskPhone(): Promise<AccountAction>;
  backupRun(): Promise<BackupAction>;
  /** On a new PC: asks for the backup folder, then restores everything in it. */
  backupRestore(password: string): Promise<BackupAction>;
  /** Puts the monthly health reminder away for a month. */
  dismissReminder(): Promise<ActionResult>;
  /** "Update it" on an app that is behind the newest template. */
  keepHealthy(appId: string): Promise<ActionResult>;
  /** Asks for a backup file, then adds the keys in it that this PC does not have. */
  restoreKeys(password: string): Promise<KeysAction>;

  /** Hex: run its installer, open it, look again, and transcribe a 16 kHz mono WAV recording. */
  hexInstall(): Promise<void>;
  hexOpen(): Promise<{ ok: boolean; error?: string }>;
  hexCheck(): Promise<void>;
  hexTranscribe(wav: ArrayBuffer): Promise<{ ok: boolean; text?: string; error?: string; code?: string }>;

  getMessages(appId: string): Promise<ChatItem[]>;
  getHelpers(appId: string): Promise<WorkerInfo[]>;
  getHelperMessages(appId: string, workerId: string): Promise<ChatItem[]>;
  stopHelper(appId: string, workerId: string): Promise<ActionResult>;
  sendMessage(appId: string, text: string, images?: ImageUpload[]): Promise<ActionResult>;
  /** A picture sent in a chat, as a data URL (undefined when it is gone). */
  getImage(appId: string, imageId: string): Promise<string | undefined>;
  /** Stop: ends the agent's current turn; messages waiting behind it are not sent. */
  cancelTurn(appId: string): Promise<ActionResult>;
  /** Builds the app again (Try again on a failed build). */
  rebuild(appId: string): Promise<ActionResult>;
  /** "Share with others" on or off (docs/DISTRIBUTION.md): a public releases-only repo. */
  shareApp(appId: string, shared: boolean): Promise<ActionResult & { app?: App }>;
  /** Publishes the newest build as a version for the people the app is shared with. */
  publishApp(appId: string, notes: string, channel: "stable" | "testing"): Promise<ActionResult & { app?: App }>;
  /** Stops offering a published version. */
  pullBack(appId: string, build: number): Promise<ActionResult & { app?: App }>;
  /** Downloads per published version, from GitHub. */
  releaseStats(appId: string): Promise<ActionResult & { stats: ReleaseStats[] }>;
  // "Change this app" (docs/CHANGE-THIS-APP.md)
  /** The app's "From others" inbox, newest first. */
  getSuggestions(appId: string): Promise<ActionResult & { suggestions: Suggestion[] }>;
  /** Files a pasted suggestion message under its app; appId says which. */
  fileSuggestion(text: string): Promise<ActionResult & { appId?: string }>;
  openSuggestion(appId: string, suggestionId: string): Promise<ActionResult>;
  removeSuggestion(appId: string, suggestionId: string): Promise<ActionResult>;
  /** "Show Change this app to others", and the name every app shows for its owner. */
  setChange(appId: string, body: { showToOthers?: boolean; ownerName?: string }): Promise<ActionResult & { app?: App }>;
  getOwnerName(): Promise<string>;
  /** A QR code (SVG) for a link. */
  qr(text: string): Promise<string>;
  answerPermission(appId: string, requestId: string, optionId: string): Promise<ActionResult>;
  /** Versions of an app, newest first (docs/VERSIONS.md). */
  getVersions(appId: string): Promise<AppVersion[]>;
  /** Builds an earlier version again as a new version. */
  restoreVersion(appId: string, build: number): Promise<ActionResult>;
  /** Goes back to the version before the newest one. */
  undoChange(appId: string): Promise<ActionResult>;
  /** "Fix it" on a crash card. */
  fixCrash(appId: string, crashId: string): Promise<ActionResult>;
  /** The person's own to-do list for an app (the agent never sees it). */
  getTodos(appId: string): Promise<TodoItem[]>;
  addTodo(appId: string, text: string): Promise<ActionResult>;
  setTodoDone(appId: string, todoId: string, done: boolean): Promise<ActionResult>;
  removeTodo(appId: string, todoId: string): Promise<ActionResult>;
  /** Sends the item's text to the app's chat as a message, then ticks it off. */
  sendTodo(appId: string, todoId: string): Promise<ActionResult>;
  /** New app from this PC: the same as the phone's New app sheet (preset: Advanced, default React Native). */
  /** askMore: "Ask me more", the agent asks the person questions about the app before it plans it. */
  createApp(name: string, prompt: string, preset?: AppPreset, askMore?: boolean): Promise<ActionResult & { app?: App }>;
  /** Opens a page an app's agent published, in its own window over the app. */
  openPage(appId: string, pageId: string, title?: string): Promise<ActionResult>;

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  restartCompanion(): Promise<void>;
  /** Quits the app and stops the companion (same as Quit in the tray menu). */
  quit(): Promise<void>;
  copyText(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openFolder(which: "tools" | "state" | "apps"): Promise<void>;
}
