// The usage meter, "Keep my apps healthy" and "Never lose your apps" (docs/TRUST.md).
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { App, ChatItem } from "../../shared/protocol.ts";
import type { Builder, KeyEntry } from "../src/builder.ts";
import { Backups, BACKUP_DIR_NAME, makeRecovery, openBackup, openRecovery, packEntries, RECOVERY_FILE, sealBackup, unpackEntries } from "../src/backup.ts";
import { behindReasons, HealthReminders, keepHealthyMessage, REMINDER_EVERY_MS, Templates } from "../src/health.ts";
import type { AppRecord } from "../src/store.ts";
import { monthKey, planLimitFrom, promptUsage, totalTokens, UsageMeter } from "../src/usage.ts";

const dirs: string[] = [];
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "anyapp-trust-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("usage meter", () => {
  it("reads a turn's tokens from the ACP prompt result", () => {
    const u = promptUsage({ stopReason: "end_turn", usage: { inputTokens: 1200, outputTokens: 800, cachedReadTokens: 90000, cachedWriteTokens: 5000, totalTokens: 97000 } });
    expect(u).toEqual({ inputTokens: 1200, outputTokens: 800, cacheReadTokens: 90000, cacheWriteTokens: 5000 });
    expect(totalTokens(u!)).toBe(7000);
    expect(promptUsage({ stopReason: "end_turn" })).toBeNull();
    expect(promptUsage({ usage: { inputTokens: -5, outputTokens: "x" } })).toBeNull();
  });

  it("takes a plan limit only as Claude reported it", () => {
    const at = "2026-11-11T10:00:00.000Z";
    const limit = planLimitFrom({ sessionUpdate: "usage_update", used: 1, size: 2, _meta: { "_claude/rateLimit": { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.83, resetsAt: 1_794_420_000 } } }, at);
    expect(limit).toEqual({ kind: "five_hour", status: "allowed_warning", usedPercent: 83, resetsAt: new Date(1_794_420_000 * 1000).toISOString(), seenAt: at });
    // No utilization: no percentage is made up.
    expect(planLimitFrom({ sessionUpdate: "usage_update", _meta: { "_claude/rateLimit": { status: "allowed" } } }, at)).toEqual({ kind: "plan", status: "allowed", seenAt: at });
    expect(planLimitFrom({ sessionUpdate: "agent_message_chunk" })).toBeNull();
    expect(planLimitFrom({ sessionUpdate: "usage_update", used: 5 })).toBeNull();
  });

  it("adds per app and per month, counts changes, and starts a new month at zero", () => {
    const state = temp();
    let now = new Date(2026, 10, 30, 12);
    const meter = new UsageMeter(state, () => now);
    const turn = { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 10, cacheReadTokens: 1000 };
    meter.add("a", turn, true);
    meter.add("a", turn, false);
    const a = meter.add("b", turn, true);
    expect(a.changes).toBe(1);
    expect(meter.app("a")).toMatchObject({ changes: 1, total: { inputTokens: 200, cacheReadTokens: 2000 }, month: { inputTokens: 200 }, monthKey: "2026-11" });
    expect(meter.state().month.inputTokens).toBe(300);
    meter.flush();
    now = new Date(2026, 11, 1, 9);
    const again = new UsageMeter(state, () => now);
    expect(again.app("a")).toMatchObject({ total: { inputTokens: 200 }, month: { inputTokens: 0 }, monthKey: monthKey(now) });
    expect(again.state().month.inputTokens).toBe(0);
  });

  it("forgets a limit once it has reset", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const meter = new UsageMeter(temp(), () => now);
    meter.notePlan({ kind: "five_hour", status: "allowed", usedPercent: 40, resetsAt: "2026-11-11T11:00:00Z", seenAt: "2026-11-11T09:00:00Z" });
    meter.notePlan({ kind: "seven_day", status: "allowed", usedPercent: 12, resetsAt: "2026-11-15T00:00:00Z", seenAt: "2026-11-11T09:00:00Z" });
    expect(meter.state().plan.map((p) => p.kind)).toEqual(["seven_day"]);
  });
});

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

