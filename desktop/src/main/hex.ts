// Hex 3 (anomalyco/hex, https://anoma.ly/hex/), the free dictation app that turns speech into text
// on this PC. Kiwimake records the microphone itself and asks Hex's authenticated local API to
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
// - Linux (like Ghostex's server/src/managed_tools/hex.rs): Hex keeps its data in
//   $XDG_DATA_HOME/hex (else ~/.local/share/hex), where a direct install links `current` to
//   `versions/<v>` and puts `hex` in ~/.local/bin; a distribution package puts `hex` in /usr/bin.
//   `hex start` opens it. Installing runs Hex's own anoma.ly/hex/install-linux.sh, which checks the
//   release's signature and installs for this user only (no password).
// - macOS (Apple silicon only; Hex is a Mac app first), like Ghostex's managed_tools/hex.rs:
//   Hex keeps its data in ~/Library/Application Support/hex. It is `Hex.app` (bundle id
//   anomaly.hex) in /Applications or ~/Applications. Installing downloads Hex.zip from the Anomaly
//   release service's stable manifest (the source Hex's own updater uses), checks its size,
//   SHA-256, bundle id and the code signature Hex's updater requires (Developer ID, team
//   5NZ4Q7NXJ4, notarized), and puts it in /Applications (~/Applications when that is not
//   writable). No password.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { HexCheck, HexModelView } from "../shared/types.ts";

export const API_VERSION = "2";
export const HEX_SITE = "https://anoma.ly/hex/";
export const WINDOWS_INSTALLER = "https://anoma.ly/hex/install-windows.ps1";
export const LINUX_INSTALLER = "https://anoma.ly/hex/install-linux.sh";
/** The release service's manifest Hex's own Mac updater reads. */
export const MAC_MANIFEST = "https://anoma.ly/release/hex/desktop/stable.json";
const MAC_ORIGIN = "https://anoma.ly";
export const MAC_BUNDLE_ID = "anomaly.hex";
/** What Hex's own updater requires of a new Hex.app (Hex's app/update-requirement.txt, via Ghostex). */
export const MAC_REQUIREMENT = 'anchor apple generic and identifier "anomaly.hex" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "5NZ4Q7NXJ4" and notarized';
/** Hex refuses uploads over 64 MiB. */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const QUICK_MS = 5_000;
const INSTALL_MS = 15 * 60_000;

export const NOT_RUNNING = "Hex isn't running. Open Hex, then try again.";
const REFUSED = "Hex refused the request. Quit and reopen Hex, then try again.";

type Env = Record<string, string | undefined>;

/** Hex's data folder: HEX_APPLICATION_SUPPORT_DIR, else %APPDATA%\hex (Linux: $XDG_DATA_HOME/hex, else ~/.local/share/hex). */
export function supportDir(env: Env, home: string, platform: string = process.platform): string {
  if (env.HEX_APPLICATION_SUPPORT_DIR) return env.HEX_APPLICATION_SUPPORT_DIR;
  if (platform === "linux") return join(env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, ".local", "share"), "hex");
  if (platform === "darwin") return join(home, "Library", "Application Support", "hex");
  return join(env.APPDATA || join(home, "AppData", "Roaming"), "hex");
}

/** Whether Hex 3 ships for this PC (Windows on x64 and arm64; also macOS arm64 and Linux, for dev). */
export function supported(platform: string = process.platform, arch: string = process.arch): string | undefined {
  if (arch !== "x64" && arch !== "arm64") return `Hex has no build for a ${arch} processor.`;
  if (platform === "darwin" && arch !== "arm64") return "Hex runs only on Macs with Apple silicon.";
  if (platform !== "win32" && platform !== "darwin" && platform !== "linux") return "Hex has no build for this system.";
  return undefined;
}

/**
 * The installed version and its program, from a direct install's `current-version` (Windows), or
 * on Linux its `current -> versions/<v>` link.
 */
