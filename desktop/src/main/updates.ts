// Kiwimake's own updates, for every desktop installer: the Windows installer (NSIS), the Mac app,
// the Linux AppImage and the .deb (docs/RELEASING.md, "Updates of the desktop app").
//
// Ghostex updates its native Mac app with Sparkle, its Windows app with Velopack and its AppImage
// with AppImageUpdate. Kiwimake is one Electron app, so it uses electron-updater, which does the same
// job for all four: it reads latest.yml (Windows), latest-mac.yml or latest-linux.yml from the newest
// GitHub release, downloads the file for this copy, checks its SHA-512 and, on Windows, that the
// installer is signed by the same publisher (the Certum certificate); on the Mac, Squirrel.Mac checks
// the new app is signed by the same Developer ID before it replaces this one.
//
// The person stays in control: the update downloads in the background (or only when they ask, with
// automatic updates off), and is installed only when they click "Restart to update". If an app is
// being made right then (an agent turn or a build), Kiwimake waits until it is done and restarts then.
//
// This file has no Electron import, so test/updates.test.ts drives it with a fake updater.
import type { UpdateKind, UpdateState } from "../shared/types.ts";

/** The part of electron-updater's AppUpdater this uses. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableDifferentialDownload: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  /**
   * Starts the installer and quits. An installer that cannot start emits "error" before this returns
   * (Windows and Linux); on the Mac, Squirrel.Mac emits "error" later if the new app is refused.
   */
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateHost {
  kind: UpdateKind;
  /** Why updates are off when kind is "none". */
  note?: string;
  version: string;
  /** What is running that an update must not interrupt, as a sentence; null when nothing is. */
  busy(): string | null;
  autoUpdates(): boolean;
  /** Stop the companion and let go of the one-copy lock, so the new copy can start. */
  prepareToQuit(): Promise<void>;
  /** Undo prepareToQuit after an install that did not start. */
  resume(): void;
  changed(state: UpdateState): void;
  log(line: string): void;
  now?: () => number;
}

export const FIRST_CHECK_MS = 30_000;
export const CHECK_EVERY_MS = 6 * 60 * 60_000;

/** Which updater fits this copy, or why there is none. Pure, for the tests. */
export function updateKind(o: {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** resources/app-update.yml exists (electron-builder writes it when "publish" is set). */
  hasUpdateConfig: boolean;
  /** ANYAPP_UPDATE_FEED: a stand-in feed for tests. */
  feedOverride?: string | undefined;
  /** The AppImage runtime sets APPIMAGE to the image's path. */
  appImage?: string | undefined;
  /** resources/package-type, written into the .deb by electron-builder. */
  packageType?: string | undefined;
}): { kind: UpdateKind; note?: string } {
  if (!o.packaged) return { kind: "none", note: "This copy runs from the source code, so it does not update itself." };
  if (!o.hasUpdateConfig && !o.feedOverride) return { kind: "none", note: "This copy was built without updates." };
  if (o.platform === "win32") return { kind: "windows" };
  if (o.platform === "darwin") return { kind: "mac" };
  if (o.platform === "linux") {
    // An AppImage may carry the .deb's package-type file too (electron-builder packs both from one
    // folder), so the AppImage runtime's APPIMAGE variable decides first.
    if (o.appImage) return { kind: "appimage" };
    if (o.packageType === "deb") return { kind: "deb" };
    return { kind: "none", note: "This copy was not installed from the AppImage or the .deb, so it does not update itself." };
  }
  return { kind: "none", note: "Kiwimake does not update itself on this system." };
}

/** electron-updater's error, as a sentence a person can act on. */
export function updateErrorText(error: unknown, kind: UpdateKind): string {
  const message = String((error as Error)?.message ?? error ?? "");
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR_|socket hang up|timeout/i.test(message)) return "Kiwimake could not reach the internet to look for an update.";
  if (/sha512 checksum mismatch|checksum/i.test(message)) return "The downloaded update was damaged, so Kiwimake threw it away. It tries again later.";
  if (/not signed by the application owner|publisherName|signature/i.test(message)) return "The downloaded update was not signed by Kiwimake, so it was not installed.";
  if (/code signature|designated requirement|did not pass validation/i.test(message)) return "The downloaded update was not signed by Kiwimake, so it was not installed.";
  if (kind === "deb" && /pkexec|dismissed|Not authorized|exit code 126|exit code 127|authentication/i.test(message)) return "The update needs your password to install. Try again and enter it when your PC asks.";
  if (/\b404\b|Cannot find latest|No published versions|HttpError: 4/i.test(message)) return "Kiwimake could not find its update information. It tries again later.";
  return `The update did not work: ${message.split("\n")[0].slice(0, 200)}`;
}

