// Duplicate and Rename (an app's options, shared/protocol.ts): a duplicate is a separate app with the
// original's code, Git history and notes; a rename moves the folder and the private repo (mocked
// GitHub), keeps the package unless a new identity is asked for, and never touches a -releases repo.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { App, ServerEvent } from "../../shared/protocol.ts";
import { AppManager } from "../src/apps.ts";
import type { Builder } from "../src/builder.ts";
import type { Config } from "../src/config.ts";
import * as fake from "../src/fake-builder.ts";
import { renameAppRepo } from "../src/github.ts";
import type { GithubApi } from "../src/sharing.ts";
import { Store, type AppRecord } from "../src/store.ts";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=Test", "-c", "user.email=t@example.com", ...args], { cwd: dir, encoding: "utf8" });
}

/** An app folder under the apps folder, with two commits, the agent's notes and a GitHub remote. */
function appFolder(appsDir: string, slug = "prayertimes"): string {
  const dir = join(appsDir, slug);
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ expo: { name: "Prayer Times", slug, android: { package: `com.anyapp.${slug}` } } }),
    "src/App.tsx": "export default function App() { return null; }\n",
    "overview.md": "# Prayer Times\n\nPrayer times for Ajman.\n",
    "APP_MEMORY.md": "The person likes big numbers.\n",
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "Build 1: first");
  writeFileSync(join(dir, "src/App.tsx"), "export default function App() { return 7; }\n");
  git(dir, "commit", "-q", "-am", "Build 7: bigger Isha");
  git(dir, "remote", "add", "origin", `https://github.com/me/anyapp-${slug}.git`);
  return dir;
}

function setup(opts: { github?: boolean; gh?: Partial<GithubApi> } = {}) {
  const state = mkdtempSync(join(tmpdir(), "anyapp-duprename-"));
  const appsDir = join(state, "apps");
  const events: ServerEvent[] = [];
  const builds: string[] = [];
  const builder: Builder = {
    kind: "fake",
    createApp: async () => {
      throw new Error("not used");
    },
    buildApk: async (args) => {
      builds.push(args.dir);
      throw new Error("no build in this test");
    },
    getIconPath: () => null,
    adoptApp: fake.adoptApp,
    renameApp: fake.renameApp,
  };
  const calls: string[] = [];
  const github: GithubApi = {
    login: async () => "me",
    visibility: async (full) => {
      calls.push(`visibility ${full}`);
      return "PRIVATE";
    },
    createPublic: async (full) => void calls.push(`createPublic ${full}`),
    setVisibility: async (full, v) => void calls.push(`setVisibility ${full} ${v}`),
    putFile: async (full, path) => void calls.push(`putFile ${full} ${path}`),
    renameRepo: async (full, newName) => {
      calls.push(`renameRepo ${full} ${newName}`);
      return `https://github.com/${full.split("/")[0]}/${newName}`;
    },
    ...opts.gh,
  };
  const config = { stateDir: state, appsDir, github: opts.github ?? false, maxBuildFixes: 0, coordinator: false } as Config;
  const store = new Store(state);
  const apps = new AppManager({ store, builder, config, broadcast: (e) => events.push(e), log: () => {}, github });
  return { apps, store, state, appsDir, events, builds, calls };
}

