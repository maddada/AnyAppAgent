// macOS: the PATH an app started from Finder gets, Mac JDK folders, and Hex.app.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { macJdks } from "../src/main/detect/tools.ts";
import { findMacApp, manifestTarget, supported } from "../src/main/hex.ts";
import { fallbackDirs, loginShells, parseProbe, probeArgs, userToolPath } from "../src/main/user-path.ts";

describe("the user's PATH on a Mac", () => {
  it("asks the user's own shell first, then the system shells", () => {
    expect(loginShells({ SHELL: "/opt/homebrew/bin/fish" })).toEqual(["/opt/homebrew/bin/fish", "/bin/zsh", "/bin/bash", "/bin/sh"]);
    expect(loginShells({})).toEqual(["/bin/zsh", "/bin/bash", "/bin/sh"]);
  });

  it("runs zsh and bash as interactive login shells (rc files often set PATH)", () => {
    expect(probeArgs("/bin/zsh").slice(0, 1)).toEqual(["-lic"]);
    expect(probeArgs("/bin/bash").slice(0, 1)).toEqual(["-lic"]);
    expect(probeArgs("/opt/homebrew/bin/fish").slice(0, 3)).toEqual(["-l", "-i", "-c"]);
    expect(probeArgs("/bin/sh").slice(0, 2)).toEqual(["-l", "-c"]);
  });

  it("reads the last marked line, whatever the profile printed", () => {
    const out = "Welcome!\n__KIWIMAKE_PATH__=/old\nmore noise\n__KIWIMAKE_PATH__=/opt/homebrew/bin:relative:/Users/u/.local/bin\n";
    expect(parseProbe(out)).toEqual(["/opt/homebrew/bin", "/Users/u/.local/bin"]);
    expect(parseProbe("no marker")).toEqual([]);
  });

  it("puts the shell's folders first, then the inherited PATH, then the usual tool folders, each once", () => {
    const path = userToolPath(["/Users/u/.local/bin", "/opt/homebrew/bin"], "/usr/bin:/bin:/usr/sbin:/sbin", {}, "/Users/u").split(":");
    expect(path.slice(0, 4)).toEqual(["/Users/u/.local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"]);
    expect(path).toContain("/Users/u/.local/share/mise/shims");
    expect(path).toContain("/usr/local/bin");
    expect(new Set(path).size).toBe(path.length);
  });

  it("still finds Homebrew, mise, npm and the claude/codex installers' folder when no shell answers", () => {
    const dirs = fallbackDirs({}, "/Users/u");
    for (const d of ["/opt/homebrew/bin", "/usr/local/bin", "/Users/u/.local/bin", "/Users/u/.local/share/mise/shims", "/Users/u/.npm-global/bin", "/Users/u/.bun/bin"]) {
      expect(dirs).toContain(d);
    }
  });
});

describe("JDKs on a Mac", () => {
  it("newest system JDK first, then Homebrew's, then Android Studio's", () => {
    const list = (dir: string) => (dir === "/Library/Java/JavaVirtualMachines" ? ["openjdk-17.jdk", "microsoft-21.jdk", "notes.txt"] : []);
    const jdks = macJdks("/Users/u", list);
    expect(jdks[0]).toBe("/Library/Java/JavaVirtualMachines/microsoft-21.jdk/Contents/Home");
    expect(jdks[1]).toBe("/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home");
    expect(jdks).toContain("/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home");
    expect(jdks.at(-1)).toBe("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
  });
});

describe("Hex on a Mac", () => {
  it("runs only on Apple silicon", () => {
    expect(supported("darwin", "arm64")).toBeUndefined();
    expect(supported("darwin", "x64")).toMatch(/Apple silicon/);
  });

  it("reads the release service's manifest the way Hex's updater does", () => {
    const manifest = { release: { version: "3.4.0", targets: { "macos-arm64": { url: "/release/hex/files/abc/Hex.zip", size: 35098476, sha256: "A".repeat(64) } } } };
    expect(manifestTarget(manifest, "macos-arm64")).toEqual({ version: "3.4.0", url: "https://anoma.ly/release/hex/files/abc/Hex.zip", size: 35098476, sha256: "a".repeat(64) });
    expect(() => manifestTarget({ release: { version: "3.4.0", targets: {} } }, "macos-arm64")).toThrow(/no macos-arm64/);
    expect(() => manifestTarget({ release: { version: "3.4.0", targets: { "macos-arm64": { url: "http://x/Hex.zip", size: 1, sha256: "a".repeat(64) } } } }, "macos-arm64")).toThrow(/HTTPS/);
    expect(() => manifestTarget({ release: { version: "3.4.0", targets: { "macos-arm64": { url: "/x", size: 1, sha256: "nope" } } } }, "macos-arm64")).toThrow(/SHA-256/);
  });

  it("finds Hex.app in ~/Applications by its bundle id, not by its name", () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-mac-"));
    const plist = join(home, "Applications", "Hex.app", "Contents", "Info.plist");
    mkdirSync(join(plist, ".."), { recursive: true });
    writeFileSync(plist, "");
    const values: Record<string, string> = { CFBundleIdentifier: "anomaly.hex", CFBundleShortVersionString: "3.4.0" };
    const read = (file: string, key: string) => (file.startsWith(home) ? values[key] : undefined);
    expect(findMacApp(home, read)).toEqual({ version: "3.4.0", exe: join(home, "Applications", "Hex.app") });
    values.CFBundleIdentifier = "com.kitlangton.Hex"; // the old Swift Hex has no local API
    expect(findMacApp(home, read)).toBeUndefined();
  });
});
