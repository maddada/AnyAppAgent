// Kiwimake's own updates (src/main/updates.ts) with a fake electron-updater: when it looks, that it
// installs only after a click, never while an app is being made, and that a failed install leaves
// Kiwimake running.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_EVERY_MS, DesktopUpdates, FIRST_CHECK_MS, updateErrorText, updateKind, type UpdateHost, type UpdaterLike } from "../src/main/updates.ts";
import { updateWords } from "../src/renderer/src/updateWords.ts";
import type { UpdateKind, UpdateState } from "../src/shared/types.ts";

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  disableDifferentialDownload = false;
  checks = 0;
  downloads = 0;
  installs: [boolean | undefined, boolean | undefined][] = [];
  /** What the next check finds: a version, nothing, or an error. */
  next: string | null | Error = null;
  /** What quitAndInstall does: start (quit) or fail the way BaseUpdater does (an "error" event). */
  installFails: Error | null = null;
  async checkForUpdates(): Promise<unknown> {
    this.checks++;
    const next = this.next;
    if (next instanceof Error) {
      this.emit("error", next);
      throw next;
    }
    if (next) this.emit("update-available", { version: next });
    else this.emit("update-not-available", {});
    return {};
  }
  async downloadUpdate(): Promise<unknown> {
    this.downloads++;
    this.emit("download-progress", { percent: 50.4 });
    this.emit("update-downloaded", { version: this.next });
    return [];
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter]);
    if (this.installFails) this.emit("error", this.installFails);
  }
}

