// Versions and undo, What changed, crash reports and the diary (docs/VERSIONS.md), with a stand-in builder.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, ServerEvent } from "../../shared/protocol.ts";
import { AppManager, cleanCrashReport, HttpError } from "../src/apps.ts";
import type { Builder } from "../src/builder.ts";
import type { Config } from "../src/config.ts";
import { cleanDiary, crashFixPrompt, notesFrom } from "../src/history.ts";
import { Store } from "../src/store.ts";

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
}

function setup(opts: { failBuild?: () => boolean } = {}) {
  const state = mkdtempSync(join(tmpdir(), "anyapp-history-"));
  const dir = join(state, "apps", "tea");
  mkdirSync(dir, { recursive: true });
  gitIn(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "screen.txt"), "v1 green");
  writeFileSync(join(dir, "APP_MEMORY.md"), "memory 1");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "Build 1: First version");
  writeFileSync(join(dir, "screen.txt"), "v2 blue");
  writeFileSync(join(dir, "extra.txt"), "added in v2");
  writeFileSync(join(dir, "APP_MEMORY.md"), "memory 2");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "Build 2: Blue screen");
  const now = new Date().toISOString();
  const app: App = {
    id: "app-1",
    name: "Tea Timer",
    slug: "tea",
    packageName: "com.anyapp.tea",
    status: "idle",
    iconVersion: 1,
    latestBuild: { number: 2, status: "succeeded", startedAt: now, finishedAt: now },
    latestApk: { number: 2, status: "succeeded", startedAt: now, finishedAt: now },
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(join(state, "apps.json"), JSON.stringify([{ app, dir, ready: true }]));
  const apk = join(state, "fake.apk");
  writeFileSync(apk, "apk");
  const builds: number[] = [];
  const builder: Builder = {
    kind: "fake",
    createApp: async () => {},
    buildApk: async ({ buildNumber }) => {
      builds.push(buildNumber);
      if (opts.failBuild?.()) throw new Error(`Build #${buildNumber} failed. broken`);
      return { apkPath: apk, sizeBytes: 3, sha256: "abc" };
    },
    getIconPath: () => null,
  };
  const events: ServerEvent[] = [];
  const config = { stateDir: state, appsDir: join(state, "apps"), github: false, maxBuildFixes: 3, coordinator: false, port: 1 } as Config;
  let phones = 1;
  const apps = new AppManager({ store: new Store(state), builder, config, broadcast: (e) => events.push(e), log: () => {}, phonesConnected: () => phones });
  const idle = async () => {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const a = apps.get("app-1");
      if (a.status !== "building" && a.status !== "working" && !a.replying) return;
    }
    throw new Error("never idle");
  };
  return { apps, dir, events, builds, idle, setPhones: (n: number) => (phones = n), done: () => rmSync(state, { recursive: true, force: true }) };
}

describe("versions and undo", () => {
  it("lists older builds from Git, goes back as a new version and undoes it", async () => {
    const { apps, dir, idle, done } = setup();
    try {
      const before = await apps.versions("app-1");
      expect(before.map((v) => [v.build, v.current, v.canRestore])).toEqual([
        [2, true, false],
        [1, false, true],
      ]);
      expect(before[1].title).toBe("First version");

      await apps.restore("app-1", 1);
      await idle();
      expect(readFileSync(join(dir, "screen.txt"), "utf8")).toBe("v1 green");
      expect(() => readFileSync(join(dir, "extra.txt"))).toThrow();
      // The notes about the person are kept as they are now.
      expect(readFileSync(join(dir, "APP_MEMORY.md"), "utf8")).toBe("memory 2");
      const app = apps.get("app-1");
      expect(app.latestApk?.number).toBe(3);
      expect(app.latestApk?.restoredFrom).toBe(1);
      expect(app.latestApk?.changes?.changed).toMatch(/^Back to version 1, as it was on .+: First version$/);
      // History is never rewritten: the go-back is one more commit.
      expect(gitIn(dir, "log", "--format=%s").trim().split("\n")[0]).toBe("Back to version 1");

      const after = await apps.versions("app-1");
      expect(after.map((v) => v.build)).toEqual([3, 2, 1]);
      expect(after[0]).toMatchObject({ current: true, restoredFrom: 1 });

      await apps.undo("app-1");
      await idle();
      expect(readFileSync(join(dir, "screen.txt"), "utf8")).toBe("v2 blue");
      expect(readFileSync(join(dir, "extra.txt"), "utf8")).toBe("added in v2");
      expect(apps.get("app-1").latestApk).toMatchObject({ number: 4, restoredFrom: 2 });
    } finally {
      done();
    }
  });

  it("says a build of the same code changed nothing", async () => {
    const { apps, idle, done } = setup();
    try {
      await apps.restore("app-1", 1);
      await idle();
      apps.rebuild("app-1");
      await idle();
      expect(apps.get("app-1").latestApk).toMatchObject({ number: 4, changes: { changed: "Built again, nothing changed in the app." } });
    } finally {
      done();
    }
  });

  it("refuses the newest version, an unknown one, and a busy app", async () => {
    const { apps, idle, done } = setup();
    try {
      await expect(apps.restore("app-1", 2)).rejects.toThrow(HttpError);
      await expect(apps.restore("app-1", 9)).rejects.toMatchObject({ status: 404 });
      await apps.restore("app-1", 1);
      await expect(apps.restore("app-1", 1)).rejects.toMatchObject({ status: 409 });
      await idle();
    } finally {
      done();
    }
  });

  it("puts the files back when the old version does not build, without asking the agent", async () => {
    const { apps, dir, idle, builds, done } = setup({ failBuild: () => true });
    try {
      await apps.restore("app-1", 1);
      await idle();
      expect(builds).toEqual([3]);
      expect(readFileSync(join(dir, "screen.txt"), "utf8")).toBe("v2 blue");
      expect(apps.get("app-1").latestApk?.number).toBe(2);
      expect(apps.get("app-1").latestBuild?.error).toMatch(/did not build again/);
    } finally {
      done();
    }
  });
});

