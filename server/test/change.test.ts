// "Change this app" (docs/CHANGE-THIS-APP.md): the suggestions inbox, the code zip on every published
// version, making an own version from it, and `anyapp copy`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../../shared/protocol.ts";
import { suggestionText } from "../../shared/chat/suggestions.ts";
import { AppManager, HttpError } from "../src/apps.ts";
import { runCopy } from "../src/apps-cli.ts";
import type { Builder } from "../src/builder.ts";
import type { Config } from "../src/config.ts";
import { readZip } from "../src/apk-scan.ts";
import { extractZip, findReleaseSource, makeSourceZip, repoFromText } from "../src/release-source.ts";
import { publishVersion, type ReleaseApi } from "../src/publish.ts";
import { Store } from "../src/store.ts";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=Test", "-c", "user.email=t@example.com", ...args], { cwd: dir, encoding: "utf8" });
}

/** An app folder with a commit: code, the agent's notes about the person, and a secret file. */
function appRepo(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "anyapp-change-repo-"));
  const files: Record<string, string> = {
    "app.json": JSON.stringify({ expo: { name: "Prayer Times", slug: "prayertimes", android: { package: "com.anyapp.prayertimes" } } }),
    "src/App.tsx": "export default function App() { return null; }\n",
    "overview.md": "# Prayer Times\n\nPrayer times for Ajman.\n",
    "APP_MEMORY.md": "The person is Mohamad, lives in Ajman.\n",
    "modules/x/APP_MEMORY.md": "nested notes\n",
    ".env": "TOKEN=abc\n",
    "android/key.p12": "not really a key",
    ...extra,
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  git(dir, "init", "-q");
  git(dir, "add", "-A", "-f");
  git(dir, "commit", "-q", "-m", "Build 1: first");
  return dir;
}

