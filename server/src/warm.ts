// Warms the real builder in the background at startup (`node builder/cli.mjs warm`): fills the
// dependency cache and makes a spare app folder, so creating an app is instant. Then the same for
// the Kotlin preset (`warm --preset kotlin`: a spare, and Gradle's caches warmed once per template).
import { spawn } from "node:child_process";
import { join } from "node:path";
import { REPO_DIR } from "./config.ts";

function warmOne(appsDir: string, preset: "react-native" | "kotlin", log: (message: string) => void, then?: () => void): void {
  const started = Date.now();
  const args = [join(REPO_DIR, "builder", "cli.mjs"), "warm", join(appsDir, "warm-probe"), ...(preset === "kotlin" ? ["--preset", "kotlin"] : [])];
  const child = spawn(process.execPath, args, { cwd: REPO_DIR, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let tail = "";
  const keep = (data: Buffer) => (tail = (tail + data.toString()).slice(-2000));
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  child.on("error", (error) => log(`builder warm-up (${preset}) could not start: ${error.message}`));
  child.on("close", (code) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    if (code === 0) log(`builder warm (${preset}, ${seconds} s): new apps start from a ready copy`);
    else log(`builder warm-up (${preset}) failed after ${seconds} s: ${tail.trim().split(/\r?\n/).at(-1) ?? `exit ${code}`}`);
    then?.();
  });
}

export function warmBuilder(appsDir: string, log: (message: string) => void): void {
  warmOne(appsDir, "react-native", log, () => warmOne(appsDir, "kotlin", log));
}
