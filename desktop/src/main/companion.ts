// Runs the companion (server/) as a child process and keeps it alive.
//
// How it runs: Electron's own executable in Node mode (ELECTRON_RUN_AS_NODE=1). Electron 45 embeds
// Node 24.22, which runs the companion's TypeScript sources directly, exactly like `node` would.
// So a packaged app needs no Node install and no copy of node.exe. The companion also spawns the
// Claude ACP adapter with process.execPath; that inherits ELECTRON_RUN_AS_NODE, so it works too.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { EventEmitter } from "node:events";
import type { CompanionStatus } from "../shared/types.ts";
import { killTree } from "./exec.ts";

export interface CompanionOptions {
  serverDir: string;
  /** dev/fake-companion.mjs, used when mode is "fake". */
  fakeScript: string;
  mode: "real" | "fake";
  port: number;
  adminToken: string;
  /** Extra environment (JAVA_HOME, ANDROID_HOME, ANYAPP_* overrides). */
  env: () => Record<string, string | undefined>;
  /** Extra PATH entries put in front (tools folder). */
  pathPrefix: () => string[];
  log: (line: string) => void;
}

const STOP_GRACE_MS = 20_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export class Companion extends EventEmitter {
  private child: ChildProcess | undefined;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | undefined;
  private failuresInARow = 0;
  private lastStart = 0;
  private readonly opts: CompanionOptions;
  status: CompanionStatus;

  constructor(opts: CompanionOptions) {
    super();
    this.opts = opts;
    this.status = { phase: "stopped", message: "Not started yet.", mode: opts.mode, port: opts.port, restarts: 0, adminRoutes: false };
  }

  private set(patch: Partial<CompanionStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.status);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    if (this.child) return;
    this.stopping = false;
    const entry = this.opts.mode === "fake" ? this.opts.fakeScript : join(this.opts.serverDir, "bin", "anyappagent.mjs");
    if (!existsSync(entry)) {
      this.set({ phase: "failed", message: "Part of AnyAppAgent is missing. Reinstalling AnyAppAgent fixes this." });
      this.opts.log(`[companion] missing ${entry}`);
      return;
    }
    const base: Record<string, string | undefined> = { ...process.env };
    const pathKey = Object.keys(base).find((k) => k.toLowerCase() === "path") ?? "PATH";
    const prefix = this.opts.pathPrefix().filter(Boolean);
    const env: Record<string, string | undefined> = {
      ...base,
      ...this.opts.env(),
      [pathKey]: [...prefix, base[pathKey] ?? ""].join(delimiter),
      ELECTRON_RUN_AS_NODE: "1",
      ANYAPP_PORT: String(this.opts.port),
      ANYAPP_ADMIN_TOKEN: this.opts.adminToken,
      // Closing its stdin (or this app dying) makes the companion shut down cleanly, Easy Connect
      // helper and Claude sessions included.
      ANYAPP_STOP_ON_STDIN_END: "1",
      // The companion's own console output is for logs only; no colours.
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };
    this.set({ phase: this.status.restarts > 0 ? "restarting" : "starting", message: "Starting…" });
    this.lastStart = Date.now();
    const child = spawn(process.execPath, [entry], {
      cwd: this.opts.mode === "fake" ? undefined : this.opts.serverDir,
      env: env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdin?.on("error", () => {}); // EPIPE after it exits
    this.opts.log(`[companion] started pid ${child.pid} (${this.opts.mode}, port ${this.opts.port})`);
    this.set({ pid: child.pid, startedAt: new Date().toISOString() });
    const onLine = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim() || /^[\s▀▄█]+$/.test(line)) continue; // skip the terminal QR art
        this.opts.log(line);
        if (/Could not listen on/.test(line)) {
          this.set({ message: "Another copy of AnyAppAgent seems to be running on this PC." });
        }
      }
    };
    child.stdout?.on("data", onLine);
    child.stderr?.on("data", onLine);
    child.on("error", (error) => this.opts.log(`[companion] spawn error: ${error.message}`));
    child.on("exit", (code, signal) => {
      this.opts.log(`[companion] exited code=${code} signal=${signal}`);
      if (this.child === child) this.child = undefined;
      if (this.stopping) {
        this.set({ phase: "stopped", message: "Stopped.", pid: undefined });
        return;
      }
      // Ran for a while: a crash, not a start-up failure. Reset the back-off.
      if (Date.now() - this.lastStart > 60_000) this.failuresInARow = 0;
      const wait = BACKOFF_MS[Math.min(this.failuresInARow, BACKOFF_MS.length - 1)];
      this.failuresInARow += 1;
      const portClash = /Another copy/.test(this.status.message);
      this.set({
        phase: this.failuresInARow >= 4 ? "failed" : "restarting",
        message: portClash ? this.status.message : "It stopped unexpectedly. Starting it again…",
        pid: undefined,
        restarts: this.status.restarts + 1,
        adminRoutes: false,
      });
      this.restartTimer = setTimeout(() => {
        this.restartTimer = undefined;
        if (!this.stopping) this.start();
      }, wait);
    });
  }

  /** Marks the companion as answering (called by the admin client once /api/health works). */
  markRunning(adminRoutes: boolean): void {
    if (!this.child) return;
    this.failuresInARow = 0;
    this.set({ phase: "running", message: "Ready.", adminRoutes });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) {
      this.set({ phase: "stopped", message: "Stopped.", pid: undefined });
      return;
    }
    // Close its stdin: with ANYAPP_STOP_ON_STDIN_END=1 it stops its Claude sessions and the Easy
    // Connect helper and exits. Only if it does not exit in time, kill the whole tree.
    const exited = new Promise<boolean>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(true) : child.once("exit", () => resolve(true))));
    child.stdin?.end();
    const clean = await Promise.race([exited, new Promise<boolean>((r) => setTimeout(() => r(false), STOP_GRACE_MS))]);
    if (clean) this.opts.log(`[companion] stopped cleanly (exit code ${child.exitCode})`);
    else {
      this.opts.log(`[companion] did not stop within ${STOP_GRACE_MS / 1000} s; ending its process tree`);
      killTree(child);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
    }
    this.child = undefined;
    this.set({ phase: "stopped", message: "Stopped.", pid: undefined });
  }

  async restart(): Promise<void> {
    await this.stop();
    this.failuresInARow = 0;
    this.start();
  }
}
