// Hex: finding it, its local API (against a fake Hex on a loopback port), and the plain-word states.
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chooseModel, findInstall, hexState, hexTranscribe, parseDiscovery, statusFailure, stripEscapes, supported, validToken } from "../src/main/hex.ts";
import { encodeWav, insertAt } from "../src/renderer/src/dictation.ts";

const TOKEN = `hex_${"a1".repeat(32)}`;
const MODELS = [
  { id: "parakeet_v3", name: "Parakeet v3", verified: false, installed: false },
  { id: "parakeet_unified_en", name: "Parakeet Unified English", verified: true, installed: true },
  { id: "whisper", name: "Whisper", verified: true, installed: true, supportsLanguageDetection: true },
];

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** A fake Hex: answers like Hex's local API and remembers the last transcription request. */
async function fakeHex(opts: { transcribe?: (url: string, body: Buffer) => [number, unknown] } = {}) {
  const seen: { url?: string; auth?: string; type?: string; bytes?: number } = {};
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { code: "unauthorized" });
      if (req.url === "/health") return send(200, { version: "3.3.0", apiVersion: "2" });
      if (req.url === "/models") return send(200, MODELS);
      if (req.url?.startsWith("/transcriptions")) {
        const body = Buffer.concat(chunks);
        Object.assign(seen, { url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], bytes: body.length });
        const [status, answer] = opts.transcribe?.(req.url, body) ?? [200, { transcript: "  make the button green  ", durationMs: 900 }];
        return send(status, answer);
      }
      send(404, { code: "not-found" });
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server!.address() as { port: number }).port;
  return { port, seen };
}

function hexDir(opts: { version?: string; port?: number; apiVersion?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "hex-test-"));
  if (opts.version) {
    writeFileSync(join(dir, "current-version"), `${opts.version}\n`);
    mkdirSync(join(dir, "versions", opts.version), { recursive: true });
    writeFileSync(join(dir, "versions", opts.version, "hex.exe"), "");
  }
  if (opts.port !== undefined) writeFileSync(join(dir, "local-api.json"), JSON.stringify({ port: opts.port, token: TOKEN, apiVersion: opts.apiVersion ?? "2", pid: 1 }));
  return dir;
}

const envFor = (dir: string) => ({ HEX_APPLICATION_SUPPORT_DIR: dir });
const win = { platform: "win32", arch: "x64" };

describe("finding Hex", () => {
  it("reads a direct install's current version", () => {
    const dir = hexDir({ version: "3.4.0" });
    expect(findInstall(dir)?.version).toBe("3.4.0");
    expect(findInstall(dir)?.exe).toContain(join("versions", "3.4.0"));
    expect(findInstall(hexDir())).toBeUndefined();
  });
  it("knows where Hex ships", () => {
    expect(supported("win32", "x64")).toBeUndefined();
    expect(supported("win32", "arm64")).toBeUndefined();
    expect(supported("win32", "ia32")).toMatch(/no build/);
    expect(supported("darwin", "x64")).toMatch(/Apple silicon/);
  });
  it("checks the discovery file and the token's shape", () => {
    expect(validToken(TOKEN)).toBe(true);
    expect(validToken("hex_ABC")).toBe(false);
    expect(parseDiscovery(JSON.stringify({ port: 1, token: TOKEN, apiVersion: "2" })).ok).toBe(true);
    expect(parseDiscovery(JSON.stringify({ port: 1, token: TOKEN, apiVersion: "3" }))).toEqual({ ok: false, why: "version", version: "3" });
    expect(parseDiscovery(JSON.stringify({ port: 1, token: "nope", apiVersion: "2" }))).toEqual({ ok: false, why: "invalid" });
    expect(parseDiscovery("{")).toEqual({ ok: false, why: "invalid" });
  });
});

