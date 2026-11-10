// The Tailcat helper (github.com/tailscale/tailcat), installed and run the way Ghostex does it:
//   install  - Ghostex server/src/tailcat/install.rs: download a private Go toolchain from go.dev
//              (checksum-verified), `go install github.com/tailscale/tailcat/cmd/tailcat@v0.6.0`
//              into our tools folder, check it answers `tailcat version`.
//   key      - Ghostex server/src/tailcat/keys.rs: `tailcat genkey --key=<file> --fixed-region`
//              once; the key IS the address phones dial, so it is never regenerated.
//   serve    - Ghostex server/src/tailcat/supervisor.rs `spawn_tailcat_serve`:
//              `tailcat --verbose serve --full-address --key=<file> [--allow=<keys>|none] <ports>`
//              with TAILCAT_ADDR_FILE=<file> (where the helper writes its address), restarted with
//              backoff when it exits.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const TAILCAT_MODULE = "github.com/tailscale/tailcat/cmd/tailcat@v0.6.0";
export const TAILCAT_MIN_VERSION = [0, 6, 0];
const EXE = process.platform === "win32" ? ".exe" : "";

export interface TailcatPaths {
  toolsDir: string; // %USERPROFILE%\.anyappagent\tools
  dataDir: string; // %USERPROFILE%\.anyappagent\easy-connect (key, address)
}

export function tailcatBinaryPath(paths: TailcatPaths): string {
  return process.env.ANYAPP_TAILCAT_BIN || join(paths.toolsDir, "tailcat", `tailcat${EXE}`);
}

export function goBinaryPath(paths: TailcatPaths): string {
  return join(paths.toolsDir, "go", "bin", `go${EXE}`);
}

/** "v0.6.0" -> true when at least TAILCAT_MIN_VERSION. */
export function versionIsSupported(version: string | null): boolean {
  const match = version?.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== TAILCAT_MIN_VERSION[i]) return parts[i] > TAILCAT_MIN_VERSION[i];
  }
  return true;
}

