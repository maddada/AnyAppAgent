// The user's PATH for an app started from a Linux desktop launcher or from the macOS Finder.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptShellEnv, loginShells, mergePath, npmrcPrefix, parseEnvBlock, probeArgs, readShellEnv, toolDirs, withoutAppImage } from "../src/main/shell-env.ts";

const unix = process.platform !== "win32";
const MARK = "__KIWIMAKE_SHELL_ENV__";
const everything = { exists: () => true, list: () => [] as string[], read: () => "" };

describe("which shell to ask, and how", () => {
  it("asks the user's own shell first, then the system shells (zsh first on a Mac)", () => {
    expect(loginShells({ SHELL: "/opt/homebrew/bin/fish" }, "darwin")).toEqual(["/opt/homebrew/bin/fish", "/bin/zsh", "/bin/bash", "/bin/sh"]);
    expect(loginShells({}, "darwin")).toEqual(["/bin/zsh", "/bin/bash", "/bin/sh"]);
    expect(loginShells({ SHELL: "/usr/bin/zsh" }, "linux")).toEqual(["/usr/bin/zsh", "/bin/bash", "/bin/sh"]);
    expect(loginShells({ SHELL: "/usr/bin/nu" }, "linux")).toEqual(["/bin/bash", "/bin/sh"]);
  });

  it("runs zsh, bash and fish as interactive login shells (rc files often set PATH), sh as a login shell", () => {
    expect(probeArgs("/bin/zsh").slice(0, 3)).toEqual(["-l", "-i", "-c"]);
    expect(probeArgs("/bin/bash").slice(0, 3)).toEqual(["-l", "-i", "-c"]);
    expect(probeArgs("/opt/homebrew/bin/fish").slice(0, 3)).toEqual(["-l", "-i", "-c"]);
    expect(probeArgs("/bin/sh").slice(0, 2)).toEqual(["-l", "-c"]);
  });

  it("reads env -0 between the markers, whatever the profile printed", () => {
    expect(parseEnvBlock(`Welcome!\n${MARK}PATH=/a:/b\0FOO=x=y\0EMPTY=\0${MARK}bye`)).toEqual({ PATH: "/a:/b", FOO: "x=y", EMPTY: "" });
    expect(parseEnvBlock("no markers")).toBeUndefined();
  });
});

