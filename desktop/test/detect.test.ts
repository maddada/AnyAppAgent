import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { claudeCliCandidates, detectClaude, extractLoginUrl, interpretClaudeStatus, planLabel } from "../src/main/detect/claude.ts";
import { detectGitHub, ghAssetName, parseDeviceFlow, parseGhAuthStatus } from "../src/main/detect/github.ts";
import { checkJdk, detectTools, javaMajor, missingSdkPackages, parseNodeVersion, REQUIRED_SDK_PACKAGES, sdkPackageDir, toolsEnv, type FsLike } from "../src/main/detect/tools.ts";
import { parseSdkProgress, pickCmdlineTools, planInstall } from "../src/main/install/tools-installer.ts";
import type { Runner } from "../src/main/exec.ts";
import { cmdQuote } from "../src/main/exec.ts";

const fakeRunner =
  (table: Record<string, { code?: number; stdout?: string; stderr?: string; error?: string }>): Runner =>
  async (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    const hit = Object.entries(table).find(([k]) => key.includes(k))?.[1];
    return { code: hit?.code ?? 0, stdout: hit?.stdout ?? "", stderr: hit?.stderr ?? "", error: hit?.error };
  };

/** A fake file system: a set of existing paths and file contents. */
function fakeFs(files: Record<string, string>): FsLike {
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  return {
    existsSync: (p) => [...map.keys()].some((k) => k === norm(p) || k.startsWith(`${norm(p)}/`)),
    readFileSync: (p) => {
      const v = map.get(norm(p));
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
  };
}

// ------------------------------------------------------------- Claude

describe("Claude detection", () => {
  const signedIn = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "me@example.com", subscriptionType: "max" });
  const signedOut = JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });

  it("reads a signed-in Max account", () => {
    const c = interpretClaudeStatus(signedIn);
    expect(c.state).toBe("done");
    expect(c.email).toBe("me@example.com");
    expect(c.plan).toBe("Max");
    expect(c.summary).toBe("Signed in as me@example.com");
  });

  it("reads signed out", () => {
    expect(interpretClaudeStatus(signedOut).state).toBe("needed");
  });

  it("asks for a paid plan when the account is free", () => {
    const c = interpretClaudeStatus(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "free", email: "a@b.c" }));
    expect(c.state).toBe("needed");
    expect(c.summary).toMatch(/Pro or Max/);
  });

  it("treats a cloud provider (Bedrock, Vertex) as signed in even with loggedIn false", () => {
    expect(interpretClaudeStatus(JSON.stringify({ loggedIn: false, apiProvider: "bedrock" })).state).toBe("done");
  });

  it("console login is API billing", () => {
    expect(planLabel({ authMethod: "console" })).toBe("API billing");
  });

  it("garbage is a problem, not signed out", () => {
    expect(interpretClaudeStatus("not json").state).toBe("problem");
    expect(interpretClaudeStatus("{}").state).toBe("problem");
  });

  it("runs `auth status --json` and accepts exit code 1 with JSON (signed out)", async () => {
    const c = await detectClaude("claude.exe", fakeRunner({ "auth status --json": { code: 1, stdout: signedOut } }));
    expect(c.state).toBe("needed");
  });

  it("missing CLI is a problem", async () => {
    expect((await detectClaude(undefined, fakeRunner({}))).state).toBe("problem");
  });

  it("looks first at CLAUDE_CODE_EXECUTABLE, then the SDK binary the ACP adapter uses", () => {
    const list = claudeCliCandidates("C:\\x\\server", { CLAUDE_CODE_EXECUTABLE: "C:\\custom\\claude.exe", USERPROFILE: "C:\\Users\\u" }, "win32", "x64");
    expect(list[0]).toBe("C:\\custom\\claude.exe");
    expect(list[1]).toBe(join("C:\\x\\server", "node_modules", "@anthropic-ai", "claude-agent-sdk-win32-x64", "claude.exe"));
    expect(list.at(-1)).toBe(join("C:\\Users\\u", ".local", "bin", "claude.exe"));
  });

  it("finds the sign-in link inside an OSC 8 hyperlink", () => {
    const out = "Opening browser to sign in…\nIf the browser didn't open, visit: \u001b]8;;https://claude.com/cai/oauth/authorize?code=true&state=abc\u0007https://claude.com/cai/oauth/authorize?code=true&state=abc\u001b]8;;\u0007\nPaste code here if prompted >";
    expect(extractLoginUrl(out)).toBe("https://claude.com/cai/oauth/authorize?code=true&state=abc");
  });

  it("finds a plain sign-in link", () => {
    expect(extractLoginUrl("visit: https://claude.ai/oauth/authorize?x=1 now")).toBe("https://claude.ai/oauth/authorize?x=1");
    expect(extractLoginUrl("nothing here")).toBeUndefined();
  });
});