export function readTailcatVersion(binary: string): string | null {
  if (!existsSync(binary)) return null;
  const result = spawnSync(binary, ["version"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return result.status === 0 && text ? (text.split(/\r?\n/)[0] ?? null) : null;
}

function goOs(): string {
  return process.platform === "win32" ? "windows" : process.platform;
}

function goArch(): string {
  if (process.arch === "x64") return "amd64";
  if (process.arch === "arm64") return "arm64";
  throw new Error(`Easy Connect is not supported on ${process.arch}`);
}

function runQuiet(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (d: Buffer) => (output = (output + d.toString()).slice(-4000)));
    child.stderr?.on("data", (d: Buffer) => (output = (output + d.toString()).slice(-4000)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the installation timed out; check the internet connection and try again"));
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${output.trim()}`));
    });
  });
}

/** Ghostex's download_toolchain: the newest stable Go for this computer, checksum-verified, kept in tools/go. */
export async function ensureGoToolchain(paths: TailcatPaths, progress: (message: string) => void): Promise<string> {
  const go = goBinaryPath(paths);
  if (existsSync(go)) return go;
  progress("Downloading the tools needed to set up Easy Connect…");
  const catalog = (await (await fetch("https://go.dev/dl/?mode=json")).json()) as {
    stable: boolean;
    files: { filename: string; os: string; arch: string; kind: string; sha256: string }[];
  }[];
  const arch = goArch();
  const archive = catalog
    .filter((release) => release.stable)
    .flatMap((release) => release.files)
    .find((file) => file.os === goOs() && file.arch === arch && file.kind === "archive");
  if (!archive || !/^[\w.-]+$/.test(archive.filename)) throw new Error("no Go toolchain was found for this computer");
  const downloads = join(paths.toolsDir, "downloads");
  mkdirSync(downloads, { recursive: true });
  const archivePath = join(downloads, archive.filename);
  const response = await fetch(`https://go.dev/dl/${archive.filename}`);
  if (!response.ok || !response.body) throw new Error(`downloading Go failed (HTTP ${response.status})`);
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(archivePath));
  const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (digest !== archive.sha256) {
    rmSync(archivePath, { force: true });
    throw new Error("the Go download failed its checksum; try again");
  }
  progress("Preparing the Easy Connect build tools…");
  const staging = join(paths.toolsDir, `go-unpack-${Date.now()}`);
  mkdirSync(staging, { recursive: true });
  // Windows' own bsdtar reads zip archives; Git's GNU tar (often first on PATH) does not.
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  await runQuiet(tar, ["-xf", archivePath, "-C", staging], { cwd: staging, timeoutMs: 5 * 60_000 });
  rmSync(join(paths.toolsDir, "go"), { recursive: true, force: true });
  renameSync(join(staging, "go"), join(paths.toolsDir, "go"));
  rmSync(staging, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  return go;
}

/** Ghostex's private-toolchain environment for `go install` / `go build`. */
export function goEnv(paths: TailcatPaths, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GOENV: "off",
    GOWORK: "off",
    GOFLAGS: "-modcacherw",
    GOMAXPROCS: "2",
    GOOS: goOs(),
    GOARCH: goArch(),
    GOROOT: join(paths.toolsDir, "go"),
    GOTOOLCHAIN: "local",
    GOPATH: join(paths.toolsDir, "gopath"),
    GOCACHE: join(paths.toolsDir, "go-cache"),
    CGO_ENABLED: "0",
    ...extra,
  };
}

/** Installs the helper unless a supported one is already there. Returns its path. */
export async function ensureTailcat(paths: TailcatPaths, progress: (message: string) => void): Promise<string> {
  const binary = tailcatBinaryPath(paths);
  if (versionIsSupported(readTailcatVersion(binary))) return binary;
  if (process.env.ANYAPP_TAILCAT_BIN) throw new Error(`ANYAPP_TAILCAT_BIN (${binary}) is not tailcat v0.6.0 or newer`);
  const go = await ensureGoToolchain(paths, progress);
  progress("Building the Easy Connect helper. This can take a few minutes…");
  const out = join(paths.toolsDir, `tailcat-build-${Date.now()}`);
  mkdirSync(out, { recursive: true });
  await runQuiet(go, ["install", TAILCAT_MODULE], {
    cwd: paths.toolsDir,
    env: goEnv(paths, { GOBIN: out }),
    timeoutMs: 15 * 60_000,
  });
  const built = join(out, `tailcat${EXE}`);
  if (!versionIsSupported(readTailcatVersion(built))) throw new Error("the built helper did not answer its version check");
  mkdirSync(join(paths.toolsDir, "tailcat"), { recursive: true });
  renameSync(built, binary);
  rmSync(out, { recursive: true, force: true });
  return binary;
}

export function serverKeyFile(paths: TailcatPaths): string {
  return join(paths.dataDir, "server.private.json");
}

export function addressFile(paths: TailcatPaths): string {
  return join(paths.dataDir, "address.txt");
}

function pidFile(paths: TailcatPaths): string {
  return join(paths.dataDir, "helper.pid");
}

/** A helper left running by a companion that was killed outright would serve the same key twice. */
function killLeftoverHelper(paths: TailcatPaths): void {
  const file = pidFile(paths);
  if (!existsSync(file)) return;
  const pid = Number(readFileSync(file, "utf8").trim());
  rmSync(file, { force: true });
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    const list = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
    if (/tailcat/i.test(list.stdout ?? "")) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (/tailcat/.test(cmdline)) process.kill(pid, "SIGTERM");
    } catch {}
  }
}

