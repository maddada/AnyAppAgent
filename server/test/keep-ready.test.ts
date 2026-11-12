// "Use the cloud when my PC is off" on the PC side (src/keep-ready.ts, docs/CLOUD.md section 3):
// an app kept ready (code pushed, key sealed once), a change made in the cloud pulled back
// (fast-forward, chat rows "Made in the cloud", the build number), and one place at a time. A
// local bare repo plays GitHub; a fake link plays Convex's /pc/ready and /pc/pull-back routes.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { App, ChatItem } from "../../shared/protocol.ts";
import { AppManager } from "../src/apps.ts";
import type { Builder } from "../src/builder.ts";
import type { CloudLink } from "../src/cloud-link.ts";
import type { MoveKeys } from "../src/cloud-move.ts";
import { oneTimeKey, openWith, type Sealed } from "../src/cloud-transport.ts";
import type { Config } from "../src/config.ts";
import { KeepReady } from "../src/keep-ready.ts";
import { Store } from "../src/store.ts";

const dec = new TextDecoder();
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "safe.directory=*", ...args], { cwd, encoding: "utf8" }).trim();

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "aa-ready-"));
  dirs.push(root);
  const state = join(root, "state");
  const appsDir = join(root, "apps");
  const builder: Builder = { kind: "fake", createApp: async () => ({}) as never, buildApk: async () => ({}) as never, getIconPath: () => null };
  const apps = new AppManager({ store: new Store(state), builder, config: { stateDir: state, appsDir, github: false, maxBuildFixes: 3 } as Config, broadcast: () => {}, log: () => {} });
  const bare = join(root, "github.git");
  git(root, "init", "-q", "--bare", "-b", "main", bare);
  const dir = join(appsDir, "teatimer");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "App.tsx"), "export default 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "First version");
  const now = new Date().toISOString();
  const app: App = apps.adoptMovedApp(
    { id: crypto.randomUUID(), name: "Tea Timer", slug: "teatimer", packageName: "com.anyapp.teatimer", preset: "react-native", status: "idle", iconVersion: 1, signing: "own", latestBuild: { number: 4, status: "succeeded", startedAt: now, finishedAt: now }, latestApk: { number: 4, status: "succeeded", startedAt: now, finishedAt: now }, createdAt: now, updatedAt: now },
    dir,
    [{ id: "c1", appId: "x", seq: 1, kind: "user", text: "Make a tea timer", createdAt: now, updatedAt: now }],
    [],
  );
  const transport = await oneTimeKey();
  const cloud = { switchOn: true, pushed: null as string | null, key: null as string | null, pcOff: false, busy: false, buildHigh: 4, done: null as string | null };
  const link = {
    linked: () => true,
    info: () => ({ state: "linked", scopes: ["share", "web", "move"] }),
    call: vi.fn(async (path: string, body: Record<string, unknown> = {}) => {
      switch (path) {
        case "/pc/ready":
          return cloud.switchOn ? { off: false, appId: "k".repeat(32), hasKey: Boolean(cloud.key), pushedCommit: cloud.pushed, pcOff: cloud.pcOff ? { since: 1 } : null } : { off: true };
        case "/pc/ready/repo-token":
          return { token: "ghs_onerepo", repo: "octo/anyapp-cloud-teatimer" };
        case "/pc/ready/code":
          cloud.pushed = String(body.commit);
          return { ok: true };
        case "/pc/move/transport-key":
          return { publicRaw: transport.publicRaw };
        case "/pc/ready/key":
          cloud.key = dec.decode(await openWith(transport.key, body.box as Sealed, `appkey-ready:${"k".repeat(32)}`));
          return { stored: true };
        case "/pc/pull-back/list":
          return { apps: cloud.pcOff ? [{ appId: "k".repeat(32), pcAppId: app.id, packageName: "com.anyapp.teatimer", repo: "octo/anyapp-cloud-teatimer", buildHigh: cloud.buildHigh, busy: cloud.busy }] : [] };
        case "/pc/pull-back/chat":
          return { items: [{ id: "u9", appId: "k", seq: 9, kind: "user", text: "Add a green tea preset", createdAt: "", updatedAt: "" }, { id: "a9", appId: "k", seq: 10, kind: "assistant", text: "Added a green tea preset.", createdAt: "", updatedAt: "" }] as ChatItem[] };
        case "/pc/pull-back/done":
          cloud.done = String(body.commit);
          cloud.pcOff = false;
          return { buildHigh: cloud.buildHigh };
        default:
          return { ok: true };
      }
    }),
  };
  const keys: MoveKeys = {
    exportOne: async (id) => ({ id, info: { keyAlias: "app", storePassword: "store-pass-plain", certSha256: "c".repeat(64), kind: "own" }, files: { store: Buffer.from("PKCS12").toString("base64") } }),
    importOne: async () => ({ added: [], same: [], conflicts: [] }),
  };
  const ready = new KeepReady({ apps, link: link as unknown as CloudLink, keys, log: () => {}, remote: () => bare });
  apps.beforeChange = (a) => ready.guard(a);
  return { apps, app, dir, bare, cloud, ready, link };
}

