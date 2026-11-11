// Hex 3 (anomalyco/hex, https://anoma.ly/hex/), the free dictation app that turns speech into text
// on this PC. AnyAppAgent records the microphone itself and asks Hex's authenticated local API to
// transcribe it, the way Ghostex does (C:\dev\Ghostex: server/src/voice_agent/speech/hex.rs for
// the API, server/src/managed_tools/hex.rs for finding and installing Hex).
//
// - Hex keeps its data in %APPDATA%\hex (or HEX_APPLICATION_SUPPORT_DIR). A direct install writes
//   `current-version` there and puts each version in `versions\<v>\hex.exe`.
// - While it runs, Hex writes `local-api.json` ({port, token, apiVersion, pid}) there. Every request
//   carries `Authorization: Bearer <token>`. GET /health answers {version, apiVersion}, GET /models
//   the catalog, POST /transcriptions?model=…&language=… takes a PCM WAV body and answers
//   {transcript}. The token is never logged or shown.
// - Installing runs Hex's own installer (anoma.ly/hex/install-windows.ps1), which checks the
//   release's Authenticode signature and installs for this user only (no administrator).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HexCheck, HexModelView } from "../shared/types.ts";

export const API_VERSION = "2";
export const HEX_SITE = "https://anoma.ly/hex/";
export const WINDOWS_INSTALLER = "https://anoma.ly/hex/install-windows.ps1";
/** Hex refuses uploads over 64 MiB. */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const QUICK_MS = 5_000;
const INSTALL_MS = 15 * 60_000;

export const NOT_RUNNING = "Hex isn't running. Open Hex, then try again.";
const REFUSED = "Hex refused the request. Quit and reopen Hex, then try again.";

type Env = Record<string, string | undefined>;

/** Hex's data folder: HEX_APPLICATION_SUPPORT_DIR, else %APPDATA%\hex. */
export function supportDir(env: Env, home: string): string {
  if (env.HEX_APPLICATION_SUPPORT_DIR) return env.HEX_APPLICATION_SUPPORT_DIR;
  return join(env.APPDATA || join(home, "AppData", "Roaming"), "hex");
}

/** Whether Hex 3 ships for this PC (Windows on x64 and arm64; also macOS arm64 and Linux, for dev). */
export function supported(platform: string = process.platform, arch: string = process.arch): string | undefined {
  if (arch !== "x64" && arch !== "arm64") return `Hex has no build for a ${arch} processor.`;
  if (platform === "darwin" && arch !== "arm64") return "Hex runs only on Macs with Apple silicon.";
  if (platform !== "win32" && platform !== "darwin" && platform !== "linux") return "Hex has no build for this system.";
  return undefined;
}

/** The installed version and its program, from a direct install's `current-version`. */
export function findInstall(dir: string): { version: string; exe: string } | undefined {
  try {
    const version = readFileSync(join(dir, "current-version"), "utf8").trim();
    if (!version) return undefined;
    const exe = join(dir, "versions", version, process.platform === "win32" ? "hex.exe" : "hex");
    return { version, exe };
  } catch {
    return undefined;
  }
}

export interface Discovery {
  port: number;
  token: string;
  apiVersion: string;
  pid?: number;
}

export type DiscoveryResult = { ok: true; discovery: Discovery } | { ok: false; why: "missing" | "invalid" | "version"; version?: string };

/** Hex's token shape: `hex_` and 64 lowercase hex digits. */
export function validToken(token: unknown): token is string {
  return typeof token === "string" && /^hex_[0-9a-f]{64}$/.test(token);
}

export function parseDiscovery(text: string): DiscoveryResult {
  let d: Partial<Discovery>;
  try {
    d = JSON.parse(text) as Partial<Discovery>;
  } catch {
    return { ok: false, why: "invalid" };
  }
  if (typeof d.apiVersion === "string" && d.apiVersion !== API_VERSION) return { ok: false, why: "version", version: d.apiVersion };
  if (d.apiVersion !== API_VERSION || typeof d.port !== "number" || d.port <= 0 || !validToken(d.token)) return { ok: false, why: "invalid" };
  return { ok: true, discovery: d as Discovery };
}

export function readDiscovery(dir: string): DiscoveryResult {
  const file = join(dir, "local-api.json");
  if (!existsSync(file)) return { ok: false, why: "missing" };
  try {
    return parseDiscovery(readFileSync(file, "utf8"));
  } catch {
    return { ok: false, why: "invalid" };
  }
}

export function versionMessage(version: string): string {
  const theirs = Number.parseInt(version, 10);
  if (Number.isFinite(theirs) && theirs < Number(API_VERSION)) return `This Hex is too old for AnyAppAgent. Update Hex, then try again.`;
  return `This Hex is newer than AnyAppAgent knows. Update AnyAppAgent, then try again.`;
}

export interface HexModel {
  id: string;
  name: string;
  installed?: boolean;
  verified?: boolean;
  managed?: boolean;
  languages?: string[];
  supportsLanguageDetection?: boolean;
}

