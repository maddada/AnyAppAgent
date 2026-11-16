// Stage the companion from its lockfile. Never copy the developer's node_modules.
const { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { join, resolve, relative, sep } = require("node:path");
const { spawnSync } = require("node:child_process");

function keepRuntime(file) {
  const parts = file.replace(/\\/g, "/").split("/");
  const name = parts.at(-1);
  if (/license|notice|^readme|^agents\.md$/i.test(name)) return true;
  if (/\.map$|\.d\.[cm]?ts$/i.test(name)) return false;
  if (parts.some((p) => /^(tests?|__tests__|examples?|coverage|docs|\.vitest-cache)$/i.test(p))) return false;
  return true;
}
exports.keepRuntime = keepRuntime;

function materializeLinks(destRoot, srcRoot) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        rmSync(file, { force: true });
        if (!dir.endsWith(`${sep}.bin`)) cpSync(realpathSync(join(srcRoot, relative(destRoot, file))), file, { recursive: true, dereference: true });
      } else if (entry.isDirectory()) walk(file);
    }
  };
  walk(destRoot);
}
exports.materializeLinks = materializeLinks;
exports.default = async function afterPack(context) {
  const repo = resolve(__dirname, "..", "..");
  const output = resolve(context.appOutDir, "..", "runtime-stage");
  mkdirSync(output, { recursive: true });
  const stage = mkdtempSync(join(output, "prod-"));
  for (const file of ["package.json", "package-lock.json"]) cpSync(join(repo, "server", file), join(stage, file));
  // Native optional dependencies remain enabled. Only Claude's executable is removed below.
  // macOS builds arm64 and x64 on one Mac: install the optional packages of the arch being packed.
  const mac = context.electronPlatformName === "darwin";
  const arch = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" }[context.arch];
  const cross = mac && arch && arch !== "universal" ? [`--cpu=${arch}`, "--os=darwin"] : [];
  const ci = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", ...cross], {
    cwd: stage, stdio: "inherit", shell: process.platform === "win32", windowsHide: true,
  });
  if (ci.status !== 0) throw new Error("Companion production staging failed");
  const nm = join(stage, "node_modules");
  const removed = { claude: 0, prune: 0 };
  function prune(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) { prune(file); continue; }
      const rel = relative(nm, file).replace(/\\/g, "/");
      const engine = /(?:^|\/)@anthropic-ai\/claude-agent-sdk-[^/]+\/claude(?:\.exe)?$/.test(rel);
      if (engine || !keepRuntime(rel)) {
        removed[engine ? "claude" : "prune"] += statSync(file).size;
        rmSync(file);
      }
    }
  }
  prune(nm);
  // Windows and Linux: <out>/resources; macOS: <out>/Kiwimake.app/Contents/Resources.
  const resources = mac ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources") : join(context.appOutDir, "resources");
  const dest = join(resources, "companion", "server", "node_modules");
  cpSync(nm, dest, { recursive: true, dereference: true });
  // On the macos-15 runner (Node 24) cpSync kept node_modules/.bin links despite dereference, pointing
  // into the staging folder deleted below, and codesign stopped at the broken link. No link may stay:
  // each becomes a copy of what it points to. .bin links just go (the companion starts its tools by
  // package path, never through node_modules/.bin).
  materializeLinks(dest, nm);
  const companion = join(resources, "companion");
  const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", [
    "./server/src/acp/session.ts", "./server/src/config.ts", "./builder/index.mjs",
  ].map((p) => `await import(${JSON.stringify(require("node:url").pathToFileURL(join(companion, p)).href)});`).join("\n")], {
    cwd: companion, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", windowsHide: true,
  });
  if (smoke.status !== 0) throw new Error(`Staged runtime import failed: ${smoke.stderr}`);
  writeFileSync(join(context.appOutDir, "..", mac ? `runtime-cuts-${arch}.json` : "runtime-cuts.json"), JSON.stringify(removed, null, 2));
  if (!resolve(stage).startsWith(output + sep)) throw new Error("Invalid staging path");
  rmSync(stage, { recursive: true, force: true });
};
