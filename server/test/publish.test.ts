import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { App, BuildInfo } from "../../shared/protocol.ts";
import { HttpError } from "../src/apps.ts";
import { readZip, scanApk } from "../src/apk-scan.ts";
import { publishVersion, pullBack, StaleSignerError, type ApkFile, type ReleaseApi, type UpdateJson } from "../src/publish.ts";

/** A minimal zip (deflated entries) standing in for an APK. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const packed = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed);
    centrals.push(central, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const dir = mkdtempSync(join(tmpdir(), "anyapp-publish-test-"));
function apk(name: string, files: Record<string, string>): ApkFile {
  const path = join(dir, name);
  writeFileSync(path, zip(files));
  return { abi: "universal", path, size: readFileSync(path).length, sha256: "f".repeat(64) };
}

const shared = { shared: true, releasesRepoUrl: "https://github.com/someone/anyapp-tea-releases", installUrl: "i", feedUrl: "f", since: "2026-11-11T00:00:00.000Z" };
const app = (over: Partial<App> = {}): App => ({
  id: "a1", name: "Tea Timer", slug: "tea", packageName: "com.anyapp.tea", status: "idle", iconVersion: 1,
  createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z", sharing: shared, ...over,
});
const build = (n: number, signer = "s".repeat(64)): BuildInfo => ({ number: n, status: "succeeded", startedAt: "x", sha256: "f".repeat(64), signerSha256: signer });

function fakeGithub() {
  const calls: { op: string; tag?: string; files?: string[]; opts?: unknown; json?: UpdateJson }[] = [];
  const api: ReleaseApi = {
    createRelease: async (_full, tag, opts) => {
      const feed = opts.files.find((f) => f.endsWith(".json"))!;
      calls.push({ op: "create", tag, files: opts.files.map((f) => f.split(/[\\/]/).pop()!), opts: { prerelease: opts.prerelease, latest: opts.latest, title: opts.title }, json: JSON.parse(readFileSync(feed, "utf8")) });
    },
    uploadAssets: async (_full, tag, files) => void calls.push({ op: "upload", tag, files: files.map((f) => f.split(/[\\/]/).pop()!) }),
    editRelease: async (_full, tag, opts) => void calls.push({ op: "edit", tag, opts }),
    releaseExists: async (_full, tag) => calls.some((c) => c.op === "create" && c.tag === tag),
    putFile: async (_full, path) => void calls.push({ op: `put ${path}` }),
  };
  return { api, calls };
}

const deps = (github: ReleaseApi, apks: ApkFile[], signer: string | null = "s".repeat(64)) => ({
  github, apks, currentSigner: async () => signer, notesBetween: async () => "- Fixed the Asr time", log: () => {},
});

describe("readZip / scanApk", () => {
  it("reads deflated entries and finds a key in the bundle, not in images", () => {
    const a = apk("leak.apk", { "assets/index.android.bundle": `var k="sk-ant-api03-${"A1".repeat(20)}"`, "res/a.png": "sk-ant-api03-" + "B2".repeat(20) });
    expect(readZip(readFileSync(a.path)).map((e) => e.name)).toEqual(["assets/index.android.bundle", "res/a.png"]);
    expect(scanApk(a.path)).toEqual([{ kind: "Anthropic API key", where: "assets/index.android.bundle", preview: expect.stringMatching(/^sk-ant-api…/) }]);
  });
});

describe("publishVersion", () => {
  it("makes a stable release with the APKs and update.json, and updates the README", async () => {
    const g = fakeGithub();
    const universal = apk("u.apk", { "classes.dex": "hello" });
    const arm = { ...apk("a.apk", { "classes.dex": "hello" }), abi: "arm64-v8a", sha256: "a".repeat(64) };
    const releases = await publishVersion(app(), build(7), {}, deps(g.api, [universal, arm]));
    expect(releases[0]).toMatchObject({ version: "1.0", build: 7, channel: "stable", tag: "v1.0-b7", notes: "- Fixed the Asr time" });
    const create = g.calls[0];
    expect(create).toMatchObject({ op: "create", tag: "v1.0-b7", files: ["tea.apk", "tea-arm64-v8a.apk", "update.json"], opts: { prerelease: false, latest: true, title: "Tea Timer 1.0" } });
    expect(create.json).toMatchObject({
      format: 1, package: "com.anyapp.tea", build: 7, version: "1.0", channel: "stable", signer: "s".repeat(64), blocked: [],
      apks: [{ abi: "universal", name: "tea.apk", size: universal.size, sha256: "f".repeat(64) }, { abi: "arm64-v8a", name: "tea-arm64-v8a.apk", size: arm.size, sha256: "a".repeat(64) }],
    });
    expect(g.calls[1].op).toBe("put README.md");
  });

  it("Testing: one pre-release named testing, created once and then refilled", async () => {
    const g = fakeGithub();
    const a = apk("t.apk", { "classes.dex": "x" });
    const first = await publishVersion(app(), build(8), { channel: "testing" }, deps(g.api, [a]));
    expect(g.calls[0]).toMatchObject({ op: "create", tag: "testing", files: ["tea.apk", "update-testing.json"], opts: { prerelease: true, latest: false } });
    const second = await publishVersion(app({ sharing: { ...shared, releases: first } }), build(9), { channel: "testing" }, deps(g.api, [a]));
    expect(g.calls.slice(1).map((c) => `${c.op} ${c.tag}`)).toEqual(["upload testing", "edit testing"]);
    expect(second.filter((r) => r.channel === "testing")).toHaveLength(1);
    expect(second[0].version).toBe("1.0-test.9");
    expect(g.calls.some((c) => c.op === "put README.md")).toBe(false);
  });

  it("refuses: not shared, already published, an older build, a secret in the APK or the notes", async () => {
    const g = fakeGithub();
    const clean = apk("c.apk", { "classes.dex": "x" });
    await expect(publishVersion(app({ sharing: { ...shared, shared: false } }), build(1), {}, deps(g.api, [clean]))).rejects.toThrow(/Share this app first/);
    const done = [{ version: "1.0", build: 5, channel: "stable" as const, tag: "v1.0-b5", url: "u", notes: "n", publishedAt: "p" }];
    await expect(publishVersion(app({ sharing: { ...shared, releases: done } }), build(5), {}, deps(g.api, [clean]))).rejects.toThrow(/already published/);
    await expect(publishVersion(app({ sharing: { ...shared, releases: done } }), build(4), {}, deps(g.api, [clean]))).rejects.toThrow(/newer version/);
    const leak = apk("l.apk", { "assets/index.android.bundle": `k="ghp_${"a1".repeat(18)}"` });
    await expect(publishVersion(app(), build(6), {}, deps(g.api, [leak]))).rejects.toThrow(/GitHub token in assets\/index.android.bundle/);
    await expect(publishVersion(app(), build(6), { notes: `my key AKIA${"B2".repeat(8)}` }, deps(g.api, [clean]))).rejects.toThrow(/AWS access key in the release notes/);
    expect(g.calls).toEqual([]);
  });

  it("refuses a build signed by a key the app no longer uses", async () => {
    const g = fakeGithub();
    const error = await publishVersion(app(), build(3, "old".padEnd(64, "0")), {}, deps(g.api, [apk("o.apk", { "classes.dex": "x" })])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StaleSignerError);
    expect((error as HttpError).status).toBe(409);
  });
});

describe("pullBack", () => {
  it("marks the bad version as a pre-release, makes the one before it the latest, and blocks the build", async () => {
    const g = fakeGithub();
    const releases = [
      { version: "1.1", build: 9, channel: "stable" as const, tag: "v1.1-b9", url: "u", notes: "n", publishedAt: "2026-11-12T00:00:00.000Z" },
      { version: "1.0", build: 7, channel: "stable" as const, tag: "v1.0-b7", url: "u", notes: "n", publishedAt: "2026-11-11T00:00:00.000Z" },
    ];
    const written: { tag: string; content: string }[] = [];
    const out = await pullBack(app({ sharing: { ...shared, releases } }), 9, {
      github: g.api,
      readUpdateJson: async () => ({ format: 1, package: "com.anyapp.tea", build: 7, version: "1.0", channel: "stable", notes: "", publishedAt: "", apks: [], signer: "s", blocked: [] }),
      writeAsset: async (_f, tag, _n, content) => void written.push({ tag, content }),
      log: () => {},
    });
    expect(out[0].pulledBack).toBe(true);
    expect(g.calls.map((c) => `${c.op} ${c.tag ?? ""}`.trim())).toEqual(["edit v1.1-b9", "edit v1.0-b7", "put README.md"]);
    expect(g.calls[0].opts).toMatchObject({ prerelease: true });
    expect(g.calls[1].opts).toEqual({ latest: true });
    expect(JSON.parse(written[0].content).blocked).toEqual([9]);
    expect(written[0].tag).toBe("v1.0-b7");
  });
});