/** What POST /transcriptions accepts without preparing: a verified download, or an installed system model. */
export const modelReady = (m: HexModel) => !!m.verified || (!!m.managed && !!m.installed);

/** The saved model when it is ready, else Hex's first ready model. */
export function chooseModel(models: HexModel[], saved: string | undefined): HexModel | undefined {
  const ready = models.filter(modelReady);
  return ready.find((m) => m.id === saved) ?? ready[0];
}

export class HexFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** What an answer other than 200 means, in plain words. */
export function statusFailure(status: number, body: string, model: string): HexFailure {
  let code = "";
  try {
    code = String((JSON.parse(body) as { code?: unknown }).code ?? "");
  } catch {
    // not JSON
  }
  if (status === 409 && code === "cancelled") return new HexFailure("busy", "Hex stopped this transcription. Try again.");
  if (status === 409) return new HexFailure("modelNotReady", `${model} isn't ready in Hex. Open Hex and download it there, then try again.`);
  if (status === 401) return new HexFailure("refused", REFUSED);
  if (status === 413) return new HexFailure("badAudio", "That was too long for Hex in one go. Dictate it in shorter parts.");
  if (status === 400 || status === 411 || status === 415) return new HexFailure("badAudio", "Hex couldn't read the recording. Try again.");
  if (status === 429) return new HexFailure("busy", "Hex is busy with another transcription. Wait a moment, then try again.");
  if (status === 503) return new HexFailure("unavailable", "Hex stopped while transcribing. Open Hex, then try again.");
  if (status === 500 && code === "model-load-failed") return new HexFailure("failed", `Hex couldn't load ${model}. Open Hex and check the model, then try again.`);
  if (status === 500) return new HexFailure("failed", "Hex couldn't transcribe this. Try again.");
  return new HexFailure("unavailable", "Hex isn't answering right now. Wait a moment, then try again.");
}

export class HexClient {
  private readonly base: string;
  constructor(
    discovery: Discovery,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.base = `http://127.0.0.1:${discovery.port}`;
    this.auth = `Bearer ${discovery.token}`;
  }
  private readonly auth: string;

  private async call(path: string, init: RequestInit, ms: number): Promise<Response> {
    try {
      return await this.fetcher(`${this.base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: this.auth }, signal: AbortSignal.timeout(ms) });
    } catch (error) {
      const e = error as Error & { cause?: { code?: string } };
      if (e.name === "TimeoutError") throw new HexFailure("timeout", `Hex didn't answer within ${Math.round(ms / 1000)} seconds. Check that Hex works (try dictating in Hex itself), then try again.`);
      // A file left by a Hex that stopped points at a dead port.
      throw new HexFailure("notRunning", NOT_RUNNING);
    }
  }

  async health(): Promise<string> {
    const res = await this.call("/health", {}, QUICK_MS);
    const body = await res.text();
    if (res.status === 401) throw new HexFailure("refused", REFUSED);
    if (res.status !== 200) throw statusFailure(res.status, body, "the model");
    let answer: { version?: string; apiVersion?: string };
    try {
      answer = JSON.parse(body);
    } catch {
      throw new HexFailure("failed", "Hex's answer couldn't be read. Update Hex, then try again.");
    }
    if (answer.apiVersion !== API_VERSION) throw new HexFailure("version", versionMessage(String(answer.apiVersion ?? "")));
    return answer.version ?? "";
  }

  async models(): Promise<HexModel[]> {
    const res = await this.call("/models", {}, QUICK_MS);
    const body = await res.text();
    if (res.status === 401) throw new HexFailure("refused", REFUSED);
    if (res.status !== 200) throw statusFailure(res.status, body, "the model");
    try {
      const list = JSON.parse(body) as HexModel[];
      if (!Array.isArray(list)) throw new Error("not a list");
      return list;
    } catch {
      throw new HexFailure("failed", "Hex's list of models couldn't be read. Update Hex, then try again.");
    }
  }

  async transcribe(model: HexModel, wav: Uint8Array, ms: number): Promise<string> {
    if (wav.byteLength > MAX_UPLOAD_BYTES) throw statusFailure(413, "", model.name);
    // Auto language when the model detects languages; otherwise Hex uses its default (English).
    const lang = model.supportsLanguageDetection ? "&language=auto" : "";
    const res = await this.call(`/transcriptions?model=${encodeURIComponent(model.id)}${lang}`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav as unknown as BodyInit }, ms);
    const body = await res.text();
    if (res.status !== 200) throw statusFailure(res.status, body, model.name);
    try {
      const text = (JSON.parse(body) as { transcript?: unknown }).transcript;
      if (typeof text !== "string") throw new Error("no transcript");
      return text.trim();
    } catch {
      throw new HexFailure("failed", "Hex's answer couldn't be read. Try again.");
    }
  }
}

const view = (m: HexModel): HexModelView => ({ id: m.id, name: m.name });

