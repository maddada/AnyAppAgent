// Proves the tools installer for real into a throwaway folder (never the user's tools folder):
//   node dev/prove-tools-install.mts <folder> [--quick]
// --quick installs only platform-tools from the SDK (minutes instead of the full ~2.5 GB).
// It pretends nothing is installed, runs every step, then runs the same detection the app uses.
import { mkdirSync } from "node:fs";
import { ToolsInstaller } from "../src/main/install/tools-installer.ts";
import { detectTools } from "../src/main/detect/tools.ts";
import { run } from "../src/main/exec.ts";

const dir = process.argv[2];
if (!dir || /\.anyappagent[\/]tools/i.test(dir)) throw new Error("give a throwaway folder (not the real tools folder)");
const quick = process.argv.includes("--quick");
// --only=<id>,<id> runs just those installer steps (e.g. --only=sdk:cmake;3.30.5,ninja).
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
mkdirSync(dir, { recursive: true });
const nothing = (["jdk", "sdk", "node", "git"] as const).map((id) => ({ id, label: id, ok: false }));
const started = Date.now();
let last = "";
const installer = new ToolsInstaller({
  toolsDir: dir,
  pieces: nothing,
  sdkPackages: quick ? ["platform-tools"] : undefined,
  only,
  log: (l) => console.log(new Date().toISOString(), l),
  onProgress: (p) => {
    const line = `${Math.round(p.progress * 100)}% ${p.label}${p.detail ? ` (${p.detail})` : ""}`;
    if (line.replace(/\(.*\)/, "") !== last.replace(/\(.*\)/, "") || Math.random() < 0.02) console.log(new Date().toISOString(), line);
    last = line;
  },
});
await installer.run();
console.log(`installed in ${Math.round((Date.now() - started) / 1000)} s`);
// Detection against ONLY the throwaway folder: empty PATH and env so nothing on this PC is found.
const check = await detectTools({ toolsDir: dir, env: { PATH: "", SystemRoot: process.env.SystemRoot }, runner: run });
console.log(JSON.stringify(check, null, 2));
