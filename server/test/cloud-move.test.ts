// Moving apps on the PC side (src/cloud-move.ts, docs/CLOUD.md section 3): a PC app goes to the
// cloud (code pushed with its history, key sealed to Convex's transport key, chat and to-dos
// copied, the PC copy read-only) and comes back (cloned, key imported, chat back, next build above
// the cloud's). A local bare repo plays GitHub; a fake link plays Convex's /pc/move routes.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { App, ChatItem } from "../../shared/protocol.ts";
import { AppManager } from "../src/apps.ts";
import type { Builder, KeyEntry } from "../src/builder.ts";
import type { CloudLink } from "../src/cloud-link.ts";
import { CloudMover, type MoveKeys } from "../src/cloud-move.ts";
import { oneTimeKey, openWith, sealTo, type Sealed } from "../src/cloud-transport.ts";
import type { Config } from "../src/config.ts";
import { Store } from "../src/store.ts";

const dec = new TextDecoder();
const enc = new TextEncoder();
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "safe.directory=*", ...args], { cwd, encoding: "utf8" }).trim();

function setup() {
  const root = mkdtempSync(join(tmpdir(), "aa-move-"));
  dirs.push(root);
  const state = join(root, "state");
  const appsDir = join(root, "apps");
  mkdirSync(appsDir, { recursive: true });
  const builder: Builder = { kind: "fake", createApp: async () => ({}) as never, buildApk: async () => ({}) as never, getIconPath: () => null };
  const config = { stateDir: state, appsDir, github: false, maxBuildFixes: 3 } as Config;
  const apps = new AppManager({ store: new Store(state), builder, config, broadcast: () => {}, log: () => {} });
  const bare = join(root, "github.git");
  git(root, "init", "-q", "--bare", "-b", "main", bare);
  return { root, apps, appsDir, bare };
}

/** A PC app with code, a version, a chat and a to-do. */
function pcApp(apps: AppManager, appsDir: string): App {
  const dir = join(appsDir, "teatimer");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "App.tsx"), "export default function App() { return null; }\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "First version");
  const now = new Date().toISOString();
  const chat: ChatItem[] = [
    { id: "c1", appId: "x", seq: 1, kind: "user", text: "Make a tea timer", createdAt: now, updatedAt: now },
    { id: "c2", appId: "x", seq: 2, kind: "assistant", text: "Done: a tea timer.", createdAt: now, updatedAt: now },
    { id: "w1", appId: "x", seq: 3, kind: "assistant", text: "a helper's own line", workerId: "h1", createdAt: now, updatedAt: now },
  ];
  const app = apps.adoptMovedApp(
    {
      id: crypto.randomUUID(),
      name: "Tea Timer",
      slug: "teatimer",
      packageName: "com.anyapp.teatimer",
      preset: "react-native",
      status: "idle",
      iconVersion: 1,
      signing: "own",
      latestBuild: { number: 7, status: "succeeded", startedAt: now, finishedAt: now },
      latestApk: { number: 7, status: "succeeded", startedAt: now, finishedAt: now },
      createdAt: now,
      updatedAt: now,
    },
    dir,
    chat,
    [{ id: "t1", text: "Try oolong", done: false, createdAt: now, updatedAt: now }],
  );
  return app;
}

/** Convex's /pc/move routes, as far as the PC sees them. */
async function fakeConvex() {
  const transport = await oneTimeKey();
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let moveId = "m1";
  const cloud: { key?: string; chat: ChatItem[]; todos: unknown[]; head?: string } = { chat: [], todos: [] };
  let pcKey = "";
  const link = {
    linked: () => true,
    info: () => ({ state: "linked", scopes: ["share", "web", "move"] }),
    call: vi.fn(async (path: string, body: Record<string, unknown> = {}) => {
      seen.push({ path, body });
      switch (path) {
        case "/pc/move/to-cloud":
          return { moveId, appId: "k".repeat(32), repo: "octo/anyapp-cloud-teatimer", resumed: false, steps: {} };
        case "/pc/move/repo-token":
          return { token: "ghs_onerepo", repo: "octo/anyapp-cloud-teatimer" };
        case "/pc/move/code":
          cloud.head = String(body.commit);
          return { ok: true };
        case "/pc/move/transport-key":
          return { publicRaw: transport.publicRaw };
        case "/pc/move/key":
          cloud.key = dec.decode(await openWith(transport.key, body.box as Sealed, `appkey-move:${moveId}`));
          return { stored: true };
        case "/pc/move/chat":
          cloud.chat.push(...(body.items as ChatItem[]));
          if (body.todos) cloud.todos = body.todos as unknown[];
          return { written: (body.items as unknown[]).length };
        case "/pc/move/finish":
          return { place: body.pcAppId ? "pc" : "cloud" };
        case "/pc/move/to-pc":
          moveId = "m2";
          return { moveId, name: "Tea Timer", slug: "teatimer", packageName: "com.anyapp.teatimer", preset: "react-native", repo: "octo/anyapp-cloud-teatimer", buildHigh: 9, certSha256: "c".repeat(64) };
        case "/pc/move/key-down":
          pcKey = String(body.pcKey);
          return { box: await sealTo(pcKey, enc.encode(cloud.key!), `appkey-down:${moveId}`), certSha256: "c".repeat(64) };
        case "/pc/move/chat-down":
          return { items: [...cloud.chat, { id: "c9", appId: "k", seq: 9, kind: "assistant", text: "Made in the cloud: a green tea preset.", createdAt: "", updatedAt: "" }], todos: cloud.todos };
        default:
          return { ok: true };
      }
    }),
  };
  return { link: link as unknown as CloudLink, seen, cloud };
}

