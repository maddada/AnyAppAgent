// Sign-in flows without a terminal.
//
// Claude: the ACP adapter offers `claude-agent-acp --cli auth login --claudeai` as its "terminal"
// auth method; that only forwards to the Claude CLI's `auth login --claudeai`. We run that CLI
// directly, hidden, with a pipe for stdin. It opens the default browser on the sign-in page (with a
// localhost callback, so finishing in the browser completes it) and prints a fallback link that
// shows a code to paste; the app shows "Open the page again" and a box for that code.
//
// GitHub: `gh auth login --web` without a terminal prints the one-time code and the device URL and
// polls on its own (it does not wait for Enter or open a browser). The app shows the code large,
// opens https://github.com/login/device, and waits for gh to exit. After a sign-in made here, it
// runs `gh auth setup-git` so the companion's `git push` uses the account. An existing sign-in is
// never changed.
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { killTree, run, spawnHidden } from "./exec.ts";
import { extractLoginUrl } from "./detect/claude.ts";
import { ghAssetName, parseDeviceFlow } from "./detect/github.ts";
import { download, extractZip, fetchJson } from "./install/download.ts";

export class ClaudeSignIn extends EventEmitter {
  private child: ChildProcess | undefined;
  url: string | undefined;
  running = false;
  error: string | undefined;

  start(cli: string): void {
    if (this.child) return;
    this.error = undefined;
    this.url = undefined;
    this.running = true;
    let output = "";
    const child = spawnHidden(cli, ["auth", "login", "--claudeai"], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    this.child = child;
    child.stdin?.on("error", () => {});
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
      const url = extractLoginUrl(output);
      if (url && url !== this.url) {
        this.url = url;
        this.emit("change");
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => {
      this.error = e.message;
      this.finish();
    });
    child.on("exit", (code) => {
      if (code !== 0 && code !== null && !this.error) {
        const last = output.replace(/\u001b\][^\u0007]*\u0007|\u001b\[[0-9;]*m/g, "").trim().split(/\r?\n/).filter(Boolean).pop();
        this.error = last && !/^https?:/.test(last) ? last : "The sign-in did not finish.";
      }
      this.finish();
    });
    this.emit("change");
  }

  /** The code shown by the fallback page, typed or pasted into the app. */
  submitCode(code: string): void {
    this.child?.stdin?.write(`${code.trim()}\n`);
  }

  cancel(): void {
    killTree(this.child);
    this.finish();
  }

  private finish(): void {
    this.child = undefined;
    this.running = false;
    this.emit("change");
    this.emit("done");
  }
}

export interface GitHubFlowState {
  phase: "downloading" | "starting" | "code" | "waiting" | "finishing";
  code?: string;
  url?: string;
  progress?: number;
}

export class GitHubSignIn extends EventEmitter {
  private child: ChildProcess | undefined;
  private abort: AbortController | undefined;
  flow: GitHubFlowState | undefined;
  error: string | undefined;

  constructor(private readonly toolsDir: string) {
    super();
  }

  private set(flow: GitHubFlowState | undefined): void {
    this.flow = flow;
    this.emit("change");
  }

  /** Downloads the official portable gh into <tools>/gh (only when the PC has none). */
  async downloadGh(): Promise<string> {
    this.abort = new AbortController();
    this.set({ phase: "downloading", progress: 0 });
    const rel = await fetchJson<{ tag_name: string; assets: { name: string; browser_download_url: string; digest?: string }[] }>(
      "https://api.github.com/repos/cli/cli/releases/latest",
      this.abort.signal,
    );
    const name = ghAssetName(rel.tag_name);
    const asset = rel.assets.find((a) => a.name === name);
    if (!asset) throw new Error("Could not find the GitHub helper download.");
    const zip = join(this.toolsDir, "downloads", name);
    await download({
      url: asset.browser_download_url,
      dest: zip,
      signal: this.abort.signal,
      checksum: asset.digest,
      onProgress: (r, t) => this.set({ phase: "downloading", progress: t ? r / t : 0 }),
    });
    await extractZip(zip, join(this.toolsDir, "gh"), { flatten: false });
    const gh = join(this.toolsDir, "gh", "bin", "gh.exe");
    if (!existsSync(gh)) throw new Error("The GitHub helper did not unpack.");
    return gh;
  }

  async start(gh: string | undefined): Promise<void> {
    if (this.child || this.flow) return;
    this.error = undefined;
    try {
      const path = gh ?? (await this.downloadGh());
      this.set({ phase: "starting" });
      let output = "";
      const child = spawnHidden(path, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      this.child = child;
      child.stdin?.on("error", () => {});
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        const { code, url } = parseDeviceFlow(output);
        if (code && this.flow?.phase === "starting") this.set({ phase: "code", code, url: url ?? "https://github.com/login/device" });
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      await new Promise<void>((resolve) => {
        child.on("error", (e) => {
          this.error = e.message;
          resolve();
        });
        child.on("exit", (code) => {
          if (code !== 0 && !this.error && this.flow) this.error = "The GitHub sign-in did not finish. You can try again, or skip it.";
          resolve();
        });
      });
      this.child = undefined;
      if (!this.error && this.flow) {
        this.set({ ...(this.flow as GitHubFlowState), phase: "finishing" });
        // Only for a sign-in made here: let git use this account for the app backups.
        await run(path, ["auth", "setup-git", "--hostname", "github.com"], { timeoutMs: 20_000 });
      }
    } catch (error) {
      if (this.flow) this.error = (error as Error).message;
    } finally {
      this.child = undefined;
      this.set(undefined);
      this.emit("done");
    }
  }

  /** Marks that the user opened the page (so the UI can say "waiting for you to finish"). */
  opened(): void {
    if (this.flow?.phase === "code") this.set({ ...this.flow, phase: "waiting" });
  }

  cancel(): void {
    this.abort?.abort();
    killTree(this.child);
    this.child = undefined;
    this.flow = undefined;
    this.emit("change");
  }
}
