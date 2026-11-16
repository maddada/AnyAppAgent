// macOS: Mac JDK folders and Hex.app (the PATH from Finder is in shell-env.test.ts).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { macJdks } from "../src/main/detect/tools.ts";
import { findMacApp, manifestTarget, supported } from "../src/main/hex.ts";

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