// ------------------------------------------------------------- GitHub

describe("GitHub detection", () => {
  it("parses the account name from modern gh", () => {
    const out = "github.com\n  ✓ Logged in to github.com account maddada (keyring)\n  - Active account: true";
    expect(parseGhAuthStatus(out)).toEqual({ login: "maddada" });
  });

  it("parses older gh output", () => {
    expect(parseGhAuthStatus("✓ Logged in to github.com as octo-cat (oauth_token)")).toEqual({ login: "octo-cat" });
  });

  it("signed out is null", () => {
    expect(parseGhAuthStatus("You are not logged into any GitHub hosts. To log in, run: gh auth login")).toBeNull();
  });

  it("shows Connected as <name> and never needs anything else", async () => {
    const run = fakeRunner({ "auth status": { code: 0, stderr: "  ✓ Logged in to github.com account maddada (keyring)" } });
    const g = await detectGitHub({ path: "gh.exe", source: "system" }, run, false);
    expect(g).toMatchObject({ state: "done", summary: "Connected as maddada", login: "maddada" });
  });

  it("not signed in: needed, or skipped when the user chose to skip", async () => {
    const run = fakeRunner({ "auth status": { code: 1, stderr: "You are not logged into any GitHub hosts." } });
    expect((await detectGitHub({ path: "gh.exe", source: "system" }, run, false)).state).toBe("needed");
    expect((await detectGitHub({ path: "gh.exe", source: "system" }, run, true)).state).toBe("skipped");
  });

  it("no gh at all: needed (the app downloads it on sign-in)", async () => {
    const g = await detectGitHub(undefined, fakeRunner({}), false);
    expect(g).toMatchObject({ state: "needed", source: "none" });
  });

  it("reads the device-flow code and URL (exact gh 2.67 output)", () => {
    const out = "\n! First copy your one-time code: F071-C134\nOpen this URL to continue in your web browser: https://github.com/login/device\n";
    expect(parseDeviceFlow(out)).toEqual({ code: "F071-C134", url: "https://github.com/login/device" });
  });

  it("names the portable gh zip", () => {
    expect(ghAssetName("v2.103.3", "x64")).toBe("gh_2.103.3_windows_amd64.zip");
    expect(ghAssetName("2.103.3", "arm64")).toBe("gh_2.103.3_windows_arm64.zip");
  });
});

// ------------------------------------------------------------- tools

const JDK_RELEASE = 'IMPLEMENTOR="Microsoft"\nJAVA_VERSION="21.0.12.1"\n';

function fullSdk(root: string): Record<string, string> {
  const files: Record<string, string> = { [`${root}/licenses/android-sdk-license`]: "\n24333f8a" };
  for (const pkg of REQUIRED_SDK_PACKAGES) files[`${root}/${sdkPackageDir(pkg)}/source.properties`] = "Pkg.Revision=1";
  return files;
}

