// Web apps (docs/WEB-APPS.md): the web half of a build, going live through a local stand-in for
// GitHub Pages (a bare Git repo and server/scripts/fake-pages.mjs), Go back, the secrets scan, Web /
// Android / Both, and opening the newest web build from this PC.
import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, ServerEvent } from "../../shared/protocol.ts";
import { AppManager, HttpError } from "../src/apps.ts";
import type { Builder } from "../src/builder.ts";
import type { Config } from "../src/config.ts";
import * as fake from "../src/fake-builder.ts";
import { Store } from "../src/store.ts";
import { checkSite, githubHost, localHost, WebPublisher } from "../src/web-host.ts";
import { appPlaybook } from "../src/playbook.ts";

const FAKE_PAGES = join(import.meta.dirname, "..", "scripts", "fake-pages.mjs");

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

async function setup(opts: { preset?: "web" | "react-native"; latest?: number; pages?: boolean } = {}) {
  const state = mkdtempSync(join(tmpdir(), "anyapp-web-"));
  const dir = join(state, "apps", "teatimer");
  const preset = opts.preset ?? "web";
  await fake.createApp({ dir, name: "Tea Timer", slug: "teatimer", packageName: "com.anyapp.teatimer", preset });
  writeFileSync(join(dir, "overview.md"), "A tea timer.\n");
  writeFileSync(join(dir, "APP_MEMORY.md"), "memory\n");
  gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "Create Tea Timer");
  const now = new Date().toISOString();
  const latest = opts.latest ?? 0;
  const app: App = {
    id: "app-1",
    name: "Tea Timer",
    slug: "teatimer",
    packageName: "com.anyapp.teatimer",
    preset,
    status: "idle",
    iconVersion: 1,
    ...(latest ? { latestBuild: { number: latest, status: "succeeded", startedAt: now, finishedAt: now }, latestApk: { number: latest, status: "succeeded", startedAt: now, finishedAt: now } } : {}),
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(join(state, "apps.json"), JSON.stringify([{ app, dir, ready: true }]));
  const sites = join(state, "sites");
  mkdirSync(sites, { recursive: true });
  const port = await freePort();
  const pages = opts.pages === false ? null : spawn(process.execPath, [FAKE_PAGES, sites, String(port)], { stdio: "ignore" });
  if (pages) {
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`http://localhost:${port}/`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 30));
      }
    }
  }
  process.env.ANYAPP_FAKE_BUILD_MS = "30";
  const apk = join(state, "fake.apk");
  writeFileSync(apk, "apk");
  const builder: Builder = {
    kind: "fake",
    createApp: (args) => fake.createApp(args),
    buildApk: async () => ({ apkPath: apk, sizeBytes: 3, sha256: "abc" }),
    buildWeb: (args) => fake.buildWeb(args),
    addWebVersion: (args) => fake.addWebVersion(args),
    getIconPath: () => null,
  };
  const events: ServerEvent[] = [];
  const config = { stateDir: state, appsDir: join(state, "apps"), github: false, maxBuildFixes: 3, coordinator: false, port: 1 } as Config;
  const host = opts.pages === false ? null : localHost(sites, `http://localhost:${port}`);
  const apps = new AppManager({ store: new Store(state), builder, config, broadcast: (e) => events.push(e), log: () => {}, webHost: host });
  const settle = async (check: () => boolean, what: string) => {
    for (let i = 0; i < 300; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`never ${what}`);
  };
  const idle = () => settle(() => !["building", "working"].includes(apps.get("app-1").status), "idle");
  const live = (n: number) => settle(() => apps.get("app-1").web?.liveBuild === n, `live at ${n}`);
  return {
    apps,
    dir,
    state,
    events,
    port,
    sites,
    idle,
    live,
    done: () => {
      pages?.kill();
      rmSync(state, { recursive: true, force: true });
    },
  };
}