describe("keeping apps ready in the cloud", () => {
  test("the code goes up after a version and the key once; nothing at all while the switch is off", async () => {
    const { app, bare, cloud, ready, link } = await setup();
    cloud.switchOn = false;
    await ready.keep(app.id);
    expect(link.call.mock.calls.map((c) => c[0])).toEqual(["/pc/ready"]);
    cloud.switchOn = true;
    await ready.keep(app.id);
    expect(git(bare, "rev-parse", "main")).toBe(cloud.pushed);
    expect(JSON.parse(cloud.key!)).toMatchObject({ storePassword: "store-pass-plain", keyAlias: "app" });
    // Again with nothing new: no push, no key.
    link.call.mockClear();
    await ready.keep(app.id);
    expect(link.call.mock.calls.map((c) => c[0])).toEqual(["/pc/ready"]);
  });

  test("a change made in the cloud comes back: commits, chat rows marked, the build number; changes wait until then", async () => {
    const { apps, app, dir, bare, cloud, ready } = await setup();
    await ready.keep(app.id);
    // The cloud's change: one commit on top of the PC's, while the PC was off.
    const other = mkdtempSync(join(tmpdir(), "aa-cloudside-"));
    dirs.push(other);
    git(other, "clone", "-q", bare, "w");
    writeFileSync(join(other, "w", "App.tsx"), "export default 2;\n");
    git(join(other, "w"), "commit", "-q", "-am", "Add a green tea preset");
    git(join(other, "w"), "push", "-q", "origin", "HEAD:main");
    cloud.pcOff = true;
    cloud.busy = true;
    cloud.buildHigh = 5;
    // While the cloud still works on it, the PC waits and takes no change of its own.
    await ready.pullBackAll();
    expect(() => apps.sendMessage(app.id, "Make it blue")).toThrow(/coming back to this PC first/);
    cloud.busy = false;
    await ready.pullBackAll();
    expect(git(dir, "log", "-1", "--format=%s")).toBe("Add a green tea preset");
    expect(cloud.done).toBe(git(dir, "rev-parse", "HEAD"));
    const items = apps.messages(app.id, 0);
    expect(items.map((i) => [i.text, Boolean(i.madeInCloud)])).toEqual([
      ["Make a tea timer", false],
      ["Add a green tea preset", true],
      ["Added a green tea preset.", true],
    ]);
    expect(apps.get(app.id).latestBuild?.number).toBe(5);
    // Pulled back once: a second run adds nothing, and changes are taken again.
    await ready.pullBackAll();
    expect(apps.messages(app.id, 0)).toHaveLength(3);
    expect(() => ready.guard(apps.get(app.id))).not.toThrow();
  });
});