export class DesktopUpdates {
  state: UpdateState;
  private checking = false;
  private manual = false;
  /** A checked update is on disk (it stays there after an install that did not start). */
  private downloaded = false;
  private lastError: unknown;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly updater: UpdaterLike | null,
    private readonly host: UpdateHost,
  ) {
    this.state = updater && host.kind !== "none" ? { kind: host.kind, current: host.version, phase: "idle" } : { kind: "none", current: host.version, phase: "off", ...(host.note ? { note: host.note } : {}) };
    if (!updater || host.kind === "none") return;
    // Nothing happens by itself except the background download: never on quit, never a downgrade
    // or a prerelease, and always the whole file (the release has no blockmaps under stable names).
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableDifferentialDownload = true;
    updater.on("update-available", (info: { version: string }) => {
      this.host.log(`[update] ${info.version} is available (this is ${host.version}); downloading`);
      this.set({ phase: "downloading", version: info.version, percent: 0 });
      updater.downloadUpdate().catch((error) => this.fail(error));
    });
    updater.on("update-not-available", () => this.set({ phase: "latest", checkedAt: this.now() }));
    updater.on("download-progress", (p: { percent: number }) => {
      if (this.state.phase === "downloading") this.set({ percent: Math.round(p.percent) });
    });
    updater.on("update-downloaded", (info: { version: string }) => {
      this.host.log(`[update] ${info.version} downloaded and checked; waiting for the person to restart`);
      this.downloaded = true;
      this.set({ phase: "ready", version: info.version, percent: 100 });
    });
    updater.on("error", (error: unknown) => {
      this.lastError = error;
      this.host.log(`[update] error: ${String((error as Error)?.stack ?? error)}`);
      // The Mac's installer (Squirrel.Mac) fails after the companion stopped: start it again.
      if (this.state.phase === "installing") return this.recover(error);
      if (this.state.phase === "downloading" || this.manual) this.fail(error);
      else this.set({ phase: this.state.version && this.state.phase === "ready" ? "ready" : "idle" });
    });
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private set(patch: Partial<UpdateState>): void {
    const next: UpdateState = { ...this.state, ...patch };
    if (patch.phase && patch.phase !== "error") delete next.error;
    if (patch.phase && patch.phase !== "waiting") delete next.waitingFor;
    if (patch.phase && patch.phase !== "downloading" && patch.phase !== "ready") delete next.percent;
    this.state = next;
    this.host.changed(this.state);
  }

  private fail(error: unknown): void {
    this.set({ phase: "error", error: updateErrorText(error, this.state.kind), checkedAt: this.now() });
  }

  /** Look now and then every few hours, while automatic updates are on. */
  start(firstMs = FIRST_CHECK_MS): void {
    if (this.state.phase === "off") return;
    this.schedule(firstMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Automatic updates were turned on or off in Settings. */
  autoChanged(): void {
    this.stop();
    if (this.host.autoUpdates()) this.start();
  }

  private schedule(ms: number): void {
    this.stop();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.host.autoUpdates()) void this.check(false);
      this.schedule(CHECK_EVERY_MS);
    }, ms);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Look for a new version. A manual check also shows its errors; an automatic one stays quiet. */
  async check(manual = true): Promise<void> {
    if (!this.updater || this.state.phase === "off" || this.checking) return;
    // Already downloaded or downloading: nothing to look for until it is installed.
    if (["downloading", "ready", "waiting", "installing"].includes(this.state.phase) || this.downloaded) return;
    this.checking = true;
    this.manual = manual;
    this.set({ phase: "checking" });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      if (manual) this.fail(error);
      else this.set({ phase: "idle" });
    } finally {
      this.checking = false;
      if (this.state.phase === "checking") this.set({ phase: "idle", checkedAt: this.now() });
    }
  }

  /** The person clicked "Restart to update". */
  async restart(): Promise<void> {
    const retry = this.state.phase === "error" && this.downloaded;
    if (this.state.phase !== "ready" && this.state.phase !== "waiting" && !retry) return;
    const busy = this.host.busy();
    if (busy) {
      this.host.log(`[update] restart asked; waiting: ${busy}`);
      this.set({ phase: "waiting", waitingFor: busy });
      return;
    }
    await this.install();
  }

  /** The person no longer wants to restart when the work is done. */
  cancel(): void {
    if (this.state.phase === "waiting") this.set({ phase: "ready" });
  }

  /** Call whenever an app's state changes: a waiting restart goes ahead once nothing runs. */
  busyChanged(): void {
    if (this.state.phase !== "waiting") return;
    const busy = this.host.busy();
    if (busy) {
      if (busy !== this.state.waitingFor) this.set({ waitingFor: busy });
      return;
    }
    void this.install();
  }

  private async install(): Promise<void> {
    if (!this.updater) return;
    // Checked again right before stopping anything.
    const busy = this.host.busy();
    if (busy) {
      this.set({ phase: "waiting", waitingFor: busy });
      return;
    }
    this.host.log(`[update] installing ${this.state.version}`);
    this.set({ phase: "installing" });
    this.lastError = undefined;
    try {
      await this.host.prepareToQuit();
    } catch (error) {
      this.host.log(`[update] could not stop for the update: ${(error as Error).message}`);
    }
    // Windows starts the signed installer, the AppImage replaces its own file and starts the new
    // one, the .deb asks for the password (pkexec) and installs with dpkg, each then quits Kiwimake.
    // Squirrel.Mac quits once it has checked the new app. A failure arrives as an "error" event
    // while the phase is "installing", which starts the companion again (recover).
    try {
      this.updater.quitAndInstall(true, true);
    } catch (error) {
      this.recover(error);
    }
  }

  private recover(error: unknown): void {
    this.host.log("[update] the update did not start; Kiwimake keeps running");
    this.host.resume();
    this.set({ phase: "error", error: updateErrorText(error, this.state.kind) });
  }
}
