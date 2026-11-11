import { describe, expect, it } from "vitest";
import type { App } from "../../shared/protocol.ts";
import { HttpError } from "../src/apps.ts";
import { findSecrets } from "../src/secrets.ts";
import { releasesReadme, shareApp, unshareApp, type GithubApi, type ShareDeps } from "../src/sharing.ts";

const app = (over: Partial<App> = {}): App => ({
  id: "a1",
  name: "Tea Timer",
  slug: "teatimer",
  packageName: "com.anyapp.teatimer",
  status: "idle",
  iconVersion: 1,
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  ...over,
});

function fakes(visibility: "PUBLIC" | "PRIVATE" | null = null, kind: "shared" | "own" | "moved" = "shared") {
  const calls: string[] = [];
  const files = new Map<string, string>();
  let vis = visibility;
  const github: GithubApi = {
    login: async () => (calls.push("login"), "someone"),
    visibility: async (full) => (calls.push(`visibility ${full}`), vis),
    createPublic: async (full) => void (calls.push(`create ${full}`), (vis = "PUBLIC")),
    setVisibility: async (full, v) => void (calls.push(`set ${full} ${v}`), (vis = v === "public" ? "PUBLIC" : "PRIVATE")),
    putFile: async (full, path, content) => void (calls.push(`put ${full} ${path}`), files.set(path, content.toString())),
  };
  const deps: ShareDeps = {
    github,
    ensureCodeRepo: async () => void calls.push("code repo"),
    keys: { kind: () => kind, move: async (p) => void calls.push(`move ${p}`) },
    iconPng: () => Buffer.from("PNG"),
    log: () => {},
  };
  return { calls, files, deps };
}

describe("shareApp", () => {
  it("makes the code repo, moves the key, then creates and fills the public releases repo", async () => {
    const f = fakes();
    const { sharing, movedKey } = await shareApp(app(), f.deps);
    expect(f.calls).toEqual([
      "login",
      "code repo",
      "move com.anyapp.teatimer",
      "visibility someone/anyapp-teatimer-releases",
      "create someone/anyapp-teatimer-releases",
      "put someone/anyapp-teatimer-releases README.md",
      "put someone/anyapp-teatimer-releases icon.png",
    ]);
    expect(movedKey).toBe(true);
    expect(sharing).toMatchObject({
      shared: true,
      releasesRepoUrl: "https://github.com/someone/anyapp-teatimer-releases",
      installUrl: "https://github.com/someone/anyapp-teatimer-releases/releases/latest/download/teatimer.apk",
      feedUrl: "https://github.com/someone/anyapp-teatimer-releases/releases/latest/download/update.json",
    });
    expect(f.files.get("README.md")).toContain("# Tea Timer");
    expect(f.files.get("README.md")).toContain("No version is published yet.");
  });

  it("does not move an app that already has its own key, and reuses a private releases repo", async () => {
    const f = fakes("PRIVATE", "own");
    await shareApp(app({ sharing: { shared: false, releasesRepoUrl: "x", installUrl: "x", feedUrl: "x", since: "2026-11-10T00:00:00.000Z" } }), f.deps);
    expect(f.calls).toEqual(["login", "code repo", "visibility someone/anyapp-teatimer-releases", "set someone/anyapp-teatimer-releases public"]);
  });

  it("refuses before any GitHub call when something secret would go public", async () => {
    const f = fakes();
    const error = await shareApp(app({ name: "Chat sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" }), f.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as Error).message).toMatch(/Anthropic API key in README.md/);
    expect((error as Error).message).not.toContain("ABCDEFGHIJ");
    expect(f.calls).toEqual([]);
  });

  it("turns a GitHub failure into a 502 with one plain line", async () => {
    const f = fakes();
    f.deps.github.createPublic = async () => {
      throw new Error("HTTP 422: name already exists on this account\nmore");
    };
    const error = await shareApp(app(), f.deps).catch((e: unknown) => e);
    expect((error as HttpError).status).toBe(502);
    expect((error as Error).message).toBe("The public releases repository could not be made: HTTP 422: name already exists on this account");
  });
});

describe("unshareApp", () => {
  it("makes the releases repo private and keeps the links", async () => {
    const f = fakes("PUBLIC", "own");
    const shared = (await shareApp(app(), f.deps)).sharing;
    const off = await unshareApp(app({ sharing: shared }), f.deps);
    expect(off).toEqual({ ...shared, shared: false });
    expect(f.calls.at(-1)).toBe("set someone/anyapp-teatimer-releases private");
  });
});

describe("findSecrets", () => {
  it("finds keys and tokens without printing them", () => {
    const text = [
      "const k = 'sk-ant-api03-" + "x".repeat(40) + "'",
      "ghp_" + "a1".repeat(18),
      "AKIA" + "B2".repeat(8),
      "-----BEGIN RSA PRIVATE KEY-----",
      "sk-or-v1-" + "0".repeat(64),
    ].join("\n");
    const hits = findSecrets(text, "bundle.js");
    expect(hits.map((h) => h.kind)).toEqual(["Anthropic API key", "OpenRouter API key", "GitHub token", "AWS access key", "Private key"]);
    expect(hits.every((h) => h.preview.length < 40)).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(findSecrets(releasesReadme(app(), "someone"), "README.md")).toEqual([]);
    expect(findSecrets("the sky is blue; sk-short; AKIA123; mask-removeDuplicatesAndSortThemAllPlease", "x")).toEqual([]);
  });
});
