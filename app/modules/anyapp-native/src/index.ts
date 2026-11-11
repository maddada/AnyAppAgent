import { NativeModule, requireOptionalNativeModule } from "expo";

export interface PackageInfo {
  packageName: string;
  /** The version the app shows: its APK's, or a newer quick update it runs (docs/FAST-LANE.md). */
  versionCode: number;
  /** The installed APK's own versionCode (missing on builds before the fast lane). */
  apkVersionCode?: number;
  versionName: string | null;
  installer: string | null;
  launchable: boolean;
}

export type InstallStatus =
  | "success"
  | "cancelled"
  | "conflict" // signed differently from the app already on the phone
  | "incompatible"
  | "storage"
  | "blocked"
  | "invalid"
  | "timeout" // Android gave no final answer in time; the session was abandoned
  | "failed";

export interface InstallResult {
  status: InstallStatus;
  message: string | null;
  packageName: string | null;
}

export interface InstallStatusEvent {
  sessionId: number;
  status: InstallStatus | "pendingUserAction";
  message?: string | null;
  packageName?: string | null;
}

type Events = {
  onInstallStatus: (event: InstallStatusEvent) => void;
  /** The phone's network changed (debounced 750 ms). */
  onNetworkChanged: () => void;
  /** An app made with AnyAppAgent crashed (docs/VERSIONS.md): takeWaitingCrashes() has its report. */
  onAppCrash: (event: { packageName: string }) => void;
  /** An app answered requestDiary: `diary` is a JSON array of { at, text }. */
  onAppDiary: (event: { packageName: string; requestId: string; diary: string }) => void;
  /** An app reported the version it runs, or a quick update it refused or rolled back. */
  onAppReport: (event: { packageName: string }) => void;
};

declare class AnyAppNativeModule extends NativeModule<Events> {
  getPackageInfo(packageName: string): PackageInfo | null;
  getPackagesInfo(packageNames: string[]): Record<string, PackageInfo | null>;
  launch(packageName: string): boolean;
  /** A light haptic tick (long press). Optional: an older native build has none. */
  haptic?(): boolean;
  openAppSettings(packageName: string): boolean;
  requestUninstall(packageName: string): boolean;
  canInstallPackages(): boolean;
  openInstallPermissionSettings(): boolean;
  sha256File(path: string): Promise<string>;
  /** `answerWithinMs`: abandon the session and resolve "timeout" when Android has not answered by then. */
  install(path: string, answerWithinMs: number): Promise<InstallResult>;
  /** Shows Android's install prompt again for an install still waiting for the person; true when one opened. */
  reopenInstallPrompt?(): boolean;
  /** Build.SUPPORTED_ABIS, best first ("arm64-v8a", ...). Missing on builds before it was added. */
  supportedAbis?(): string[];
  /** Apps followed from a share link: AnyAppAgent handles their updates (docs/DISTRIBUTION.md stage 5). */
  setFollowedApps?(packageNames: string[]): void;
  /** The person's own apps (this PC's list): their "Change this app" row always shows (docs/CHANGE-THIS-APP.md). */
  setOwnApps?(packageNames: string[]): void;
  handlesUpdatesOf?(packageName: string): boolean;
  installWithIntent(path: string): boolean;

  // The fast lane (docs/FAST-LANE.md). Optional: builds before it have none.
  /** Hands an app a quick update ("ota", the file at `path`) or tells it an APK is ready ("apk"). */
  setAppReady?(packageName: string, kind: "ota" | "apk", build: number, path: string | null): Promise<boolean>;
  clearAppReady?(packageName: string): void;
  /** Opens the app again the moment its next install succeeds (natively, while AnyAppAgent is on screen). */
  reopenAfterInstall?(packageName: string): boolean;
  /** True while the app is on screen (it says so; apps made before the fast lane never do). */
  appInFront?(packageName: string): boolean;
  /** The app's native fingerprint, "" when it cannot take quick updates. */
  appRuntime?(packageName: string): string;
  appUpdateReport?(packageName: string): { running: number; bad: number[] };
  notificationsEnabled(): boolean;
  openNotificationSettings(): boolean;
  /** `color`: the accent from the shared theme tokens (the small icon's tint). */
  notify(id: number, title: string, body: string, url: string | null, color: string | null): boolean;
  cancelNotification(id: number): void;
  /** JSON [{ packageName, report }] of crashes waiting to go to the PC (forgotten once read). Missing on older builds. */
  takeWaitingCrashes?(): string;
  /** Asks an app for its diary (answer: onAppDiary); false when the app is not on this phone. */
  requestDiary?(packageName: string, requestId: string): boolean;
  /** Starts the keep-alive foreground service (only allowed in front), or changes its text when it runs. */
  startKeepAlive(text: string, color: string | null): boolean;
  /** True while the keep-alive service runs in the foreground: this process is not frozen. */
  keepAliveRunning?(): boolean;
  stopKeepAlive(): void;

  // Easy Connect (docs/EASY-CONNECT.md 4.2)
  easyConnectClientKey(): Promise<string>; // "nodekey:<64 hex>"
  /** Opens (or reuses after probing) the tunnel; blocks up to ~20 s on a cold start. */
  easyConnectStart(address: string, port: number): Promise<{ localPort: number }>;
  easyConnectStop(): Promise<void>;
  /** '{"path":"relay"|"direct","route":"lan"|"internet",...}' or "". */
  easyConnectPath(): string;
  easyConnectAvailable(): boolean;
}

/** Null when the native side is missing (web, Expo Go): callers degrade gracefully. */
export const AnyAppNative = requireOptionalNativeModule<AnyAppNativeModule>("AnyAppNative");
