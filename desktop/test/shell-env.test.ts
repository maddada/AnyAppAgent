import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptShellEnv, mergePath, parseEnvBlock, readShellEnv, wellKnownBinDirs, withoutAppImage } from "../src/main/shell-env.ts";

const unix = process.platform !== "win32";
const MARK = "__KIWIMAKE_SHELL_ENV__";

describe("shell environment for a desktop launcher", () => {
  it("reads env -0 between the markers and ignores the shell's greeting", () => {
    const out = `Welcome!\n${MARK}PATH=/a:/b\0FOO=x=y\0EMPTY=\0${MARK}`;
    expect(parseEnvBlock(out)).toEqual({ PATH: "/a:/b", FOO: "x=y", EMPTY: "" });
    expect(parseEnvBlock("no markers")).toBeUndefined();
  });

  it.runIf(unix)("keeps the shell's PATH order, then ours, then extras, without repeats", () => {
    expect(mergePath("/mise/shims:/usr/bin", "/usr/bin:/opt/x", ["/home/u/.local/bin", "/mise/shims"])).toBe("/mise/shims:/usr/bin:/opt/x:/home/u/.local/bin");
  });

  it("lists only tool folders that exist, and the newest nvm Node", () => {
    const have = new Set(["/h/.local/bin", "/h/.local/share/mise/shims", "/h/.npm-global/bin", "/h/.nvm/versions/node/v24.2.0/bin"].map((p) => join(p)));
    const dirs = wellKnownBinDirs("/h", {}, (p) => have.has(p), (p) => (p === join("/h/.nvm/versions/node") ? ["v20.1.0", "v24.2.0", "v9.0.0"] : []));
    expect(dirs).toEqual([join("/h/.local/bin"), join("/h/.local/share/mise/shims"), join("/h/.npm-global/bin"), join("/h/.nvm/versions/node/v24.2.0/bin")]);
  });

  it.runIf(unix)("strips the AppImage's own folders from what children inherit", () => {
    const env = { APPIMAGE: "/home/u/Kiwimake.AppImage", APPDIR: "/tmp/.mount_Kiwi", PATH: "/tmp/.mount_Kiwi:/tmp/.mount_Kiwi/usr/sbin:/usr/bin", LD_LIBRARY_PATH: "/tmp/.mount_Kiwi/usr/lib", XDG_DATA_DIRS: "/tmp/.mount_Kiwi/usr/share/:/usr/share" };
    expect(withoutAppImage(env)).toEqual({ PATH: "/usr/bin", LD_LIBRARY_PATH: undefined, XDG_DATA_DIRS: "/usr/share", GSETTINGS_SCHEMA_DIR: undefined });
    expect(withoutAppImage({ PATH: "/usr/bin" })).toEqual({});
  });

  it.runIf(unix)("adopts the shell's PATH and only the variables we do not have", async () => {
    const env: NodeJS.ProcessEnv = { HOME: "/nowhere", SHELL: "/bin/bash", PATH: "/usr/bin", KEEP: "mine" };
    const line = await adoptShellEnv(env, async () => ({ PATH: "/mise/shims:/usr/bin", KEEP: "theirs", NVM_DIR: "/n", SHLVL: "2", PWD: "/x" }));
    expect(env.PATH?.split(":").slice(0, 2)).toEqual(["/mise/shims", "/usr/bin"]);
    expect(env.KEEP).toBe("mine");
    expect(env.NVM_DIR).toBe("/n");
    expect(env.SHLVL).toBeUndefined();
    expect(env.PWD).toBeUndefined();
    expect(line).toMatch(/PATH from bash/);
  });

  it.runIf(unix)("falls back to the usual folders when the shell does not answer", async () => {
    const env: NodeJS.ProcessEnv = { HOME: "/nowhere", SHELL: "/usr/bin/nu", PATH: "/usr/bin" };
    const line = await adoptShellEnv(env, async () => undefined);
    expect(env.PATH?.startsWith("/usr/bin")).toBe(true);
    expect(line).toMatch(/did not answer/);
  });

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