describe("Hex's state", () => {
  it("not installed, installed but not open, and a dead port", async () => {
    expect((await hexState({ env: envFor(hexDir()), home: "", ...win })).state).toBe("notInstalled");
    expect((await hexState({ env: envFor(hexDir({ version: "3.4.0" })), home: "", ...win })).state).toBe("notRunning");
    // A file left by a Hex that stopped: nothing listens on the port.
    const { port } = await fakeHex();
    server!.close();
    expect((await hexState({ env: envFor(hexDir({ version: "3.4.0", port })), home: "", ...win })).state).toBe("notRunning");
  });
  it("ready, with only the ready models and the saved or first one chosen", async () => {
    const { port } = await fakeHex();
    const dir = hexDir({ version: "3.4.0", port });
    const s = await hexState({ env: envFor(dir), home: "", ...win });
    expect(s.state).toBe("ready");
    expect(s.version).toBe("3.3.0");
    expect(s.models.map((m) => m.id)).toEqual(["parakeet_unified_en", "whisper"]);
    expect(s.model).toBe("parakeet_unified_en");
    expect((await hexState({ env: envFor(dir), home: "", savedModel: "whisper", ...win })).model).toBe("whisper");
    // A saved model that is no longer ready falls back to the first ready one.
    expect(chooseModel(MODELS, "parakeet_v3")?.id).toBe("parakeet_unified_en");
  });
  it("a Hex speaking another API version is refused with what to update", async () => {
    const s = await hexState({ env: envFor(hexDir({ version: "9.0.0", port: 1, apiVersion: "3" })), home: "", ...win });
    expect(s.state).toBe("problem");
    expect(s.summary).toMatch(/Update AnyAppAgent/);
  });
  it("never shows the token", async () => {
    const { port } = await fakeHex();
    const s = await hexState({ env: envFor(hexDir({ version: "3.4.0", port })), home: "", ...win });
    expect(JSON.stringify(s)).not.toContain(TOKEN);
  });
});

describe("transcribing", () => {
  it("posts the WAV with the token and returns the trimmed transcript", async () => {
    const { port, seen } = await fakeHex();
    const wav = new Uint8Array(encodeWav(new Float32Array(16_000), 16_000));
    const text = await hexTranscribe({ env: envFor(hexDir({ version: "3.4.0", port })), home: "", wav });
    expect(text).toBe("make the button green");
    expect(seen.url).toBe("/transcriptions?model=parakeet_unified_en");
    expect(seen.type).toBe("audio/wav");
    expect(seen.bytes).toBe(wav.byteLength);
  });
  it("asks for auto language only from a model that detects languages", async () => {
    const { port, seen } = await fakeHex();
    await hexTranscribe({ env: envFor(hexDir({ version: "3.4.0", port })), home: "", savedModel: "whisper", wav: new Uint8Array(100) });
    expect(seen.url).toBe("/transcriptions?model=whisper&language=auto");
  });
  it("says what to do when Hex can't", async () => {
    const { port } = await fakeHex({ transcribe: () => [409, { code: "model-not-ready" }] });
    await expect(hexTranscribe({ env: envFor(hexDir({ version: "3.4.0", port })), home: "", wav: new Uint8Array(100) })).rejects.toThrow(/isn't ready in Hex/);
    await expect(hexTranscribe({ env: envFor(hexDir({ version: "3.4.0" })), home: "", wav: new Uint8Array(100) })).rejects.toThrow(/Open Hex/);
    await expect(hexTranscribe({ env: envFor(hexDir()), home: "", wav: new Uint8Array(100) })).rejects.toThrow(/Install it in Settings/);
    expect(statusFailure(429, "", "x").message).toMatch(/busy/);
    expect(statusFailure(401, "", "x").code).toBe("refused");
  });
});

describe("helpers", () => {
  it("writes a 16-bit mono WAV header", () => {
    const v = new DataView(encodeWav(new Float32Array([0, 1, -1]), 16_000));
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe("RIFF");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(40, true)).toBe(6);
    expect(v.getInt16(46, true)).toBe(0x7fff);
    expect(v.getInt16(48, true)).toBe(-0x8000);
  });
  it("inserts at the caret with spacing", () => {
    expect(insertAt("", 0, 0, "hello")).toEqual({ value: "hello", caret: 5 });
    expect(insertAt("make it", 7, 7, "green")).toEqual({ value: "make it green", caret: 13 });
    expect(insertAt("make  please", 5, 5, "it green").value).toBe("make it green please");
    expect(insertAt("ab", 1, 1, "x").value).toBe("a x b");
    expect(insertAt("done.", 4, 4, "now").value).toBe("done now.");
  });
  it("strips the installer's colour codes", () => {
    expect(stripEscapes("\x1b[32mInstalled\x1b[0m\r")).toBe("Installed");
  });
});