function manager(builder?: Partial<Builder>, fetchImpl?: typeof fetch) {
  const state = mkdtempSync(join(tmpdir(), "anyapp-change-"));
  const events: ServerEvent[] = [];
  const full: Builder = {
    kind: "fake",
    createApp: async () => {
      throw new Error("stop here");
    },
    buildApk: async () => {
      throw new Error("not used");
    },
    getIconPath: () => null,
    ...builder,
  };
  const config = { stateDir: state, appsDir: join(state, "apps"), github: false, maxBuildFixes: 3 } as Config;
  const store = new Store(state);
  const apps = new AppManager({ store, builder: full, config, broadcast: (e) => events.push(e), log: () => {}, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  return { apps, store, state, events };
}

/** Adds a ready app record to the store, as if it had been made here. */
function addApp(store: Store, dir: string, packageName = "com.anyapp.prayertimes") {
  const now = new Date().toISOString();
  const app = { id: "app-1", name: "Prayer Times", slug: "prayertimes", packageName, status: "idle" as const, iconVersion: 1, createdAt: now, updatedAt: now };
  store.add({ app, dir, ready: true } as never);
  return app;
}

describe("the From others inbox", () => {
  it("files a shared message under its app, once, and counts what is not opened", () => {
    const { apps, store, events } = manager();
    addApp(store, appRepo());
    const text = suggestionText({ appName: "Prayer Times", packageName: "com.anyapp.prayertimes", from: "Ahmad", text: "Bigger numbers, I can't read Isha.", build: 37 });
    const first = apps.fileSuggestion(`Forwarded:\n${text}`);
    expect(first.suggestion).toMatchObject({ appId: "app-1", from: "Ahmad", text: "Bigger numbers, I can't read Isha.", build: 37 });
    expect(first.app.fromOthers).toBe(1);
    const again = apps.fileSuggestion(text);
    expect(again.suggestion.id).toBe(first.suggestion.id);
    expect(apps.suggestionList("app-1")).toHaveLength(1);
    expect(events.filter((e) => e.type === "suggestions.updated")).toHaveLength(1);

    apps.openSuggestion("app-1", first.suggestion.id);
    expect(apps.get("app-1").fromOthers).toBeUndefined();
    expect(apps.suggestionList("app-1")[0]!.opened).toBe(true);
    apps.removeSuggestion("app-1", first.suggestion.id);
    expect(apps.suggestionList("app-1")).toHaveLength(0);
  });

  it("refuses text that is not a suggestion, and one for an app that is not here", () => {
    const { apps, store } = manager();
    addApp(store, appRepo());
    expect(() => apps.fileSuggestion("make it blue")).toThrow(HttpError);
    try {
      apps.fileSuggestion(suggestionText({ appName: "Tea", packageName: "com.anyapp.tea", text: "Louder" }));
    } catch (error) {
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('"Tea"');
    }
  });

  it("keeps who sees the row per app", () => {
    const { apps, store } = manager();
    addApp(store, appRepo());
    expect(apps.setChange("app-1", { showToOthers: false }).change).toEqual({ showToOthers: false });
  });
});

describe("the code zip on a published version", () => {
  it("holds the committed code without the private notes, .env files or keys", async () => {
    const dir = appRepo();
    const out = join(mkdtempSync(join(tmpdir(), "anyapp-zip-")), "prayertimes-source.zip");
    const { hits, files } = await makeSourceZip(dir, "HEAD", out);
    const names = readZip(readFileSync(out)).map((e) => e.name).filter((n) => !n.endsWith("/"));
    expect(names.sort()).toEqual(["app.json", "overview.md", "src/App.tsx"]);
    expect(files).toBe(names.length + readZip(readFileSync(out)).filter((e) => e.name.endsWith("/")).length);
    expect(hits).toEqual([]);
  });

  it("finds a secret in the code before anything goes public", async () => {
    const dir = appRepo({ "src/keys.ts": `export const KEY = "sk-ant-api03-${"a".repeat(80)}";\n` });
    const out = join(mkdtempSync(join(tmpdir(), "anyapp-zip-")), "x-source.zip");
    const { hits } = await makeSourceZip(dir, "HEAD", out);
    expect(hits.map((h) => h.where)).toContain("src/keys.ts");
  });

  it("unpacks only inside its folder", async () => {
    const dir = appRepo();
    const out = join(mkdtempSync(join(tmpdir(), "anyapp-zip-")), "p.zip");
    await makeSourceZip(dir, "HEAD", out);
    const dest = mkdtempSync(join(tmpdir(), "anyapp-unzip-"));
    expect(extractZip(readFileSync(out), dest, { readOnly: true })).toBe(3);
    expect(readFileSync(join(dest, "src", "App.tsx"), "utf8")).toContain("App");
    expect(statSync(join(dest, "app.json")).mode & 0o200).toBe(0);
  });
});

/** A fake GitHub: one release with the code zip and update.json. */
async function fakeGithub(sourceDir: string, opts: { withSource?: boolean } = {}): Promise<typeof fetch> {
  const zipPath = join(mkdtempSync(join(tmpdir(), "anyapp-gh-")), "prayertimes-source.zip");
  await makeSourceZip(sourceDir, "HEAD", zipPath);
  const zip = readFileSync(zipPath);
  const { createHash } = await import("node:crypto");
  const update = { format: 1, package: "com.anyapp.prayertimes", build: 37, version: "1.4", source: { name: "prayertimes-source.zip", sha256: createHash("sha256").update(zip).digest("hex") } };
  const base = "https://github.com/mohamad/anyapp-prayertimes-releases/releases/download/v1.4-b37";
  const assets = [
    ...(opts.withSource === false ? [] : [{ name: "prayertimes-source.zip", browser_download_url: `${base}/prayertimes-source.zip`, size: zip.length }]),
    { name: "update.json", browser_download_url: `${base}/update.json`, size: 10 },
  ];
  return (async (url: string | URL) => {
    const u = String(url);
    if (u.startsWith("https://api.github.com/repos/mohamad/anyapp-prayertimes-releases/releases")) {
      return new Response(JSON.stringify([{ tag_name: "testing", prerelease: true, assets: [] }, { tag_name: "v1.4-b37", prerelease: false, assets }]));
    }
    if (u.endsWith("/update.json")) return new Response(JSON.stringify(update));
    if (u.endsWith("/prayertimes-source.zip")) return new Response(zip);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("Make my own version", () => {
  it("finds the version's code, and says plainly when a version has none", async () => {
    const f = await fakeGithub(appRepo());
    const s = await findReleaseSource("mohamad/anyapp-prayertimes-releases", 37, f);
    expect(s).toMatchObject({ tag: "v1.4-b37", version: "1.4", build: 37, packageName: "com.anyapp.prayertimes" });
    const none = await fakeGithub(appRepo(), { withSource: false });
    await expect(findReleaseSource("mohamad/anyapp-prayertimes-releases", 37, none)).rejects.toThrow(/no code in it/);
    expect(repoFromText("https://github.com/mohamad/anyapp-prayertimes-releases/releases/latest/download/prayertimes.apk")).toBe("mohamad/anyapp-prayertimes-releases");
    expect(repoFromText("mohamad/other")).toBeNull();
  });

  it("makes a separate app from the published code, with its own name and package", async () => {
    const f = await fakeGithub(appRepo());
    let adopted: { src: string; name: string; packageName: string; files: string[] } | undefined;
    const { apps } = manager(
      {
        adoptApp: async (args) => {
          adopted = { src: args.src, name: args.name, packageName: args.packageName, files: readdirSync(args.src).sort() };
          throw new Error("stop here"); // no agent session in a unit test
        },
      },
      f,
    );
    const app = await apps.cloneFrom({ repo: "mohamad/anyapp-prayertimes-releases", build: 37, name: "Prayer Times (Ahmad's)", firstChange: "Bigger text", originalName: "Prayer Times", owner: "Mohamad" });
    expect(app).toMatchObject({ name: "Prayer Times (Ahmad's)", packageName: "com.anyapp.prayertimesahmads", madeFrom: { name: "Prayer Times", owner: "Mohamad", version: "1.4", build: 37, packageName: "com.anyapp.prayertimes" } });
    for (let i = 0; i < 50 && !adopted; i++) await new Promise((r) => setTimeout(r, 10));
    expect(adopted).toMatchObject({ name: "Prayer Times (Ahmad's)", packageName: "com.anyapp.prayertimesahmads", files: ["app.json", "overview.md", "src"] });
  });

  it("refuses an app that is already the person's own", async () => {
    const f = await fakeGithub(appRepo());
    const { apps, store } = manager({ adoptApp: async () => ({ preset: "react-native" }) }, f);
    addApp(store, appRepo());
    await expect(apps.cloneFrom({ repo: "mohamad/anyapp-prayertimes-releases", name: "Mine" })).rejects.toThrow(/already one of your apps/);
  });
});

describe("anyapp copy", () => {
  it("copies another app's committed code, read only, and a shared app's published code", async () => {
    const { store, state } = manager();
    addApp(store, appRepo());
    const own = await runCopy(["copy", "prayertimes"], { ANYAPP_CLI_STATE_DIR: state });
    expect(own.code).toBe(0);
    const folder = own.out.split("\n")[0]!;
    expect(existsSync(join(folder, "src", "App.tsx"))).toBe(true);
    expect(existsSync(join(folder, ".env"))).toBe(false);
    expect(statSync(join(folder, "app.json")).mode & 0o200).toBe(0);

    const f = await fakeGithub(appRepo());
    const shared = await runCopy(["copy", "https://github.com/mohamad/anyapp-prayertimes-releases"], { ANYAPP_CLI_STATE_DIR: state }, f);
    expect(shared.code).toBe(0);
    expect(shared.out).toContain("version 1.4, build 37");
    expect(existsSync(join(shared.out.split("\n")[0]!, "APP_MEMORY.md"))).toBe(false);
    expect((await runCopy(["copy", "nothing-here"], { ANYAPP_CLI_STATE_DIR: state })).code).toBe(1);
  });
});

describe("publishing carries the code", () => {
  it("adds <slug>-source.zip to the release and names it in update.json", async () => {
    const repo = appRepo();
    const apkPath = join(mkdtempSync(join(tmpdir(), "anyapp-apk-")), "app.apk");
    await makeSourceZip(repo, "HEAD", apkPath); // any zip stands in for the APK
    const created: { files: string[]; json: { source?: { name: string; sha256: string } } }[] = [];
    const github: ReleaseApi = {
      createRelease: async (_f, _t, opts) => void created.push({ files: opts.files.map((f) => f.split(/[\\/]/).pop()!), json: JSON.parse(readFileSync(opts.files.find((f) => f.endsWith("update.json"))!, "utf8")) }),
      uploadAssets: async () => {},
      editRelease: async () => {},
      releaseExists: async () => false,
      putFile: async () => {},
    };
    const app = { id: "a", name: "Prayer Times", slug: "prayertimes", packageName: "com.anyapp.prayertimes", status: "idle" as const, iconVersion: 1, createdAt: "", updatedAt: "",
      sharing: { shared: true, releasesRepoUrl: "https://github.com/mohamad/anyapp-prayertimes-releases", installUrl: "", feedUrl: "", since: "" } };
    const releases = await publishVersion(app, { number: 3, status: "succeeded", startedAt: "", sha256: "f".repeat(64), signerSha256: "s".repeat(64) }, {}, {
      github, apks: [{ abi: "universal", path: apkPath, size: 1, sha256: "f".repeat(64) }], currentSigner: async () => "s".repeat(64), notesBetween: async () => "Notes", log: () => {},
      sourceZip: async (out) => ({ path: out, hits: (await makeSourceZip(repo, "HEAD", out)).hits }),
    });
    expect(releases[0]!.source).toBe(true);
    expect(created[0]!.files).toContain("prayertimes-source.zip");
    expect(created[0]!.json.source).toMatchObject({ name: "prayertimes-source.zip" });
    expect(created[0]!.json.source!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
