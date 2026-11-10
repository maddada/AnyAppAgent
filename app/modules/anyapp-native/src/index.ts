import { NativeModule, requireOptionalNativeModule } from "expo";

export interface PackageInfo {
  packageName: string;
  versionCode: number;
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
};

declare class AnyAppNativeModule extends NativeModule<Events> {
  getPackageInfo(packageName: string): PackageInfo | null;
  getPackagesInfo(packageNames: string[]): Record<string, PackageInfo | null>;
  launch(packageName: string): boolean;
  openAppSettings(packageName: string): boolean;
  requestUninstall(packageName: string): boolean;
  canInstallPackages(): boolean;
  openInstallPermissionSettings(): boolean;
  sha256File(path: string): Promise<string>;
  install(path: string): Promise<InstallResult>;
  installWithIntent(path: string): boolean;
  notificationsEnabled(): boolean;
  openNotificationSettings(): boolean;
  notify(id: number, title: string, body: string, url: string | null): boolean;
  cancelNotification(id: number): void;
  startKeepAlive(text: string): boolean;
  stopKeepAlive(): void;
}

/** Null when the native side is missing (web, Expo Go): callers degrade gracefully. */
export const AnyAppNative = requireOptionalNativeModule<AnyAppNativeModule>("AnyAppNative");
