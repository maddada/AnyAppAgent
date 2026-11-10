// Types shared by the Electron main process, the preload bridge and the renderer.
// The companion's own wire types come from ../../../shared/protocol.ts (types only).
import type { AdminState, App, ChatItem } from "../../../shared/protocol.ts";

export type { AdminState, App, ChatItem };

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
  id: "jdk" | "sdk" | "node" | "git";
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

export interface Checks {
  claude: ClaudeCheck;
  github: GitHubCheck;
  tools: ToolsCheck;
  phone: PhoneCheck;
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
  /** The AnyAppAgent phone APK to offer (empty: look in the usual places). */
  phoneApkPath: string;
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
}

export interface Snapshot {
  companion: CompanionStatus;
  admin: AdminState | null;
  pairing: PairingView;
  apps: App[];
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

/** What the preload bridge exposes as window.anyapp. */
export interface AnyAppBridge {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  onChatItem(listener: (item: ChatItem) => void): () => void;
  onNavigate(listener: (where: "connect-phone" | "home") => void): () => void;

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
  newPairingCode(): Promise<void>;
  setEasyConnect(enabled: boolean): Promise<void>;
  /** Turns Easy Connect on once when the phone step opens, if it is off. */
  easyConnectAuto(): Promise<void>;
  removeDevice(id: string): Promise<void>;

  getMessages(appId: string): Promise<ChatItem[]>;
  sendMessage(appId: string, text: string): Promise<{ ok: boolean; error?: string }>;

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  restartCompanion(): Promise<void>;
  copyText(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openFolder(which: "tools" | "state" | "apps"): Promise<void>;
}