describe("the PATH Kiwimake ends up with", () => {
  it("keeps the shell's order, then the inherited PATH, then the tool folders, each once, no relative entries", () => {
    expect(mergePath("/mise/shims:relative:/usr/bin", "/usr/bin:/opt/x", ["/home/u/.local/bin", "/mise/shims"])).toBe("/mise/shims:/usr/bin:/opt/x:/home/u/.local/bin");
  });

  it("still finds Homebrew, mise, npm and the claude/codex installers' folder on a Mac when no shell answers", () => {
    const dirs = toolDirs("/Users/u", {}, "darwin", everything);
    for (const d of ["/opt/homebrew/bin", "/usr/local/bin", "/Users/u/.local/bin", "/Users/u/.local/share/mise/shims", "/Users/u/.npm-global/bin", "/Users/u/.bun/bin", "/Users/u/Library/pnpm"]) expect(dirs).toContain(d);
    expect(dirs).not.toContain("/snap/bin");
  });

  it("lists only folders that exist, with the newest nvm Node and npm's own prefix", () => {
    const have = new Set(["/h/.local/bin", "/h/.local/share/mise/shims", "/h/.npm-global/bin", "/h/.nvm/versions/node/v24.2.0/bin", "/h/npm-prefix/bin"]);
    const dirs = toolDirs("/h", {}, "linux", {
      exists: (p) => have.has(p),
      list: (p) => (p === "/h/.nvm/versions/node" ? ["v20.1.0", "v24.2.0", "v9.0.0"] : []),
      read: () => "prefix = ~/npm-prefix\n",
    });
    expect(dirs).toEqual(["/h/.local/bin", "/h/.local/share/mise/shims", "/h/.nvm/versions/node/v24.2.0/bin", "/h/npm-prefix/bin", "/h/.npm-global/bin"]);
  });

  it("reads npm's prefix from ~/.npmrc", () => {
    expect(npmrcPrefix("/h", () => "registry=x\nprefix=~/.npm-global\n")).toBe("/h/.npm-global");
    expect(npmrcPrefix("/h", () => "prefix=relative\n")).toBeUndefined();
    expect(npmrcPrefix("/h", () => { throw new Error("ENOENT"); })).toBeUndefined();
  });

  it("strips the AppImage's own folders from what children inherit", () => {
    const env = { APPIMAGE: "/home/u/Kiwimake.AppImage", APPDIR: "/tmp/.mount_Kiwi", PATH: "/tmp/.mount_Kiwi:/tmp/.mount_Kiwi/usr/sbin:/usr/bin", LD_LIBRARY_PATH: "/tmp/.mount_Kiwi/usr/lib", XDG_DATA_DIRS: "/tmp/.mount_Kiwi/usr/share/:/usr/share" };
    expect(withoutAppImage(env)).toEqual({ PATH: "/usr/bin", LD_LIBRARY_PATH: undefined, XDG_DATA_DIRS: "/usr/share", GSETTINGS_SCHEMA_DIR: undefined });
    expect(withoutAppImage({ PATH: "/usr/bin" })).toEqual({});
  });

  it("adopts the shell's PATH and only the variables this process lacks", async () => {
    const env: Record<string, string | undefined> = { HOME: "/nowhere", SHELL: "/bin/bash", PATH: "/usr/bin", KEEP: "mine" };
    const line = await adoptShellEnv(env, async () => ({ shell: "/bin/bash", vars: { PATH: "/mise/shims:/usr/bin", KEEP: "theirs", NVM_DIR: "/n", SHLVL: "2", PWD: "/x" } }), "linux");
    expect(env.PATH?.split(":").slice(0, 2)).toEqual(["/mise/shims", "/usr/bin"]);
    expect(env.KEEP).toBe("mine");
    expect(env.NVM_DIR).toBe("/n");
    expect(env.SHLVL).toBeUndefined();
    expect(env.PWD).toBeUndefined();
    expect(line).toMatch(/PATH from bash/);
  });

  it("falls back to the usual folders when no shell answers, and does not ask when KIWIMAKE_SHELL_ENV=off", async () => {
    const env: Record<string, string | undefined> = { HOME: "/nowhere", PATH: "/usr/bin" };
    expect(await adoptShellEnv(env, async () => undefined, "linux")).toMatch(/no login shell answered/);
    expect(env.PATH?.startsWith("/usr/bin")).toBe(true);
    let asked = false;
    const off: Record<string, string | undefined> = { HOME: "/nowhere", PATH: "/usr/bin", KIWIMAKE_SHELL_ENV: "off" };
    expect(await adoptShellEnv(off, async () => ((asked = true), undefined), "darwin")).toMatch(/KIWIMAKE_SHELL_ENV=off/);
    expect(asked).toBe(false);
  });

  it("changes nothing with ANYAPP_KEEP_PATH, or on Windows", async () => {
    const keep: Record<string, string | undefined> = { PATH: "/usr/bin", ANYAPP_KEEP_PATH: "1" };
    await adoptShellEnv(keep, async () => ({ shell: "/bin/zsh", vars: { PATH: "/x" } }), "darwin");
    expect(keep.PATH).toBe("/usr/bin");
    const win: Record<string, string | undefined> = { PATH: "C:\\Windows" };
    await adoptShellEnv(win, async () => ({ shell: "/bin/zsh", vars: { PATH: "/x" } }), "win32");
    expect(win.PATH).toBe("C:\\Windows");
  });
});

describe("a real shell", () => {
  it.runIf(unix)("really asks bash, reading its rc file the way a terminal does", async () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-shell-"));
    mkdirSync(join(home, "tools"));
    writeFileSync(join(home, ".bash_profile"), "[ -f ~/.bashrc ] && . ~/.bashrc\n");
    writeFileSync(join(home, ".bashrc"), `echo greeting\nexport PATH="${join(home, "tools")}:$PATH"\nexport KIWI_TEST_VAR=1\n`);
    const result = await readShellEnv("/bin/bash", { HOME: home, PATH: "/usr/bin:/bin" });
    expect(result?.PATH?.split(":")[0]).toBe(join(home, "tools"));
    expect(result?.KIWI_TEST_VAR).toBe("1");
  });

  it.runIf(unix)("gives up on a shell that hangs", async () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-shell-"));
    writeFileSync(join(home, ".bash_profile"), "sleep 30\n");
    const started = Date.now();
    expect(await readShellEnv("/bin/bash", { HOME: home, PATH: "/usr/bin:/bin" }, 500)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