describe("tools detection", () => {
  it("reads Java versions", () => {
    expect(javaMajor(JDK_RELEASE)).toBe(21);
    expect(javaMajor('JAVA_VERSION="1.8.0_392"')).toBe(8);
    expect(javaMajor("nothing")).toBeUndefined();
  });

  it("a JDK needs java.exe and a release file with Java 17+", () => {
    const ok = fakeFs({ "C:/j/bin/java.exe": "", "C:/j/bin/java": "", "C:/j/release": JDK_RELEASE });
    expect(checkJdk("C:/j", ok).ok).toBe(true);
    const old = fakeFs({ "C:/j/bin/java.exe": "", "C:/j/bin/java": "", "C:/j/release": 'JAVA_VERSION="11.0.2"' });
    expect(checkJdk("C:/j", old)).toMatchObject({ ok: false, why: "too old" });
    expect(checkJdk("C:/nope", ok).ok).toBe(false);
  });

  it("lists missing SDK packages and the licence", () => {
    const fs = fakeFs({ "C:/sdk/platform-tools/source.properties": "" });
    const missing = missingSdkPackages("C:/sdk", fs);
    expect(missing).toContain("platforms;android-37.0");
    expect(missing).toContain("ndk;27.1.12297006");
    expect(missing).toContain("licenses");
    expect(missing).not.toContain("platform-tools");
    expect(missingSdkPackages("C:/sdk", fakeFs(fullSdk("C:/sdk")))).toEqual([]);
  });

  it("parses node --version", () => {
    expect(parseNodeVersion("v24.14.1\n")).toBe(24);
    expect(parseNodeVersion("garbage")).toBeUndefined();
  });

  it("uses an existing toolchain on the PC as is (and reports it done)", async () => {
    const files = {
      "D:/tools/android/jdk/bin/java.exe": "",
      "D:/tools/android/jdk/bin/java": "",
      "D:/tools/android/jdk/release": JDK_RELEASE,
      ...fullSdk("D:/tools/android/sdk"),
      "C:/node/node.exe": "",
      "C:/node/node": "",
      "C:/git/cmd/git.exe": "",
      "C:/git/cmd/git": "",
    };
    const env = { PATH: ["C:/node", "C:/git/cmd"].join(process.platform === "win32" ? ";" : ":"), JAVA_HOME: "D:/tools/android/jdk", ANDROID_HOME: "D:/tools/android/sdk" };
    const t = await detectTools({ toolsDir: "C:/home/.anyappagent/tools", env, runner: fakeRunner({ "--version": { stdout: "v24.14.1" } }), fs: fakeFs(files) });
    expect(t.state).toBe("done");
    expect(t.summary).toBe("Ready. Found on this PC.");
    expect(t.pieces.find((p) => p.id === "jdk")).toMatchObject({ ok: true, path: "D:/tools/android/jdk", source: "system" });
    expect(t.pieces.find((p) => p.id === "sdk")).toMatchObject({ ok: true, path: "D:/tools/android/sdk", source: "system" });
    expect(t.env?.JAVA_HOME).toBe("D:/tools/android/jdk");
    expect(t.env?.ANDROID_HOME).toBe("D:/tools/android/sdk");
  });

  it("prefers our own tools folder when it is complete", async () => {
    const own = "C:/home/.anyappagent/tools";
    const files = {
      [`${own}/jdk/bin/java.exe`]: "",
      [`${own}/jdk/bin/java`]: "",
      [`${own}/jdk/release`]: JDK_RELEASE,
      ...fullSdk(`${own}/android-sdk`),
      [`${own}/node/node.exe`]: "",
      [`${own}/node/bin/node`]: "",
      [`${own}/git/cmd/git.exe`]: "",
      [`${own}/git/cmd/git`]: "",
    };
    const t = await detectTools({ toolsDir: own, env: { PATH: "" }, runner: fakeRunner({ "--version": { stdout: "v24.22.2" } }), fs: fakeFs(files) });
    expect(t.state).toBe("done");
    expect(t.pieces.every((p) => p.source === "tools")).toBe(true);
    expect(t.env?.path).toContain(join(own, "node"));
  });

  it("a PC with nothing needs the download", async () => {
    const t = await detectTools({ toolsDir: "C:/t", env: { PATH: "" }, runner: fakeRunner({}), fs: fakeFs({}) });
    expect(t.state).toBe("needed");
    expect(t.pieces.filter((p) => !p.ok).map((p) => p.id).sort()).toEqual(["git", "jdk", "node", "sdk"]);
  });

  it("an old Node does not count", async () => {
    const files = { "C:/node/node.exe": "", "C:/node/node": "" };
    const t = await detectTools({ toolsDir: "C:/t", env: { PATH: "C:/node" }, runner: fakeRunner({ "--version": { stdout: "v16.20.0" } }), fs: fakeFs(files) });
    expect(t.pieces.find((p) => p.id === "node")?.ok).toBe(false);
  });

  it("gives the companion Git Bash when Git came from our tools", () => {
    const env = toolsEnv([{ id: "git", label: "Git", ok: true, source: "tools", path: "x" }], "C:/t");
    expect(env?.gitBash).toBe(join("C:/t", "git", "bin", "bash.exe"));
  });
});

// ------------------------------------------------------------- installer (pure parts)

