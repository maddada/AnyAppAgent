import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineCandidates, engineInstaller, engineUpdate } from "../../shared/engines.mts";
import { detectEngine } from "../src/main/detect/engine.ts";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/main/settings.ts";
import { resolvePaths } from "../src/main/paths.ts";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { keepRuntime } = require("../dev/after-pack.cjs");

describe("engine discovery and setup choice", () => {
  it("uses Windows PATH before standard folders and excludes host session wrappers", () => {
    const candidates = engineCandidates("codex", { Path: "C:/Ghostex/State/session-bin;C:/chosen", LOCALAPPDATA: "C:/local", USERPROFILE: "C:/person" }, "win32");
    expect(candidates[0]).toBe(join("C:/chosen", "codex.exe"));
    expect(candidates.some((p) => p.includes("session-bin"))).toBe(false);
    expect(candidates).toContain(join("C:/local", "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
  });
  it("on Windows counts Claude only as an executable the SDK can spawn, npm's native binary included", () => {
    const candidates = engineCandidates("claude", { Path: "C:/npm", USERPROFILE: "C:/person" }, "win32");
    expect(candidates.every((p) => p.endsWith("claude.exe"))).toBe(true);
    expect(candidates).toContain(join("C:/npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
    expect(candidates).toContain(join("C:/person", ".local", "bin", "claude.exe"));
    expect(engineCandidates("codex", { Path: "C:/npm" }, "win32")).toContain(join("C:/npm", "codex.cmd"));
  });
  it("uses Unix HOME and searches a GUI app's missing PATH locations", () => {
    expect(engineCandidates("claude", { HOME: "/home/a", USERPROFILE: "/wrong" }, "linux")).toContain(join("/home/a", ".local", "bin", "claude"));
    expect(engineCandidates("codex", {}, "darwin")).toContain(join("/opt/homebrew/bin", "codex"));
  });
  it("never replaces a bad explicit override with a different account's executable", () => {
    expect(engineCandidates("codex", { CODEX_EXECUTABLE: "/missing", PATH: "/bin" }, "linux")).toEqual(["/missing"]);
  });
  it("recognizes Codex status on stderr without displaying API key text", async () => {
    const result = await detectEngine("codex", "codex", async () => ({ code: 0, stdout: "", stderr: "Logged in using an API key: secret-placeholder" }));
    expect(result.state).toBe("done");
    expect(JSON.stringify(result)).not.toContain("secret-placeholder");
    expect((await detectEngine("codex", "codex", async () => ({ code: 1, stdout: "", stderr: "Not logged in" }))).state).toBe("needed");
    expect((await detectEngine("codex", undefined, async () => { throw Error("must not execute"); })).installed).toBe(false);
  });
  it("persists the setup choice and migrates old or damaged settings to Claude", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-engine-"));
    try {
      const file = join(dir, "settings.json");
      writeFileSync(file, JSON.stringify({ onboardingDone: true }));
      expect(loadSettings(file)).toMatchObject({ engine: "claude", onboardingDone: true });
      saveSettings(file, { ...DEFAULT_SETTINGS, engine: "codex" });
      expect(loadSettings(file).engine).toBe("codex");
      writeFileSync(file, JSON.stringify({ engine: "not-an-engine" }));
      expect(loadSettings(file).engine).toBe("claude");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("uses the official native installers on all three OS families", () => {
    for (const engine of ["claude", "codex"] as const) {
      expect(engineInstaller(engine, "win32").url).toMatch(/https:\/\/(claude.ai|chatgpt.com\/codex)\/install.ps1$/);
      for (const os of ["linux", "darwin"] as const) expect(engineInstaller(engine, os).url).toMatch(/\/install.sh$/);
    }
  });
  it("updates the owning install and leaves unknown executables untouched", () => {
    const real = (s: string) => s;
    expect(engineUpdate("claude", "/home/me/.local/share/claude/versions/2.1", real)).toEqual({ command: "/home/me/.local/share/claude/versions/2.1", args: ["update"] });
    expect(engineUpdate("codex", "C:/Users/u/AppData/Local/Programs/OpenAI/Codex/bin/codex.exe", real)?.args).toEqual(["update"]);
    expect(engineUpdate("codex", "/opt/homebrew/Caskroom/codex/bin/codex", real)?.command).toBe("brew");
    expect(engineUpdate("codex", "/opt/custom/lib/node_modules/@openai/codex/bin/codex.js", real)?.args).toContain("/opt/custom");
    expect(engineUpdate("codex", "/mystery/codex", real)).toBeUndefined();
  });
  it("keeps test tools under the isolated state directory", () => {
    const p = resolvePaths({ packaged: false, resourcesPath: "/resources", appPath: "/repo/desktop", env: { ANYAPP_STATE_DIR: "C:/isolated" } });
    expect(p.toolsDir).toBe(join(p.stateDir, "tools"));
  });
  it("prunes packaging-only files while preserving runtime TypeScript and notices", () => {
    for (const file of ["pkg/a.js.map", "pkg/a.d.ts", "pkg/examples/demo.js", "pkg/tests/unit.js"]) expect(keepRuntime(file)).toBe(false);
    for (const file of ["pkg/src/runtime.ts", "pkg/README.md", "pkg/LICENSE", "pkg/AGENTS.md", "pkg/docs/NOTICE"]) expect(keepRuntime(file)).toBe(true);
  });
});