function templates(): Templates {
  const repo = temp();
  writeFiles(join(repo, "template"), {
    "package.json": JSON.stringify({ dependencies: { expo: "~58.0.23" } }),
    "modules/updates/index.ts": "export const updates = 2;\n",
    "modules/feedback/index.ts": "export const feedback = 1;\n",
  });
  writeFiles(join(repo, "template-kotlin"), { "app/build.gradle.kts": "android {\n  compileSdk = 37\n  defaultConfig {\n    targetSdk = 36\n  }\n}\n" });
  return new Templates(repo);
}

describe("keep my apps healthy", () => {
  it("finds an older Expo and missing or older built-in parts, and nothing on an up to date app", () => {
    const t = templates();
    const fresh = temp();
    writeFiles(fresh, {
      "package.json": JSON.stringify({ dependencies: { expo: "~58.0.20" } }),
      "modules/updates/index.ts": "export const updates = 2;\r\n", // CRLF from Git on Windows is not "older"
      "modules/feedback/index.ts": "export const feedback = 1;\n",
      "modules/updates/android/build/x.bin": "build output is ignored",
    });
    expect(behindReasons(fresh, "react-native", t)).toEqual([]);
    const old = temp();
    writeFiles(old, { "package.json": JSON.stringify({ dependencies: { expo: "~57.0.4" } }), "modules/updates/index.ts": "export const updates = 1;\n" });
    const reasons = behindReasons(old, undefined, t);
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatch(/older Expo \(SDK 57; the newest is 58\)/);
    expect(reasons[1]).toBe("Missing or older built-in parts: updates and Change this app inside the app and shake to give feedback.");
    expect(reasons.join(" ")).not.toMatch(/—/);
  });

  it("checks a Kotlin app's Android target", () => {
    const t = templates();
    const app = temp();
    writeFiles(app, { "app/build.gradle.kts": "android { compileSdk = 35\n targetSdk = 34 }" });
    expect(behindReasons(app, "kotlin", t)).toEqual(["Targets an older Android (API 34; the newest is 36)."]);
    writeFiles(app, { "app/build.gradle.kts": "android { compileSdk = 37\n targetSdk = 36 }" });
    expect(behindReasons(app, "kotlin", t)).toEqual([]);
    expect(behindReasons(app, "expo-exact", t)).toEqual([]);
  });

  it("writes the update message with what is behind and where the newest template is", () => {
    const t = templates();
    const text = keepHealthyMessage({ behind: true, reasons: ["Missing or older built-in parts: updates inside the app."], checkedAt: "" }, "react-native", t);
    expect(text).toContain("- Missing or older built-in parts: updates inside the app.");
    expect(text).toContain(t.reactNativeDir);
    expect(text).toMatch(/saved data exactly as they are/);
    expect(text).not.toMatch(/—/);
  });

  it("reminds once a month while an app is behind", () => {
    let now = Date.parse("2026-11-11T09:00:00Z");
    const r = new HealthReminders(temp(), () => now);
    expect(r.state(0)).toEqual({ due: false, behind: 0, lastAt: null, nextAt: null });
    expect(r.state(2).due).toBe(true);
    r.dismiss();
    expect(r.state(2).due).toBe(false);
    now += REMINDER_EVERY_MS - 1000;
    expect(r.state(2).due).toBe(false);
    now += 2000;
    expect(r.state(2)).toMatchObject({ due: true, behind: 2 });
  });
});