function addApp(store: Store, dir: string, extra: Partial<App> = {}): App {
  const now = new Date().toISOString();
  const app: App = {
    id: "app-1",
    name: "Prayer Times",
    slug: "prayertimes",
    packageName: "com.anyapp.prayertimes",
    preset: "react-native",
    status: "idle",
    iconVersion: 1,
    createdAt: now,
    updatedAt: now,
    latestApk: { number: 7, status: "succeeded", startedAt: now, sizeBytes: 1, sha256: "x" } as App["latestApk"],
    ...extra,
  };
  store.add({ app, dir, ready: true, sessionId: "old-session", sessionEngine: "claude", engineSessions: { claude: "old-session" } } as never);
  return app;
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const chatOf = (store: Store, id: string) => store.chat(id).list();

describe("Duplicate", () => {
  it("makes a separate app with the code, its Git history and the notes, a new package, and only builds it", async () => {
    const { apps, store, appsDir, builds } = setup();
    const dir = appFolder(appsDir);
    addApp(store, dir);
    const copy = apps.duplicate("app-1", { name: "Prayer Times 2" });
    expect(copy).toMatchObject({ name: "Prayer Times 2", slug: "prayertimes2", packageName: "com.anyapp.prayertimes2", status: "creating" });
    await until(() => builds.length > 0);
    const copyDir = join(appsDir, "prayertimes2");
    expect(builds[0]).toBe(copyDir);
    // The code, the notes and the whole history came along; its own name and package; no GitHub address.
    expect(readFileSync(join(copyDir, "APP_MEMORY.md"), "utf8")).toContain("big numbers");
    expect(readFileSync(join(copyDir, "overview.md"), "utf8")).toContain("Ajman");
    const meta = JSON.parse(readFileSync(join(copyDir, "app.json"), "utf8"));
    expect(meta.expo).toMatchObject({ name: "Prayer Times 2", android: { package: "com.anyapp.prayertimes2" } });
    const log = git(copyDir, "log", "--format=%s");
    expect(log).toContain("Build 7: bigger Isha");
    expect(log).toContain("Build 1: first");
    expect(git(copyDir, "remote").trim()).toBe("");
    // The original is untouched.
    expect(git(dir, "remote", "get-url", "origin").trim()).toBe("https://github.com/me/anyapp-prayertimes.git");
    // A fresh chat that starts with one line; the agent hears about it with the first message.
    const items = chatOf(store, copy.id);
    expect(items[0]).toMatchObject({ kind: "assistant", text: "Copied from Prayer Times, version 7." });
    expect(items.some((i) => i.kind === "user")).toBe(false);
    const record = store.find(copy.id) as AppRecord & { agentNote?: string };
    expect(record.agentNote).toContain('duplicate the person made of their\napp "Prayer Times" (version 7)');
    expect(record.sessionId).toBeUndefined();
  });

  it("with something to change, the change is the first message; names are checked", () => {
    const { apps, store, appsDir } = setup();
    addApp(store, appFolder(appsDir));
    const copy = apps.duplicate("app-1", { name: "Prayer Times Kids", change: "Make it pink for kids." });
    const items = chatOf(store, copy.id);
    expect(items.map((i) => [i.kind, i.text])).toEqual([
      ["assistant", "Copied from Prayer Times, version 7."],
      ["user", "Make it pink for kids."],
    ]);
    expect(() => apps.duplicate("app-1", { name: " " })).toThrow(/name of up to 50/);
  });
});

describe("Rename", () => {
  it("renames the name, folder and private repo; keeps the package; a new session; the releases repo keeps its name", async () => {
    const { apps, store, appsDir, builds, calls } = setup({ github: true });
    const dir = appFolder(appsDir);
    addApp(store, dir, {
      repoUrl: "https://github.com/me/anyapp-prayertimes",
      sharing: { shared: false, releasesRepoUrl: "https://github.com/me/anyapp-prayertimes-releases", installUrl: "x", feedUrl: "y", since: "2026-11-01" },
    });
    const app = await apps.rename("app-1", { name: "Salah Clock" });
    expect(app).toMatchObject({ name: "Salah Clock", slug: "salahclock", packageName: "com.anyapp.prayertimes", repoUrl: "https://github.com/me/anyapp-salahclock", iconVersion: 2 });
    const next = join(appsDir, "salahclock");
    expect(existsSync(dir)).toBe(false);
    expect(JSON.parse(readFileSync(join(next, "app.json"), "utf8")).expo).toMatchObject({ name: "Salah Clock", slug: "salahclock", android: { package: "com.anyapp.prayertimes" } });
    expect(readFileSync(join(next, "APP_MEMORY.md"), "utf8")).toContain("big numbers");
    expect(git(next, "log", "-1", "--format=%s").trim()).toBe("Rename to Salah Clock");
    expect(git(next, "remote", "get-url", "origin").trim()).toBe("https://github.com/me/anyapp-salahclock.git");
    expect(calls).toEqual(["renameRepo me/anyapp-prayertimes anyapp-salahclock"]);
    const record = store.find("app-1") as AppRecord & { agentNote?: string };
    expect(record.dir).toBe(next);
    expect(record.sessionId).toBeUndefined();
    expect(record.engineSessions).toBeUndefined();
    expect(record.shareSlug).toBe("prayertimes");
    expect(record.agentNote).toContain('renamed this app from "Prayer Times" to "Salah Clock"');
    expect(chatOf(store, "app-1").some((i) => i.kind === "assistant" && i.text === "Renamed from Prayer Times to Salah Clock.")).toBe(true);
    await until(() => builds.length > 0);
    expect(builds[0]).toBe(next);

    // Sharing again later uses the releases repo it was made with, never anyapp-salahclock-releases.
    await until(() => !store.find("app-1")!.app.status.match(/working|building/));
    calls.length = 0;
    await apps.setShared("app-1", true).catch(() => {});
    expect(calls.some((c) => c.includes("anyapp-prayertimes-releases"))).toBe(true);
    expect(calls.some((c) => c.includes("salahclock-releases"))).toBe(false);
  });

  it("with a new package: a new identity, refused while shared", async () => {
    const { apps, store, appsDir } = setup();
    addApp(store, appFolder(appsDir), {
      sharing: { shared: true, releasesRepoUrl: "https://github.com/me/anyapp-prayertimes-releases", installUrl: "x", feedUrl: "y", since: "2026-11-01" },
    });
    await expect(apps.rename("app-1", { name: "Salah Clock", newPackage: true })).rejects.toThrow(/Turn off Share with others first/);
    store.find("app-1")!.app.sharing!.shared = false;
    const app = await apps.rename("app-1", { name: "Salah Clock", newPackage: true });
    expect(app).toMatchObject({ slug: "salahclock", packageName: "com.anyapp.salahclock", signing: "own" });
    expect(app.latestApk).toBeUndefined();
    expect(app.sharing).toBeUndefined();
    expect(store.find("app-1")!.shareSlug).toBeUndefined();
    expect(JSON.parse(readFileSync(join(appsDir, "salahclock", "app.json"), "utf8")).expo.android.package).toBe("com.anyapp.salahclock");
  });

  it("the same name with a new package still gets a new package id; GitHub off renames no repo", async () => {
    const { apps, store, appsDir, calls } = setup({ github: false });
    addApp(store, appFolder(appsDir), { repoUrl: "https://github.com/me/anyapp-prayertimes" });
    const app = await apps.rename("app-1", { name: "Prayer Times", newPackage: true });
    expect(app.packageName).toBe("com.anyapp.prayertimes2");
    expect(app.slug).toBe("prayertimes2");
    expect(calls).toEqual([]);
    expect(app.repoUrl).toBe("https://github.com/me/anyapp-prayertimes");
  });

  it("a busy app is not renamed", async () => {
    const { apps, store, appsDir } = setup();
    addApp(store, appFolder(appsDir), { status: "building" });
    await expect(apps.rename("app-1", { name: "Other" })).rejects.toThrow(/is busy/);
  });

  it("the GitHub rename never touches a -releases repo or another name", async () => {
    await expect(renameAppRepo("me/anyapp-tea-releases", "anyapp-brew-releases")).rejects.toThrow(/Refusing/);
    await expect(renameAppRepo("me/anyapp-tea", "anyapp-brew-releases")).rejects.toThrow(/Refusing/);
    await expect(renameAppRepo("me/Kiwimake", "anyapp-brew")).rejects.toThrow(/Refusing/);
  });
});