describe("what changed", () => {
  it("takes the agent's notes, cleaned", () => {
    expect(notesFrom({ changed: `  The timer ${String.fromCharCode(0x2014)} now rings  `, try_it: "Start one", good_to_know: "" })).toEqual({ changed: "The timer, now rings", tryIt: "Start one" });
    expect(notesFrom({ try_it: "x" })).toBeNull();
  });
});

describe("crash catcher", () => {
  it("adds one card per crash and counts repeats", () => {
    const { apps, done } = setup();
    try {
      const report = { kind: "crash", message: "TypeError: undefined is not a function", stack: "at x", at: new Date().toISOString(), versionCode: 2, diary: [{ at: "t", text: "Timer started" }] };
      const first = apps.reportCrash("app-1", report);
      const again = apps.reportCrash("app-1", { ...report, versionCode: 2 });
      expect(again.id).toBe(first.id);
      expect(again.count).toBe(2);
      const cards = apps.messages("app-1", 0).filter((i) => i.kind === "crash");
      expect(cards).toHaveLength(1);
      expect(cards[0].crash).toMatchObject({ count: 2, message: report.message });
      expect(() => apps.reportCrash("app-1", { kind: "crash" })).toThrow(HttpError);
      expect(() => apps.fixCrash("app-1", "00000000-0000-0000-0000-000000000000")).toThrow(HttpError);
    } finally {
      done();
    }
  });

  it("gives the agent the whole report", () => {
    const report = cleanCrashReport({ kind: "error", message: "RangeError: bad", stack: "s".repeat(20000), screen: "Home", at: "2026-11-11T10:00:00Z", diary: [{ at: "a", text: "Alarm set" }, { bad: 1 }] })!;
    expect(report.stack).toHaveLength(16 * 1024);
    expect(report.diary).toEqual([{ at: "a", text: "Alarm set" }]);
    const prompt = crashFixPrompt("Tea Timer", report);
    expect(prompt).toContain('<crash-report app="Tea Timer">');
    expect(prompt).toContain("Screen: Home");
    expect(prompt).toContain("a  Alarm set");
  });
});

describe("the diary", () => {
  it("asks the phone and hands the agent what it answered", async () => {
    const { apps, events, done } = setup();
    try {
      const reading = apps.history.readDiary("app-1");
      const ask = events.find((e) => e.type === "diary.request");
      expect(ask).toMatchObject({ appId: "app-1", packageName: "com.anyapp.tea" });
      apps.diaryAnswer("app-1", { requestId: (ask as { requestId: string }).requestId, entries: [{ at: "2026-11-11T15:42:00Z", text: "Asr alarm set for 15:42" }] });
      const text = await reading;
      expect(text).toContain("Asr alarm set for 15:42");
      const line = apps.messages("app-1", 0).find((i) => i.kind === "diary");
      expect(line?.diary).toEqual({ ok: true, entries: 1 });
      expect(() => apps.diaryAnswer("app-1", { requestId: "nope" })).toThrow(HttpError);
    } finally {
      done();
    }
  });

  it("says so when no phone is connected", async () => {
    const { apps, setPhones, done } = setup();
    try {
      setPhones(0);
      expect(await apps.history.readDiary("app-1")).toMatch(/not connected/);
      expect(apps.messages("app-1", 0).find((i) => i.kind === "diary")?.diary).toMatchObject({ ok: false });
    } finally {
      done();
    }
  });

  it("keeps only well formed, short notes", () => {
    expect(cleanDiary([{ at: "a", text: "x".repeat(500) }, null, { at: 1, text: "ok" }, "junk"])).toEqual([
      { at: "a", text: `${"x".repeat(199)}…` },
      { at: "", text: "ok" },
    ]);
  });
});
