// Proves the "app starter kit" step of "Get the tools" for real, into a throwaway folder:
// runs the installer's deps step (builder/cli.mjs warm: npm ci of the template, then a spare app
// folder) with ANYAPP_HOME and ANYAPP_SPARE_DIR pointing at the throwaway folder, then checks it
// with the same detection the app uses.   node dev/prove-deps-warm.mts <folder>
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ToolsInstaller } from "../src/main/install/tools-installer.ts";

const dir = resolve(process.argv[2] ?? "");
if (!process.argv[2] || /\.anyappagent$/i.test(dir)) throw new Error("give a throwaway folder");
mkdirSync(dir, { recursive: true });
process.env.ANYAPP_HOME = join(dir, "home");
process.env.ANYAPP_SPARE_DIR = join(dir, "spare");
const repo = resolve(import.meta.dirname, "..", "..");
const started = Date.now();
let last = "";
const installer = new ToolsInstaller({
  toolsDir: join(dir, "tools"),
  pieces: [{ id: "deps", label: "App starter kit", ok: false }],
  only: ["deps"],
  log: (l) => console.log(new Date().toISOString(), l),
  warm: { cli: join(repo, "builder", "cli.mjs"), probeDir: join(dir, "apps", "warm-probe"), env: { ...process.env } },
  onProgress: (p) => {
    const line = `${Math.round(p.progress * 100)}% ${p.label} ${p.detail ?? ""}`;
    if (line !== last && Math.round(p.progress * 100) % 10 === 0) console.log(new Date().toISOString(), line);
    last = line;
  },
});
await installer.run();
console.log(`warm step finished in ${Math.round((Date.now() - started) / 1000)} s`);
const { detectDeps } = await import("../src/main/detect/deps.ts");
console.log(JSON.stringify(await detectDeps(repo)));