describe("web apps", () => {
  it("builds a web app, pushes only the built files and serves it at its address; no APK, no apk.ready", async () => {
    const t = await setup();
    try {
      t.apps.rebuild("app-1");
      await t.idle();
      await t.live(1);
      const app = t.apps.get("app-1");
      expect(app.latestApk?.number).toBe(1);
      expect(app.latestApk?.web?.state).toBe("live");
      expect(app.web?.address).toBe(`http://localhost:${t.port}/anyapp-teatimer-web/`);
      expect(app.web?.repo).toBe("you/anyapp-teatimer-web");
      expect(t.events.some((e) => e.type === "apk.ready")).toBe(false);
      expect(t.apps.apkFile("app-1")).toBeNull();
      // What the stand-in serves is exactly what was pushed: the site's files, version.json, .nojekyll; no source.
      const index = await fetch(app.web!.address);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain("Tea Timer");
      const version = (await (await fetch(`${app.web!.address}version.json`)).json()) as { build: number };
      expect(version.build).toBe(1);
      const tree = gitIn(t.sites, "--git-dir", join(t.sites, "you", "anyapp-teatimer-web.git"), "ls-tree", "-r", "--name-only", "main").trim().split("\n");
      expect(tree.sort()).toEqual([".nojekyll", "assets/app.js", "index.html", "manifest.webmanifest", "sw.js", "version.json"]);
      // The build card says it is live, with the address.
      const card = t.apps.messages("app-1", 0).filter((i) => i.kind === "build").at(-1);
      expect(card?.build?.web).toMatchObject({ state: "live", address: app.web!.address });
    } finally {
      t.done();
    }
  });

  it("every successful build goes live, and Go back puts the old version online again", async () => {
    const t = await setup();
    try {
      t.apps.rebuild("app-1");
      await t.idle();
      await t.live(1);
      writeFileSync(join(t.dir, "src", "App.tsx"), 'export const name = "Tea Timer, green";\n');
      gitIn(t.dir, "commit", "-qam", "green");
      t.apps.rebuild("app-1");
      await t.idle();
      await t.live(2);
      const js2 = await (await fetch(`${t.apps.get("app-1").web!.address}assets/app.js`)).text();
      expect(js2).toContain("green");
      await t.apps.restore("app-1", 1);
      await t.idle();
      await t.live(3);
      const app = t.apps.get("app-1");
      expect(app.latestApk?.restoredFrom).toBe(1);
      const js3 = await (await fetch(`${app.web!.address}assets/app.js`)).text();
      expect(js3).not.toContain("green");
      const version = (await (await fetch(`${app.web!.address}version.json`)).json()) as { build: number; changed?: string };
      expect(version.build).toBe(3);
    } finally {
      t.done();
    }
  });

  it("refuses to put a secret online and keeps the version before", async () => {
    const t = await setup();
    try {
      t.apps.rebuild("app-1");
      await t.idle();
      await t.live(1);
      writeFileSync(join(t.dir, "src", "App.tsx"), `export const key = "sk-ant-api03-${"a1".repeat(20)}";\n`);
      gitIn(t.dir, "commit", "-qam", "oops");
      t.apps.rebuild("app-1");
      await t.idle();
      const app = t.apps.get("app-1");
      expect(app.latestApk?.number).toBe(2);
      expect(app.latestApk?.web?.state).toBe("failed");
      expect(app.latestApk?.web?.error).toMatch(/Not published: found what looks like a secret \(Anthropic API key in assets\/app\.js\)/);
      expect(app.web?.liveBuild).toBe(1);
      const version = (await (await fetch(`${app.web!.address}version.json`)).json()) as { build: number };
      expect(version.build).toBe(1);
    } finally {
      t.done();
    }
  });

  it("without a host a web app still builds and opens from this PC with a ticket", async () => {
    const t = await setup({ pages: false });
    try {
      t.apps.rebuild("app-1");
      await t.idle();
      const app = t.apps.get("app-1");
      expect(app.latestApk?.web?.state).toBe("local");
      expect(app.web).toBeUndefined();
      const open = t.apps.webOpen("app-1");
      expect(open.build).toBe(1);
      expect(open.path).toMatch(/^\/web\/app-1\/[0-9a-z]+\.[A-Za-z0-9_-]{32}\/$/);
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!t.apps.webRoute(req, res, url.pathname)) res.writeHead(404).end();
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      try {
        const index = await fetch(`${base}${open.path}`);
        expect(index.status).toBe(200);
        expect(await index.text()).toContain("Tea Timer");
        expect((await fetch(`${base}${open.path}assets/app.js`)).headers.get("content-type")).toContain("javascript");
        expect((await fetch(`${base}${open.path}../../x`)).status).toBe(404);
        expect((await fetch(`${base}/web/app-1/zz.${"a".repeat(32)}/`)).status).toBe(403);
      } finally {
        server.close();
      }
    } finally {
      t.done();
    }
  });

  it("Web, Android or Both: a new app becomes a web app; an Android app with versions can only add a web version", async () => {
    const fresh = await setup({ preset: "react-native" });
    try {
      const { app, note } = await fresh.apps.setTargets("app-1", ["web"]);
      expect(app.preset).toBe("web");
      expect(note).toMatch(/web app/);
      expect(existsSync(join(fresh.dir, "anyapp.json"))).toBe(true);
      expect(existsSync(join(fresh.dir, "app.json"))).toBe(false);
      // Its notes and history stay.
      expect(readFileSync(join(fresh.dir, "overview.md"), "utf8")).toBe("A tea timer.\n");
      expect(gitIn(fresh.dir, "log", "--format=%s")).toMatch(/Made it a web app\nCreate Tea Timer/);
    } finally {
      fresh.done();
    }
    const grown = await setup({ preset: "react-native", latest: 4 });
    try {
      await expect(grown.apps.setTargets("app-1", ["web"])).rejects.toThrow(HttpError);
      const { app } = await grown.apps.setTargets("app-1", ["android", "web"]);
      expect(app.targets).toEqual(["android", "web"]);
      expect(existsSync(join(grown.dir, "web", "index.html"))).toBe(true);
      expect(existsSync(join(grown.dir, "app.json"))).toBe(true);
      // Both: the APK and the web version from one build; the phone still gets apk.ready.
      grown.apps.rebuild("app-1");
      await grown.idle();
      await grown.live(5);
      expect(grown.apps.get("app-1").latestApk?.web?.state).toBe("live");
      expect(grown.events.some((e) => e.type === "apk.ready")).toBe(true);
      const back = await grown.apps.setTargets("app-1", ["android"]);
      expect(back.app.targets).toBeUndefined();
      expect(existsSync(join(grown.dir, "web"))).toBe(false);
    } finally {
      grown.done();
    }
    const web = await setup({ latest: 3 });
    try {
      await expect(web.apps.setTargets("app-1", ["android"])).rejects.toThrow(/rewrite/);
      await expect(web.apps.setTargets("app-1", ["ios"])).rejects.toThrow(/targets/);
    } finally {
      web.done();
    }
  });

  it("Game: a new app becomes a game; a game stays a game; an app with versions cannot become one", async () => {
    const fresh = await setup({ preset: "react-native" });
    try {
      const { app, note } = await fresh.apps.makeGame("app-1");
      expect(app.preset).toBe("game");
      expect(app.targets).toBeUndefined();
      expect(note).toMatch(/This is now a game/);
      expect(note).toMatch(/iPhone and the web/);
      expect(JSON.parse(readFileSync(join(fresh.dir, "anyapp.json"), "utf8")).preset).toBe("game");
      expect(existsSync(join(fresh.dir, "game"))).toBe(true);
      expect(existsSync(join(fresh.dir, "app.json"))).toBe(false);
      expect(readFileSync(join(fresh.dir, "overview.md"), "utf8")).toBe("A tea timer.\n");
      expect(gitIn(fresh.dir, "log", "--format=%s")).toMatch(/Made it a game\nCreate Tea Timer/);
      // Again: nothing changes. A web version or Both: refused; Android: it already is one.
      expect((await fresh.apps.makeGame("app-1")).note).toMatch(/already is a game/);
      await expect(fresh.apps.setTargets("app-1", ["android", "web"])).rejects.toThrow(/Games are Android apps for now/);
      await expect(fresh.apps.setTargets("app-1", ["web"])).rejects.toThrow(HttpError);
      expect((await fresh.apps.setTargets("app-1", ["android"])).note).toMatch(/Nothing changed/);
      expect(appPlaybook({ name: "Tea Timer", packageName: "com.anyapp.teatimer", dir: fresh.dir, preset: "game" })).toMatch(/It is a game: Kotlin and Compose Multiplatform/);
    } finally {
      fresh.done();
    }
    const grown = await setup({ preset: "react-native", latest: 4 });
    try {
      await expect(grown.apps.makeGame("app-1")).rejects.toThrow(/already has versions/);
      expect(grown.apps.get("app-1").preset).toBe("react-native");
    } finally {
      grown.done();
    }
  });

  it("the site check finds secrets and source maps; the playbook speaks of a web app", () => {
    const dir = mkdtempSync(join(tmpdir(), "anyapp-site-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "assets", "a.js"), "console.log(1)\n//# sourceMappingURL=a.js.map\n");
      writeFileSync(join(dir, "assets", "a.js.map"), "{}");
      writeFileSync(join(dir, "index.html"), `<script>const t = "ghp_${"A1".repeat(20)}"</script>`);
      const { hits, maps } = checkSite(dir);
      expect(maps.sort()).toEqual(["assets/a.js", "assets/a.js.map"]);
      expect(hits.map((h) => `${h.kind} in ${h.where}`)).toEqual(["GitHub token in index.html"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const text = appPlaybook({ name: "Tea Timer", packageName: "com.anyapp.teatimer", dir: "/x", preset: "web" });
    expect(text).toMatch(/^You are the one and only agent for the web app "Tea Timer"\./);
    expect(text).toContain("Web, Android or Both");
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  it("GitHub host: makes only anyapp-<slug>-web repos, public, and turns Pages on after the push", async () => {
    const calls: string[][] = [];
    const host = githubHost(async (args) => {
      calls.push(args);
      if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "Maddada\n", stderr: "" };
      if (args[0] === "repo" && args[1] === "view") return { code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a Repository" };
      if (args[0] === "auth") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    const site = await host.ensure("teatimer");
    expect(site).toEqual({ repo: "Maddada/anyapp-teatimer-web", repoUrl: "https://github.com/Maddada/anyapp-teatimer-web", address: "https://maddada.github.io/anyapp-teatimer-web/" });
    expect(calls.find((c) => c[1] === "create")).toEqual(["repo", "create", "Maddada/anyapp-teatimer-web", "--public", "--description", expect.any(String)]);
    // No token, no push (and nothing else is touched).
    await expect(host.push("/nowhere", site)).rejects.toThrow(/not signed in/);
    await expect(host.remove({ repo: "Maddada/anyapp-teatimer" })).rejects.toThrow(/Refusing/);
    const publisher = new WebPublisher({ stateDir: mkdtempSync(join(tmpdir(), "anyapp-tk-")), host: null });
    const { ticket } = publisher.ticket("a");
    expect(publisher.checkTicket("a", ticket)).toBe(true);
    expect(publisher.checkTicket("b", ticket)).toBe(false);
  });
});