/** Ghostex keys.rs ensure_tailcat_key_file: created once, never regenerated. */
export function ensureServerKey(binary: string, paths: TailcatPaths): void {
  const keyFile = serverKeyFile(paths);
  if (existsSync(keyFile)) return;
  mkdirSync(paths.dataDir, { recursive: true });
  const result = spawnSync(binary, ["genkey", `--key=${keyFile}`, "--fixed-region"], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  if (result.status !== 0 || !existsSync(keyFile)) {
    throw new Error(`tailcat genkey failed: ${(result.stderr || result.stdout || "").trim().split(/\r?\n/).at(-1) ?? ""}`);
  }
}

/** Ghostex supervisor.rs served_allow_list: no keys -> "none" (closed), never open. */
export function allowArgument(allowedKeys: string[], pairingWindowOpen: boolean): string | null {
  if (pairingWindowOpen) return null;
  const keys = allowedKeys.filter((key) => key.trim() !== "");
  return keys.length > 0 ? keys.join(",") : "none";
}

export interface ServeSpec {
  binary: string;
  port: number;
  allow: string | null; // null = any client (pairing window)
}

/** Never let the address (it carries the tunnel's pre-shared key) reach a log. */
export function redactAddresses(text: string): string {
  return text.replace(/\btc[A-Za-z0-9_-]{24,}/g, "tc…");
}

/** One `tailcat serve`, restarted with backoff when it exits on its own. */
export class TailcatServer {
  private child: ChildProcess | undefined;
  private spec: ServeSpec | undefined;
  private stopped = true;
  private backoffMs = 1000;
  private startedAt = 0;
  private restartTimer: NodeJS.Timeout | undefined;
  private stderrTail: string[] = [];
  address: string | null = null;
  private readonly paths: TailcatPaths;
  private readonly onAddress: (address: string | null) => void;
  private readonly onExit: (message: string) => void;
  private readonly log: (message: string) => void;

  constructor(options: {
    paths: TailcatPaths;
    onAddress: (address: string | null) => void;
    onExit: (message: string) => void;
    log: (message: string) => void;
  }) {
    this.paths = options.paths;
    this.onAddress = options.onAddress;
    this.onExit = options.onExit;
    this.log = options.log;
  }

  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null;
  }

  /** Starts, or restarts when the spec changed (Ghostex reconcile_lane). */
  apply(spec: ServeSpec, reason: string): void {
    if (!this.stopped && this.spec && JSON.stringify(this.spec) === JSON.stringify(spec) && this.running) return;
    this.stopped = false;
    this.spec = spec;
    this.kill();
    this.launch(reason);
  }

  private launch(reason: string): void {
    const spec = this.spec;
    if (!spec || this.stopped) return;
    const addrFile = addressFile(this.paths);
    killLeftoverHelper(this.paths);
    rmSync(addrFile, { force: true });
    this.address = null;
    const args = ["--verbose", "serve", "--full-address", `--key=${serverKeyFile(this.paths)}`];
    if (spec.allow !== null) args.push(`--allow=${spec.allow}`);
    args.push(String(spec.port));
    this.log(`Easy Connect helper starting (${reason}; ${spec.allow === null ? "pairing window open" : spec.allow === "none" ? "no devices allowed yet" : `${spec.allow.split(",").length} device(s) allowed`})`);
    const child = spawn(spec.binary, args, {
      env: { ...process.env, TAILCAT_ADDR_FILE: addrFile },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    if (child.pid !== undefined) writeFileSync(pidFile(this.paths), String(child.pid));
    this.startedAt = Date.now();
    this.stderrTail = [];
    child.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (line.trim() === "") continue;
        this.stderrTail.push(redactAddresses(line));
        if (this.stderrTail.length > 30) this.stderrTail.shift();
      }
    });
    const poll = setInterval(() => {
      if (this.child !== child) return clearInterval(poll);
      if (existsSync(addrFile) && statSync(addrFile).size > 0) {
        const address = readFileSync(addrFile, "utf8").trim();
        if (address) {
          clearInterval(poll);
          this.address = address;
          this.onAddress(address);
        }
      }
    }, 200);
    child.on("exit", (code) => {
      clearInterval(poll);
      if (this.child !== child) return;
      this.child = undefined;
      this.address = null;
      if (this.stopped) return;
      const detail = this.stderrTail.slice(-3).join(" | ");
      this.onExit(`The Easy Connect helper stopped (exit ${code ?? "?"})${detail ? `: ${detail}` : ""}`);
      if (Date.now() - this.startedAt > 30_000) this.backoffMs = 1000;
      this.restartTimer = setTimeout(() => this.launch("restartAfterExit"), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    });
  }

  private kill(): void {
    rmSync(pidFile(this.paths), { force: true });
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.pid === undefined) return;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill("SIGTERM");
  }

  stop(): void {
    this.stopped = true;
    this.spec = undefined;
    this.kill();
    this.address = null;
  }
}
