// "Publish the code too" (docs/GALLERY.md, "Public code"): the public anyapp-<slug>-source repo
// starts with one commit of a version's code and gets one commit per later version, made with the
// account's noreply address; code that names this PC's folders is refused. A local bare repo stands
// in for GitHub.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeSourceZip } from "../src/release-source.ts";
import { run } from "../src/git.ts";
import { pcPathHits, publicCodeRepoName, pushPublicCode, type CodeRepoApi } from "../src/public-code.ts";

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Private Person", "-c", "user.email=private@example.com", ...args], { cwd: dir, encoding: "utf8" });
}

/** The app's private repo: history, notes about the owner, a .env. */
function appRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "anyapp-pc-app-"));
  gitIn(dir, "init", "-q", "-b", "main");
  for (const [name, text] of Object.entries({ "APP_MEMORY.md": "The owner lives in Ajman.\n", ".env": "X=1\n", ...files })) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  gitIn(dir, "add", "-A", "-f");
  gitIn(dir, "commit", "-q", "-m", "private history");
  return dir;
}

async function zipOf(dir: string): Promise<Buffer> {
  const out = join(mkdtempSync(join(tmpdir(), "anyapp-pc-zip-")), "x-source.zip");
  await makeSourceZip(dir, "HEAD", out);
  return readFileSync(out);
}

function localGithub(): { api: CodeRepoApi; bare: (full: string) => string } {
  const root = mkdtempSync(join(tmpdir(), "anyapp-pc-gh-"));
  const bare = (full: string) => join(root, `${full.replace("/", "__")}.git`);
  const api: CodeRepoApi = {
    identity: async () => ({ login: "tester", email: "123+tester@users.noreply.github.com" }),
    exists: async (full) => existsSync(bare(full)),
    createPublic: async (full) => void execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare(full)]),
    remote: bare,
    git: async (args, cwd) => {
      const r = await run("git", args, cwd);
      return { code: r.code, err: r.stderr };
    },
  };
  return { api, bare };
}

describe("the public code repo", () => {
  it("starts with one commit of the version's code, by the noreply address, without the private notes", async () => {
    const { api, bare } = localGithub();
    const full = `tester/${publicCodeRepoName("waterglass")}`;
    expect(full).toBe("tester/anyapp-waterglass-source");
    const zip = await zipOf(appRepo({ "src/App.tsx": "export default 1;\n", "LICENSE": "MIT License\n" }));
    expect(await pushPublicCode({ full, appName: "Water Glass", version: "1.0", build: 4, zip }, api)).toBe("created");
    const log = gitIn(bare(full), "log", "--format=%an <%ae>|%cn <%ce>|%s", "main").trim().split("\n");
    expect(log).toEqual(["tester <123+tester@users.noreply.github.com>|tester <123+tester@users.noreply.github.com>|Water Glass 1.0 (build 4): the code as published"]);
    const files = gitIn(bare(full), "ls-tree", "-r", "--name-only", "main").trim().split("\n").sort();
    expect(files).toEqual(["LICENSE", "src/App.tsx"]);
    expect(gitIn(bare(full), "tag").trim()).toBe("v1.0-b4");
  });

  it("adds one commit per later version, with exactly its files; the same code again adds nothing", async () => {
    const { api, bare } = localGithub();
    const full = "tester/anyapp-tea-source";
    await pushPublicCode({ full, appName: "Tea", version: "1.0", build: 1, zip: await zipOf(appRepo({ "a.ts": "1\n", "old.ts": "gone later\n" })) }, api);
    const v2 = await zipOf(appRepo({ "a.ts": "2\n" }));
    expect(await pushPublicCode({ full, appName: "Tea", version: "1.1", build: 2, zip: v2 }, api)).toBe("committed");
    expect(gitIn(bare(full), "rev-list", "--count", "main").trim()).toBe("2");
    expect(gitIn(bare(full), "ls-tree", "-r", "--name-only", "main").trim()).toBe("a.ts");
    expect(gitIn(bare(full), "log", "-1", "--format=%s", "main").trim()).toBe("Tea 1.1 (build 2)");
    expect(await pushPublicCode({ full, appName: "Tea", version: "1.1", build: 2, zip: v2 }, api)).toBe("unchanged");
  });
});

describe("folder paths of this PC", () => {
  it("are found in the code before it goes public, but not in ordinary code", async () => {
    const zip = await zipOf(
      appRepo({
        "ok.ts": "const home = '/home'; // a route, not a folder\nconst pkg = 'com.anyappagent';\n",
        "notes.md": `Built in ${join(homedir(), "aa", "apps", "x")}\n`,
        "other.md": "line\nsee /home/someone/projects\n",
        "win.md": "C:\\Users\\Someone\\aa\\apps\n",
      }),
    );
    const where = pcPathHits(zip).map((h) => h.where).sort();
    expect(where).toEqual(["notes.md (line 1)", "other.md (line 2)", "win.md (line 1)"]);
  });
});