function fakeKeys(): MoveKeys & { imported: KeyEntry[] } {
  const imported: KeyEntry[] = [];
  return {
    imported,
    exportOne: async (packageName) => ({ id: packageName, info: { keyAlias: "app", storePassword: "store-pass-plain", keyPassword: "store-pass-plain", certSha256: "c".repeat(64), kind: "own" }, files: { store: Buffer.from("PKCS12").toString("base64") } }),
    importOne: async (entry) => {
      imported.push(entry);
      return { added: [entry.id], same: [], conflicts: [] };
    },
  };
}

describe("moving an app on the PC", () => {
  test("to the cloud: history pushed, key sealed, main chat and to-dos copied, the copy read-only", async () => {
    const { apps, appsDir, bare } = setup();
    const app = pcApp(apps, appsDir);
    const { link, seen, cloud } = await fakeConvex();
    const mover = new CloudMover({ apps, link, keys: fakeKeys(), appsDir, log: () => {}, remote: () => bare });
    expect(mover.startToCloud(app.id).move).toMatchObject({ to: "cloud", state: "running" });
    await vi.waitFor(() => expect(apps.get(app.id).move?.state).toBe("done"), { timeout: 15000 });
    expect(apps.get(app.id).move).toMatchObject({ to: "cloud", state: "done", cloudAppId: "k".repeat(32) });
    // The push carried the history; Convex was told that commit.
    expect(git(bare, "rev-parse", "main")).toBe(cloud.head);
    expect(git(bare, "log", "--format=%s", "main")).toContain("First version");
    // The key opened only with Convex's transport key, for this move.
    expect(JSON.parse(cloud.key!)).toEqual({ p12: Buffer.from("PKCS12").toString("base64"), storePassword: "store-pass-plain", keyAlias: "app" });
    expect(JSON.stringify(seen.find((s) => s.path === "/pc/move/key")!.body)).not.toContain("store-pass-plain");
    expect(cloud.chat.map((c) => c.text)).toEqual(["Make a tea timer", "Done: a tea timer."]);
    expect(cloud.todos).toEqual([expect.objectContaining({ text: "Try oolong" })]);
    expect(seen.find((s) => s.path === "/pc/move/finish")!.body).toMatchObject({ buildHigh: 7 });
    // The PC copy is read-only now.
    expect(() => apps.sendMessage(app.id, "one more thing")).toThrow(/moved to the cloud/);
  });

  test("a move that fails says why and resumes when started again; one the PC restarted in shows as stopped", async () => {
    const { apps, appsDir } = setup();
    const app = pcApp(apps, appsDir);
    const { link } = await fakeConvex();
    const mover = new CloudMover({ apps, link, keys: fakeKeys(), appsDir, log: () => {}, remote: () => join(appsDir, "no-such-remote.git") });
    mover.startToCloud(app.id);
    await vi.waitFor(() => expect(apps.get(app.id).move?.state).toBe("failed"), { timeout: 15000 });
    expect(apps.get(app.id).move?.error).toMatch(/Could not push/);
    apps.setMove(app.id, { to: "cloud", state: "running", at: new Date().toISOString() });
    mover.recover();
    expect(apps.get(app.id).move).toMatchObject({ state: "failed", error: expect.stringMatching(/stopped during the move/) });
  });

  test("back to the PC: cloned, key imported, chat back, next build above the cloud's; the read-only copy goes", async () => {
    const { apps, appsDir, bare } = setup();
    const app = pcApp(apps, appsDir);
    const { link } = await fakeConvex();
    const keys = fakeKeys();
    const mover = new CloudMover({ apps, link, keys, appsDir, log: () => {}, remote: () => bare });
    mover.startToCloud(app.id);
    await vi.waitFor(() => expect(apps.get(app.id).move?.state).toBe("done"), { timeout: 15000 });
    const back = await mover.toPc("k".repeat(32));
    expect(back).toMatchObject({ name: "Tea Timer", packageName: "com.anyapp.teatimer", latestBuild: { number: 9 } });
    expect(back.id).not.toBe(app.id);
    expect(apps.list().map((a) => a.id)).toEqual([back.id]);
    expect(apps.messages(back.id, 0).map((i) => i.text)).toEqual(["Make a tea timer", "Done: a tea timer.", "Made in the cloud: a green tea preset."]);
    expect(apps.todos(back.id)).toEqual([expect.objectContaining({ text: "Try oolong" })]);
    expect(keys.imported[0]).toMatchObject({ id: "com.anyapp.teatimer", info: { storePassword: "store-pass-plain", keyAlias: "app", certSha256: "c".repeat(64) } });
    expect(git(apps.dirOf(back.id), "log", "--format=%s")).toContain("First version");
    // It is a normal PC app again: changes are taken.
    expect(apps.get(back.id).move).toBeUndefined();
  });
});
