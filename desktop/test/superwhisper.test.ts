// Superwhisper on Linux: finding its command, and a transcription through a fake `superwhisper`.
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findInstall, supportDir } from "../src/main/hex.ts";
import { superwhisperBinary, superwhisperTranscribe } from "../src/main/superwhisper.ts";

const wav = new Uint8Array(44 + 32_000);

describe("finding Superwhisper", () => {
  it("only on Linux, on PATH or in ~/.local/bin", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-home-"));
    expect(superwhisperBinary({ PATH: "" }, home, "win32")).toBeUndefined();
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const bin = join(home, ".local", "bin", "superwhisper");
    writeFileSync(bin, "#!/bin/sh\n");
    expect(superwhisperBinary({ PATH: "" }, home, "linux")).toBe(bin);
  });
});

describe("Superwhisper transcribes", () => {
  const env = { PATH: "/nowhere" };
  const home = mkdtempSync(join(tmpdir(), "sw-home-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const bin = join(home, ".local", "bin", "superwhisper");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);
  const linux = process.platform === "linux" ? it : it.skip;

  linux("waits for its session's text, ignoring the dictation from before", async () => {
    const calls: string[][] = [];
    let reads = 0;
    const run = async (_b: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "transcribe") return { ok: true, session_id: 7 };
      reads++;
      if (reads === 1) return { session_id: 6, text: "old words" };
      if (reads === 2) return { session_id: 6, text: "old words" };
      return { session_id: 7, text: "  make the button green  " };
    };
    expect(await superwhisperTranscribe({ env, home, wav, run })).toBe("make the button green");
    expect(calls[1][0]).toBe("transcribe");
    // Never --insert: Superwhisper must not paste or touch the clipboard.
    expect(calls.flat()).not.toContain("--insert");
  });

  linux("no speech is an empty dictation, and a refused file says so", async () => {
    let reads = 0;
    const quiet = async (_b: string, args: string[]) => {
      if (args[0] === "transcribe") return { ok: true, session_id: 2 };
      return ++reads === 1 ? { session_id: 1, text: "before" } : { session_id: 2, text: "", warning: "No speech detected" };
    };
    expect(await superwhisperTranscribe({ env, home, wav, run: quiet })).toBe("");
    const refused = async (_b: string, args: string[]) => {
      if (args[0] === "transcribe") throw new Error("couldn't decode audio");
      return {};
    };
    await expect(superwhisperTranscribe({ env, home, wav, run: refused })).rejects.toThrow(/couldn't read the recording/);
  });
});

describe("Hex on Linux", () => {
  it("lives in XDG_DATA_HOME or ~/.local/share, and a direct install links current to its version", () => {
    expect(supportDir({}, "/home/u", "linux")).toBe(join("/home/u", ".local", "share", "hex"));
    expect(supportDir({ XDG_DATA_HOME: "/data" }, "/home/u", "linux")).toBe(join("/data", "hex"));
    expect(supportDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "/home/u", "win32")).toBe(join("C:\\Users\\u\\AppData\\Roaming", "hex"));
    const dir = mkdtempSync(join(tmpdir(), "hex-linux-"));
    mkdirSync(join(dir, "versions", "3.4.0"), { recursive: true });
    symlinkSync("versions/3.4.0", join(dir, "current"));
    expect(findInstall(dir, "linux")).toEqual({ version: "3.4.0", exe: join(dir, "current", "hex") });
    expect(findInstall(dir, "win32")).toBeUndefined();
  });
});