describe("tools installer", () => {
  it("plans only what is missing", () => {
    const plan = planInstall([
      { id: "jdk", label: "", ok: true },
      { id: "sdk", label: "", ok: false },
      { id: "node", label: "", ok: true },
      { id: "git", label: "", ok: false },
    ]);
    const ids = plan.map((s) => s.id);
    expect(ids).not.toContain("jdk");
    expect(ids).toContain("cmdline-tools");
    expect(ids).toContain("licenses");
    expect(ids).toContain("sdk:ndk;27.1.12297006");
    expect(ids).toContain("git");
    expect(ids).not.toContain("node");
  });

  it("plans nothing when everything is there", () => {
    expect(planInstall(["jdk", "sdk", "node", "git"].map((id) => ({ id: id as "jdk", label: "", ok: true })))).toEqual([]);
  });

  it("picks the Windows command-line tools from Google's repository XML", () => {
    const xml = `<remotePackage path="cmdline-tools;latest"><archives>
      <archive><complete><size>1</size><checksum type="sha1">aaa</checksum><url>commandlinetools-linux-1_latest.zip</url></complete><host-os>linux</host-os></archive>
      <archive><complete><size>1</size><checksum type="sha1">57d04f2d</checksum><url>commandlinetools-win-16111833_latest.zip</url></complete><host-os>windows</host-os></archive>
    </archives></remotePackage>`;
    expect(pickCmdlineTools(xml)).toEqual({ url: "https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip", sha1: "57d04f2d" });
    expect(pickCmdlineTools("<nothing/>")).toBeUndefined();
  });

  it("reads sdkmanager percentages", () => {
    expect(parseSdkProgress("[=======          ] 45% Downloading android-ndk.zip...")).toBeCloseTo(0.45);
    expect(parseSdkProgress("\r[==] 10%\r[====] 20%")).toBeCloseTo(0.2);
    expect(parseSdkProgress("Unzipping platform-tools......")).toBeUndefined();
  });

  it("quotes batch-file arguments that cmd.exe would split", () => {
    expect(cmdQuote("platforms;android-37.0")).toBe('"platforms;android-37.0"');
    expect(cmdQuote("--sdk_root=C:\\a b")).toBe('"--sdk_root=C:\\a b"');
    expect(cmdQuote("platform-tools")).toBe("platform-tools");
  });
});

// ------------------------------------------------------------- ninja (long paths, docs/ENVIRONMENT.md pitfall 1)

import { ninjaOk, parseNinjaVersion } from "../src/main/detect/tools.ts";

describe("ninja check", () => {
  it("reads ninja --version and wants 1.12 or newer", () => {
    expect(parseNinjaVersion("1.10.2\n")).toEqual([1, 10]);
    expect(ninjaOk(parseNinjaVersion("1.10.2"))).toBe(false);
    expect(ninjaOk(parseNinjaVersion("1.13.2"))).toBe(true);
    expect(ninjaOk(parseNinjaVersion("2.0.0"))).toBe(true);
    expect(ninjaOk(undefined)).toBe(false);
  });

  it("an SDK that only needs the ninja fix gets just that step", () => {
    const plan = planInstall([{ id: "jdk", label: "", ok: true }, { id: "sdk", label: "", ok: false, missing: ["ninja"] }, { id: "node", label: "", ok: true }, { id: "git", label: "", ok: true }], ["ninja"]);
    expect(plan.map((s) => s.id)).toEqual(["ninja"]);
  });

  it("a fresh SDK install applies the ninja fix after the SDK pieces and installs both CMakes", () => {
    const ids = planInstall([{ id: "sdk", label: "", ok: false }]).map((s) => s.id);
    const lastSdk = Math.max(...ids.map((id, i) => (id.startsWith("sdk:") ? i : -1)));
    expect(ids.indexOf("ninja")).toBeGreaterThan(lastSdk);
    expect(ids).toContain("sdk:cmake;3.30.5");
    expect(ids).toContain("sdk:cmake;3.22.1");
  });
});

// ------------------------------------------------------------- the builder's dependency cache

import { depsReady } from "../src/main/detect/deps.ts";

describe("builder dependency cache", () => {
  it("is ready only when the builder wrote its .ready marker", () => {
    const seen: string[] = [];
    const yes = depsReady("C:/home/.anyappagent/cache", "02cbcbc968a0a868", (p) => (seen.push(p), true));
    expect(yes.ok).toBe(true);
    expect(seen[0].split(String.fromCharCode(92)).join("/")).toBe("C:/home/.anyappagent/cache/deps-02cbcbc968a0a868/.ready");
    expect(depsReady("C:/c", "abc", () => false).ok).toBe(false);
  });

  it("is installed last, after Node and Git, and only when detection said it is missing", () => {
    const ids = planInstall([
      { id: "jdk", label: "", ok: true },
      { id: "sdk", label: "", ok: true },
      { id: "node", label: "", ok: false },
      { id: "git", label: "", ok: true },
      { id: "deps", label: "", ok: false },
    ]).map((s) => s.id);
    expect(ids).toEqual(["node", "deps"]);
    expect(planInstall([{ id: "deps", label: "", ok: true }, { id: "jdk", label: "", ok: true }, { id: "sdk", label: "", ok: true }, { id: "node", label: "", ok: true }, { id: "git", label: "", ok: true }])).toEqual([]);
  });
});
