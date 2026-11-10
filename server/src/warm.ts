// Warms the real builder in the background at startup (`node builder/cli.mjs warm`): fills the
// dependency cache and makes a spare app folder, so creating an app is instant.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { REPO_DIR } from "./config.ts";

export function warmBuilder(appsDir: string, log: (message: string) => void): void {
  const started = Date.now();
  const child = spawn(process.execPath, [join(REPO_DIR, "builder", "cli.mjs"), "warm", join(appsDir, "warm-probe")], {
    cwd: REPO_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let tail = "";
  const keep = (data: Buffer) => (tail = (tail + data.toString()).slice(-2000));
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  child.on("error", (error) => log(`builder warm-up could not start: ${error.message}`));
  child.on("close", (code) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    if (code === 0) log(`builder warm (${seconds} s): new apps start from a ready copy`);
    else log(`builder warm-up failed after ${seconds} s: ${tail.trim().split(/\r?\n/).at(-1) ?? `exit ${code}`}`);
  });
}