export function findInstall(dir: string, platform: string = process.platform): { version: string; exe: string } | undefined {
  if (platform === "linux") {
    try {
      // Either separator: Node on Windows (where the tests also run) reads the link back as versions\<v>.
      const version = readlinkSync(join(dir, "current")).trim().replace(/^versions[\\/]/, "").replace(/[\\/]+$/, "");
      if (version) return { version, exe: join(dir, "current", "hex") };
    } catch {
      // no direct install link: look for current-version below
    }
  }
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
  if (Number.isFinite(theirs) && theirs < Number(API_VERSION)) return `This Hex is too old for Kiwimake. Update Hex, then try again.`;
  return `This Hex is newer than Kiwimake knows. Update Kiwimake, then try again.`;
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

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

// `hex --version` answers by path; asked once per path, since Hex is looked for every few seconds.
const packagedSeen = new Map<string, string | null>();

/**
 * Linux: a `hex` on PATH (or in ~/.local/bin, /usr/bin) that a package manager put there. Another
 * program may be called `hex`; Hex's own `--version` starts with its name.
 */
export function findPackaged(env: Env, home: string): { version: string; exe: string } | undefined {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  dirs.push(join(home, ".local", "bin"), "/usr/local/bin", "/usr/bin");
  const exe = dirs.map((d) => join(d, "hex")).find(isFile);
  if (!exe) return undefined;
  if (!packagedSeen.has(exe)) {
    let version: string | null = null;
    try {
      const out = execFileSync(exe, ["--version"], { timeout: 3_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      if (out.toLowerCase().startsWith("hex")) version = /(\d+\.\d+(?:\.\d+)?)/.exec(out)?.[1] ?? "";
    } catch {
      // not Hex, or it didn't answer
    }
    packagedSeen.set(exe, version);
  }
  const version = packagedSeen.get(exe);
  return version === null || version === undefined ? undefined : { version, exe };
}

/** A value from an app's Info.plist (binary or XML), through macOS's own plutil. */
function plistValue(plist: string, key: string): string | undefined {
  const r = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8", timeout: 3_000 });
  return r.status === 0 ? r.stdout.trim() || undefined : undefined;
}

/** The Mac's Hex.app in /Applications or ~/Applications, told apart by its bundle id; exe is the .app. */
export function findMacApp(home: string, read: (plist: string, key: string) => string | undefined = plistValue): { version: string; exe: string } | undefined {
  for (const dir of ["/Applications", join(home, "Applications")]) {
    const app = join(dir, "Hex.app");
    const plist = join(app, "Contents", "Info.plist");
    if (!existsSync(plist)) continue;
    if (read(plist, "CFBundleIdentifier") !== MAC_BUNDLE_ID) continue;
    return { version: read(plist, "CFBundleShortVersionString") ?? "", exe: app };
  }
  return undefined;
}

/** Hex on this PC: a direct install, else (Linux) a packaged `hex`, or (macOS) Hex.app. */
function locate(env: Env, home: string, platform: string): { dir: string; installed?: { version: string; exe: string } } {
  const dir = supportDir(env, home, platform);
  // A Hex whose data folder is set elsewhere (HEX_APPLICATION_SUPPORT_DIR) is not the one in Applications.
  if (platform === "darwin") return { dir, installed: findInstall(dir, platform) ?? (process.platform === "darwin" && !env.HEX_APPLICATION_SUPPORT_DIR ? findMacApp(home) : undefined) };
  const installed = findInstall(dir, platform) ?? (platform === "linux" && process.platform === "linux" ? findPackaged(env, home) : undefined);
  return { dir, installed };
}

/** Where the user stands with Hex on this PC. */
export async function hexState(opts: { env: Env; home: string; savedModel?: string; fetcher?: typeof fetch; platform?: string; arch?: string }): Promise<HexCheck> {
  const unsupported = supported(opts.platform, opts.arch);
  if (unsupported) return { state: "unsupported", summary: unsupported, models: [] };
  const { dir, installed } = locate(opts.env, opts.home, opts.platform ?? process.platform);
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
    throw locate(opts.env, opts.home, process.platform).installed ? new HexFailure("notRunning", NOT_RUNNING) : new HexFailure("notInstalled", "Dictation needs Hex. Install it in Settings, then try again.");
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
  const found = locate(env, home, process.platform).installed;
  if (!found || !existsSync(found.exe)) throw new HexFailure("notInstalled", "Hex isn't installed on this PC.");
  if (process.platform === "darwin") {
    // Hex.app, the way Finder opens it (once; a running Hex just comes forward).
    const child = spawn("/usr/bin/open", [found.exe], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
    return;
  }
  // The Start Menu shortcut Hex's installer makes runs `hex.exe app`; on Linux `hex start` opens it.
  const child = spawn(found.exe, [process.platform === "linux" ? "start" : "app"], { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => undefined);
  child.unref();
}

/** Removes colour codes the installer prints. */
export function stripEscapes(line: string): string {
  return line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
}

/**
 * Runs Hex's own installer (Windows, or Linux) from a new temporary folder. `onLine` gets its
 * output, line by line. Resolves when it finishes; rejects with its last lines when it fails.
 */
export async function installHex(opts: { onLine: (line: string) => void; fetcher?: typeof fetch; signal?: AbortSignal; home?: string }): Promise<void> {
  if (process.platform === "darwin") return installHexMac(opts);
  const linux = process.platform === "linux";
  if (process.platform !== "win32" && !linux) throw new Error(`Kiwimake installs Hex only on Windows and Linux. Download it from ${HEX_SITE}`);
  const res = await (opts.fetcher ?? fetch)(linux ? LINUX_INSTALLER : WINDOWS_INSTALLER, { signal: AbortSignal.timeout(60_000) }).catch(() => {
    throw new Error("Couldn't reach Hex's website. Check the internet connection, then try again.");
  });
  if (!res.ok) throw new Error(`Hex's website answered ${res.status}. Try again later, or download Hex from its website.`);
  const script = await res.text();
  const scratch = mkdtempSync(join(tmpdir(), "anyapp-hex-"));
  const file = join(scratch, linux ? "install-linux.sh" : "install-windows.ps1");
  writeFileSync(file, script);
  const tail: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const child = linux
        ? spawn("/bin/sh", [file, "install"], { cwd: scratch, stdio: ["ignore", "pipe", "pipe"] })
        : spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { cwd: scratch, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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

/** `release.targets[name]` of the release service's manifest, its URL made absolute. Only HTTPS. */
export function manifestTarget(manifest: unknown, name: string, origin = MAC_ORIGIN): { version: string; url: string; size: number; sha256: string } {
  const release = (manifest as { release?: { version?: unknown; targets?: Record<string, { url?: unknown; size?: unknown; sha256?: unknown }> } })?.release;
  const version = typeof release?.version === "string" && release.version ? release.version : undefined;
  if (!version) throw new Error("Hex's release feed names no version.");
  const t = release?.targets?.[name];
  if (typeof t?.url !== "string") throw new Error(`Hex's release feed has no ${name} download.`);
  const url = t.url.startsWith("/") ? `${origin.replace(/\/$/, "")}${t.url}` : t.url;
  if (!url.startsWith("https://")) throw new Error("Hex's release feed gave a download that isn't HTTPS.");
  if (typeof t.size !== "number" || t.size <= 0) throw new Error("Hex's release feed gave no size for the download.");
  if (typeof t.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(t.sha256)) throw new Error("Hex's release feed gave no SHA-256 for the download.");
  return { version, url, size: t.size, sha256: t.sha256.toLowerCase() };
}

const writable = (dir: string) => {
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
};

function runQuiet(cmd: string, args: string[], timeout = 5 * 60_000): boolean {
  return spawnSync(cmd, args, { stdio: "ignore", timeout }).status === 0;
}

/** macOS: Hex.app from Hex's release service, checked like Hex's own updater checks it, into Applications. */
async function installHexMac(opts: { onLine: (line: string) => void; fetcher?: typeof fetch; signal?: AbortSignal; home?: string }): Promise<void> {
  const unsupported = supported();
  if (unsupported) throw new Error(`${unsupported} Download Hex from ${HEX_SITE}`);
  const get = opts.fetcher ?? fetch;
  const res = await get(MAC_MANIFEST, { signal: AbortSignal.timeout(60_000) }).catch(() => {
    throw new Error("Couldn't reach Hex's website. Check the internet connection, then try again.");
  });
  if (!res.ok) throw new Error(`Hex's website answered ${res.status}. Try again later, or download Hex from its website.`);
  const target = manifestTarget(await res.json(), "macos-arm64");
  opts.onLine(`Downloading Hex ${target.version}`);
  const scratch = mkdtempSync(join(tmpdir(), "anyapp-hex-"));
  try {
    const file = await get(target.url, { signal: opts.signal ?? AbortSignal.timeout(INSTALL_MS) }).catch(() => {
      throw new Error("The Hex download didn't finish. Check the internet connection, then try again.");
    });
    if (!file.ok) throw new Error(`Hex's website answered ${file.status}. Try again later.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength !== target.size) throw new Error("The Hex download wasn't the size Hex's release feed gave, so Kiwimake did not install it. Try again.");
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(bytes).digest("hex") !== target.sha256) throw new Error("The Hex download was damaged (checksum mismatch), so Kiwimake did not install it. Try again.");
    const zip = join(scratch, "Hex.zip");
    writeFileSync(zip, bytes);
    opts.onLine("Checking Hex's signature");
    const unpacked = join(scratch, "unpacked");
    const app = join(unpacked, "Hex.app");
    if (!runQuiet("/usr/bin/ditto", ["-x", "-k", zip, unpacked]) || !existsSync(app)) throw new Error("The Hex download didn't contain Hex.app.");
    if (plistValue(join(app, "Contents", "Info.plist"), "CFBundleIdentifier") !== MAC_BUNDLE_ID) throw new Error("The downloaded app isn't Hex, so Kiwimake did not install it.");
    if (!runQuiet("/usr/bin/codesign", ["--verify", "--deep", "--strict", `-R=${MAC_REQUIREMENT}`, app])) throw new Error("The downloaded Hex isn't signed by Hex's developer, so Kiwimake did not install it.");
    // /Applications, or ~/Applications when this account cannot write there (or Hex already lives there).
    const home = opts.home ?? homedir();
    const userApps = join(home, "Applications");
    const appsDir = existsSync(join(userApps, "Hex.app")) || !writable("/Applications") ? userApps : "/Applications";
    mkdirSync(appsDir, { recursive: true });
    const staged = join(appsDir, `.Hex.app.new-${process.pid}`);
    rmSync(staged, { recursive: true, force: true });
    if (!runQuiet("/usr/bin/ditto", [app, staged])) {
      rmSync(staged, { recursive: true, force: true });
      throw new Error(`Kiwimake couldn't write to ${appsDir}. Download Hex from ${HEX_SITE} instead.`);
    }
    const dest = join(appsDir, "Hex.app");
    const running = spawnSync("/usr/bin/pgrep", ["-f", "/Hex.app/Contents/MacOS/"], { encoding: "utf8" }).stdout.trim().length > 0;
    if (running) {
      opts.onLine("Quitting Hex to replace it");
      runQuiet("/usr/bin/osascript", ["-e", `tell application id "${MAC_BUNDLE_ID}" to quit`], 20_000);
    }
    const old = `${dest}.old-${process.pid}`;
    if (existsSync(dest)) renameSync(dest, old);
    renameSync(staged, dest);
    rmSync(old, { recursive: true, force: true });
    opts.onLine(`Hex ${target.version} is installed`);
    runQuiet("/usr/bin/open", [dest], 20_000);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