describe("backup encryption", () => {
  it("opens only with the password, and refuses a changed file", () => {
    const { file, publicKey } = makeRecovery("correct horse");
    const plain = packEntries([
      { name: "manifest.json", data: Buffer.from("{}") },
      { name: "apps/x/code.bundle", data: Buffer.alloc(70_000, 7) },
    ]);
    const sealed = sealBackup(plain, publicKey, "2026-11-11T00:00:00.000Z");
    // Nothing in the clear but the format, the date and the one-time key.
    expect(sealed.toString("latin1")).not.toContain("manifest.json");
    expect(() => openRecovery(file, "wrong password")).toThrow(/Wrong password/);
    const priv = openRecovery(file, "correct horse");
    const opened = openBackup(sealed, priv);
    expect(opened.createdAt).toBe("2026-11-11T00:00:00.000Z");
    const entries = unpackEntries(opened.plain);
    expect([...entries.keys()]).toEqual(["manifest.json", "apps/x/code.bundle"]);
    expect(entries.get("apps/x/code.bundle")!.length).toBe(70_000);
    const changed = Buffer.from(sealed);
    changed[changed.length - 40] ^= 1;
    expect(() => openBackup(changed, priv)).toThrow(/changed/);
    const header = Buffer.from(sealed);
    header[30] ^= 1;
    expect(() => openBackup(header, priv)).toThrow();
    // Another recovery key cannot open it.
    const other = makeRecovery("correct horse");
    expect(() => openBackup(sealed, openRecovery(other.file, "correct horse"))).toThrow();
  });
});

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function makeApp(appsDir: string, slug: string): AppRecord {
  const dir = join(appsDir, slug);
  writeFiles(dir, { "overview.md": `# ${slug}\n`, "src/app.ts": "export {};\n" });
  git(dir, "init", "-q");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "Build 7: first");
  const now = new Date().toISOString();
  const app: App = {
    id: `id-${slug}`,
    name: slug,
    slug,
    packageName: `com.anyapp.${slug}`,
    status: "idle",
    iconVersion: 1,
    latestBuild: { number: 7, status: "succeeded", startedAt: now },
    latestApk: { number: 7, status: "succeeded", startedAt: now, sha256: "x" },
    usage: { total: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 }, month: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 }, monthKey: "2026-11", changes: 1, since: now },
    createdAt: now,
    updatedAt: now,
  };
  return { app, dir };
}