function makeHost(kind: UpdateKind = "appimage") {
  const calls: string[] = [];
  const states: UpdateState[] = [];
  let busy: string | null = null;
  let auto = true;
  const host: UpdateHost = {
    kind,
    version: "0.4.0",
    busy: () => busy,
    autoUpdates: () => auto,
    prepareToQuit: async () => {
      calls.push("prepare");
    },
    resume: () => calls.push("resume"),
    changed: (s) => states.push(s),
    log: () => {},
    now: () => 1000,
  };
  return {
    host,
    calls,
    states,
    setBusy: (b: string | null) => (busy = b),
    setAuto: (a: boolean) => (auto = a),
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe("updateKind", () => {
  const base = { packaged: true, hasUpdateConfig: true } as const;
  it("picks the updater for each installer", () => {
    expect(updateKind({ ...base, platform: "win32" }).kind).toBe("windows");
    expect(updateKind({ ...base, platform: "darwin" }).kind).toBe("mac");
    expect(updateKind({ ...base, platform: "linux", appImage: "/home/me/Kiwimake-x86_64.AppImage" }).kind).toBe("appimage");
    expect(updateKind({ ...base, platform: "linux", packageType: "deb" }).kind).toBe("deb");
    // An AppImage can carry the .deb's package-type file (electron-builder packs both from one folder).
    expect(updateKind({ ...base, platform: "linux", packageType: "deb", appImage: "/x.AppImage" }).kind).toBe("appimage");
  });
  it("turns updates off where they cannot work", () => {
    expect(updateKind({ platform: "linux", packaged: false, hasUpdateConfig: true }).kind).toBe("none");
    expect(updateKind({ platform: "win32", packaged: true, hasUpdateConfig: false }).kind).toBe("none");
    expect(updateKind({ platform: "win32", packaged: true, hasUpdateConfig: false, feedOverride: "http://127.0.0.1:1/" }).kind).toBe("windows");
    const loose = updateKind({ ...base, platform: "linux" });
    expect(loose.kind).toBe("none");
    expect(loose.note).toMatch(/AppImage or the \.deb/);
  });
});

describe("DesktopUpdates", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
  afterEach(() => vi.useRealTimers());

  it("never installs by itself, never downgrades, never takes a prerelease", () => {
    const u = new FakeUpdater();
    new DesktopUpdates(u, makeHost().host);
    expect([u.autoDownload, u.autoInstallOnAppQuit, u.allowPrerelease, u.allowDowngrade, u.disableDifferentialDownload]).toEqual([false, false, false, false, true]);
  });

  it("is off, and touches no updater, in a copy that cannot update", async () => {
    const h = makeHost("none");
    const d = new DesktopUpdates(null, { ...h.host, note: "This copy runs from the source code, so it does not update itself." });
    expect(d.state.phase).toBe("off");
    d.start();
    await d.check();
    expect(d.state.phase).toBe("off");
    expect(updateWords(d.state)?.status).toMatch(/source code/);
  });

  it("looks 30 seconds after the start and then every 6 hours, only while automatic updates are on", async () => {
    const u = new FakeUpdater();
    const h = makeHost();
    const d = new DesktopUpdates(u, h.host);
    d.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS - 1);
    expect(u.checks).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(u.checks).toBe(1);
    expect(d.state.phase).toBe("latest");
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(u.checks).toBe(2);
    h.setAuto(false);
    d.autoChanged();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(u.checks).toBe(2);
    // Check now still works with automatic updates off.
    await d.check(true);
    expect(u.checks).toBe(3);
    d.stop();
  });

  it("downloads a new version, then waits for the click", async () => {
    const u = new FakeUpdater();
    const h = makeHost();
    const d = new DesktopUpdates(u, h.host);
    u.next = "0.5.0";
    await d.check(false);
    await flush();
    expect(u.downloads).toBe(1);
    expect(d.state).toMatchObject({ phase: "ready", version: "0.5.0" });
    expect(h.states.some((s) => s.phase === "downloading" && s.percent === 50)).toBe(true);
    expect(u.installs).toEqual([]);
    expect(h.calls).toEqual([]);
    // Nothing more to look for until it is installed.
    await d.check(true);
    expect(u.checks).toBe(1);
    expect(updateWords(d.state)?.title).toBe("Kiwimake 0.5.0 is ready");
  });

  it("restarts into the update when nothing is running: companion stopped first, then the installer", async () => {
    const u = new FakeUpdater();
    const h = makeHost();
    const d = new DesktopUpdates(u, h.host);
    u.next = "0.5.0";
    await d.check(false);
    await flush();
    await d.restart();
    expect(h.calls).toEqual(["prepare"]);
    expect(u.installs).toEqual([[true, true]]);
    expect(d.state.phase).toBe("installing");
  });

  it("waits while an app is being made, and goes ahead when it is done", async () => {
    const u = new FakeUpdater();
    const h = makeHost();
    const d = new DesktopUpdates(u, h.host);
    u.next = "0.5.0";
    await d.check(false);
    await flush();
    h.setBusy("Prayer Times is being changed");
    await d.restart();
    expect(d.state).toMatchObject({ phase: "waiting", waitingFor: "Prayer Times is being changed" });
    expect(h.calls).toEqual([]);
    h.setBusy("Prayer Times is being built");
    d.busyChanged();
    expect(d.state.waitingFor).toBe("Prayer Times is being built");
    expect(updateWords(d.state)?.body).toMatch(/as soon as this is done: Prayer Times is being built/);
    expect(u.installs).toEqual([]);
    h.setBusy(null);
    d.busyChanged();
    await flush();
    expect(h.calls).toEqual(["prepare"]);
    expect(u.installs.length).toBe(1);
  });

  it("stops waiting when the person says so", async () => {
    const u = new FakeUpdater();
    const h = makeHost();
    const d = new DesktopUpdates(u, h.host);
    u.next = "0.5.0";
    await d.check(false);
    await flush();
    h.setBusy("Notes is being built");
    await d.restart();
    d.cancel();
    expect(d.state.phase).toBe("ready");
    h.setBusy(null);
    d.busyChanged();
    await flush();
    expect(u.installs).toEqual([]);
  });

  it("keeps Kiwimake running when the installer does not start, and can try again", async () => {
    const u = new FakeUpdater();
    const h = makeHost("deb");
    const d = new DesktopUpdates(u, h.host);
    u.next = "0.5.0";
    await d.check(false);
    await flush();
    u.installFails = new Error("Command failed: pkexec --disable-internal-agent /bin/bash -c 'dpkg -i x.deb' (exit code 126)");
    await d.restart();
    expect(h.calls).toEqual(["prepare", "resume"]);
    expect(d.state.phase).toBe("error");
    expect(d.state.error).toMatch(/needs your password/);
    expect(updateWords(d.state)?.title).toBe("Kiwimake 0.5.0 did not install");
    u.installFails = null;
    await d.restart();
    expect(h.calls).toEqual(["prepare", "resume", "prepare"]);
    expect(u.installs.length).toBe(2);
  });

  it("starts the companion again when Squirrel.Mac refuses the new app after the restart began", async () => {
    const u = new FakeUpdater();
    const h = makeHost("mac");
    const d = new DesktopUpdates(u, h.host);
    u.next = "0.5.0";
    await d.check(false);
    await flush();
    await d.restart();
    expect(d.state.phase).toBe("installing");
    u.emit("error", new Error("Code signature at URL file:///x did not pass validation: code failed to satisfy specified code requirement(s)"));
    expect(h.calls).toEqual(["prepare", "resume"]);
    expect(d.state.error).toMatch(/not signed by Kiwimake/);
  });

  it("stays quiet when an automatic check fails, and says so for Check now", async () => {
    const u = new FakeUpdater();
    const h = makeHost();
    const d = new DesktopUpdates(u, h.host);
    u.next = new Error("getaddrinfo ENOTFOUND github.com");
    await d.check(false);
    expect(d.state.phase).toBe("idle");
    await d.check(true);
    expect(d.state.phase).toBe("error");
    expect(d.state.error).toBe("Kiwimake could not reach the internet to look for an update.");
  });

  it("throws away a damaged download", () => {
    expect(updateErrorText(new Error("sha512 checksum mismatch, expected abc, got def"), "appimage")).toMatch(/damaged/);
    expect(updateErrorText(new Error("New version 0.5.0 is not signed by the application owner: publisherNames: X"), "windows")).toMatch(/not signed by Kiwimake/);
  });
});