/** Where the user stands with Hex on this PC. */
export async function hexState(opts: { env: Env; home: string; savedModel?: string; fetcher?: typeof fetch; platform?: string; arch?: string }): Promise<HexCheck> {
  const unsupported = supported(opts.platform, opts.arch);
  if (unsupported) return { state: "unsupported", summary: unsupported, models: [] };
  const dir = supportDir(opts.env, opts.home);
  const installed = findInstall(dir);
  const d = readDiscovery(dir);
  if (!d.ok) {
    if (d.why === "version") return { state: "problem", summary: versionMessage(d.version ?? ""), installedVersion: installed?.version, models: [] };
    // Hex rewrites a damaged file at its next start.
    if (installed) return { state: "notRunning", summary: "Hex is installed but not open.", installedVersion: installed.version, models: [] };
    return { state: "notInstalled", summary: "Hex isn't installed on this PC.", models: [] };
  }
  const client = new HexClient(d.discovery, opts.fetcher);
  try {
    const version = await client.health();
    const models = await client.models();
    const ready = models.filter(modelReady);
    const chosen = chooseModel(models, opts.savedModel);
    if (!chosen) return { state: "noModels", summary: "Hex is open but has no speech model yet.", version, installedVersion: installed?.version, models: [] };
    return { state: "ready", summary: `Hex ${version} is ready.`, version, installedVersion: installed?.version, models: ready.map(view), model: chosen.id };
  } catch (error) {
    const f = error instanceof HexFailure ? error : new HexFailure("failed", (error as Error).message);
    if (f.code === "notRunning") {
      return installed
        ? { state: "notRunning", summary: "Hex is installed but not open.", installedVersion: installed.version, models: [] }
        : { state: "notInstalled", summary: "Hex isn't installed on this PC.", models: [] };
    }
    return { state: "problem", summary: f.message, installedVersion: installed?.version, models: [] };
  }
}

/** Transcribes a WAV recording with the running Hex. Throws a HexFailure with plain words. */
export async function hexTranscribe(opts: { env: Env; home: string; savedModel?: string; wav: Uint8Array; fetcher?: typeof fetch }): Promise<string> {
  const dir = supportDir(opts.env, opts.home);
  const d = readDiscovery(dir);
  if (!d.ok) {
    if (d.why === "version") throw new HexFailure("version", versionMessage(d.version ?? ""));
    throw findInstall(dir) ? new HexFailure("notRunning", NOT_RUNNING) : new HexFailure("notInstalled", "Dictation needs Hex. Install it in Settings, then try again.");
  }
  const client = new HexClient(d.discovery, opts.fetcher);
  await client.health();
  const model = chooseModel(await client.models(), opts.savedModel);
  if (!model) throw new HexFailure("noModels", "Hex has no speech model yet. Open Hex and download one, then try again.");
  // Hex takes a few seconds for a long recording; give it room (1 s per 2 s of audio, at least 60 s).
  const seconds = opts.wav.byteLength / 32_000;
  return client.transcribe(model, opts.wav, Math.max(60_000, seconds * 500 + 30_000));
}

/** Opens the installed Hex (detached, so it keeps running on its own). */
export function openHex(env: Env, home: string): void {
  const found = findInstall(supportDir(env, home));
  if (!found || !existsSync(found.exe)) throw new HexFailure("notInstalled", "Hex isn't installed on this PC.");
  // The Start Menu shortcut Hex's installer makes runs `hex.exe app`.
  const child = spawn(found.exe, ["app"], { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => undefined);
  child.unref();
}

/** Removes colour codes the installer prints. */
export function stripEscapes(line: string): string {
  return line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
}

/**
 * Runs Hex's own Windows installer from a new temporary folder. `onLine` gets its output, line by
 * line. Resolves when it finishes; rejects with its last lines when it fails.
 */
export async function installHex(opts: { onLine: (line: string) => void; fetcher?: typeof fetch; signal?: AbortSignal }): Promise<void> {
  if (process.platform !== "win32") throw new Error(`AnyAppAgent installs Hex only on Windows. Download it from ${HEX_SITE}`);
  const res = await (opts.fetcher ?? fetch)(WINDOWS_INSTALLER, { signal: AbortSignal.timeout(60_000) }).catch(() => {
    throw new Error("Couldn't reach Hex's website. Check the internet connection, then try again.");
  });
  if (!res.ok) throw new Error(`Hex's website answered ${res.status}. Try again later, or download Hex from its website.`);
  const script = await res.text();
  const scratch = mkdtempSync(join(tmpdir(), "anyapp-hex-"));
  const file = join(scratch, "install-windows.ps1");
  writeFileSync(file, script);
  const tail: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { cwd: scratch, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => child.kill(), INSTALL_MS);
      opts.signal?.addEventListener("abort", () => child.kill());
      const onData = (chunk: Buffer) => {
        for (const raw of chunk.toString("utf8").split("\n")) {
          const line = stripEscapes(raw).trim();
          if (!line) continue;
          tail.push(line);
          if (tail.length > 8) tail.shift();
          opts.onLine(line);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`Hex's installer couldn't start: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(tail.slice(-4).join("\n") || `Hex's installer stopped (exit ${code}).`));
      });
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