describe("backup and restore", () => {
  it("backs up keys, code, chat and to-dos to the folder, and restores them on a fresh PC", async () => {
    const pcA = temp();
    const appsA = join(pcA, "apps");
    const stateA = join(pcA, "state");
    const folder = join(pcA, "OneDrive");
    mkdirSync(folder, { recursive: true });
    const record = makeApp(appsA, "teatimer");
    const chat: ChatItem[] = [{ id: "c1", appId: record.app.id, seq: 1, kind: "user", text: "Make a tea timer", createdAt: "", updatedAt: "" }];
    writeFiles(stateA, { [`chat/${record.app.id}.json`]: JSON.stringify(chat), [`todos/${record.app.id}.json`]: JSON.stringify([{ id: "t", text: "Bigger buttons", done: false }]) });
    const secretEntry: KeyEntry = { id: "com.anyapp.teatimer", info: { storePassword: "SECRET-PASSWORD-123", certSha256: "cc" }, files: { store: "AAAA" } };
    let marked: string[] = [];
    const imported: KeyEntry[][] = [];
    const builder = {
      kind: "fake",
      createApp: async () => {},
      buildApk: async () => ({ apkPath: "", sizeBytes: 0, sha256: "" }),
      getIconPath: () => null,
      keys: {
        list: async () => ({ keys: [], lastBackupAt: null, notBackedUp: [] }),
        backup: async () => ({ file: "", count: 0, createdAt: "" }),
        restore: async () => ({ added: [], same: [], conflicts: [] }),
        kind: () => "own" as const,
        move: async () => ({}),
        exportEntries: async () => [secretEntry],
        importEntries: async (entries: KeyEntry[]) => {
          imported.push(entries);
          return { added: entries.map((e) => e.id), same: [], conflicts: [] };
        },
        markBackedUp: async (ids: string[]) => {
          marked = ids;
        },
      },
    } satisfies Builder;
    const logs: string[] = [];
    const a = new Backups({ stateDir: stateA, appsDir: appsA, builder, log: (...p) => logs.push(p.join(" ")), records: () => [record], addRestored: () => {}, buildRestored: () => {}, hasApp: () => true });
    await expect(a.setup({ enabled: true, folder, password: "short" })).rejects.toThrow(/at least 8/);
    const state = await a.setup({ enabled: true, folder, password: "my long password" });
    expect(state).toMatchObject({ enabled: true, apps: 1, keys: 1, folder });
    expect(marked).toEqual(["com.anyapp.teatimer"]);
    const backupDir = join(folder, BACKUP_DIR_NAME);
    const files = readdirSync(backupDir);
    expect(files).toContain(RECOVERY_FILE);
    const backupFile = files.find((f) => f.endsWith(".anyappbackup"))!;
    // The password, the key's password and the app's name are nowhere in the clear, nor in the logs or state.
    for (const text of [readFileSync(join(backupDir, backupFile), "latin1"), readFileSync(join(backupDir, RECOVERY_FILE), "utf8"), readFileSync(join(stateA, "backup.json"), "utf8"), logs.join("\n")]) {
      expect(text).not.toContain("my long password");
      expect(text).not.toContain("SECRET-PASSWORD-123");
      expect(text).not.toContain("teatimer\"");
    }
    // Turning it on again with another password is refused: the folder's recovery key stays.
    await expect(a.setup({ enabled: true, folder, password: "another password" })).rejects.toThrow(/Wrong password/);

    // A fresh PC.
    const pcB = temp();
    const appsB = join(pcB, "apps");
    const added: { record: AppRecord; chat: ChatItem[]; todos: unknown }[] = [];
    const built: string[] = [];
    const b = new Backups({
      stateDir: join(pcB, "state"),
      appsDir: appsB,
      builder,
      log: () => {},
      records: () => added.map((x) => x.record),
      addRestored: (r, c, t) => added.push({ record: r, chat: c, todos: t }),
      buildRestored: (id) => built.push(id),
      hasApp: (id) => added.some((x) => x.record.app.id === id),
    });
    await expect(b.restore({ folder, password: "wrong password!" })).rejects.toThrow(/Wrong password/);
    const result = await b.restore({ folder, password: "my long password" });
    expect(result.apps).toEqual([{ id: record.app.id, name: "teatimer", outcome: "restored" }]);
    expect(result.keys?.added).toEqual(["com.anyapp.teatimer"]);
    expect(imported[0][0]).toEqual(secretEntry);
    expect(result.rebuilding).toBe(1);
    expect(built).toEqual([record.app.id]);
    const restored = added[0].record;
    expect(restored.dir).toBe(join(appsB, "teatimer"));
    expect(readFileSync(join(restored.dir, "overview.md"), "utf8").replace(/\r\n/g, "\n")).toBe("# teatimer\n");
    expect(git(restored.dir, "log", "--format=%s")).toBe("Build 7: first");
    // The next build follows build 7, so it installs over the phone's copy; no APK file is here yet.
    expect(restored.app.latestBuild?.number).toBe(7);
    expect(restored.app.latestApk).toBeUndefined();
    expect(restored.app.status).toBe("idle");
    expect(added[0].chat).toEqual(chat);
    expect(added[0].todos).toEqual([{ id: "t", text: "Bigger buttons", done: false }]);
    // Backups carry on into the same folder with the same password.
    expect(b.state()).toMatchObject({ enabled: true, folder });
    // Restoring again brings nothing twice.
    const again = await b.restore({ folder: join(folder, BACKUP_DIR_NAME), password: "my long password" });
    expect(again.apps[0].outcome).toBe("here");
    expect(existsSync(join(appsB, "teatimer-2"))).toBe(false);
  });

  it("says plainly when the backup folder is gone", async () => {
    const pc = temp();
    const folder = join(pc, "usb");
    mkdirSync(folder);
    const builder = { kind: "fake", createApp: async () => {}, buildApk: async () => ({ apkPath: "", sizeBytes: 0, sha256: "" }), getIconPath: () => null } satisfies Builder;
    const backups = new Backups({ stateDir: join(pc, "state"), appsDir: join(pc, "apps"), builder, log: () => {}, records: () => [], addRestored: () => {}, buildRestored: () => {}, hasApp: () => false });
    await backups.setup({ enabled: true, folder, password: "long enough pw" });
    rmSync(folder, { recursive: true, force: true });
    await expect(backups.run()).rejects.toThrow(/is not there. Is the drive plugged in\?/);
    expect(backups.summary().lastError).toMatch(/not there/);
  });
});
