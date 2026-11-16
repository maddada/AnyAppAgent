// Builds the macOS app: dist/Kiwimake-mac-arm64.dmg (Apple silicon) and dist/Kiwimake-mac-x64.dmg
// (Intel), ad-hoc signed and not notarized (no Apple Developer ID yet; docs/RELEASING.md, macOS).
//   node dev/build-mac.mjs [--arm64|--x64] [--dir]
// --dir stops at dist/mac-arm64/Kiwimake.app (no .dmg), for a quick local test.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Build the Mac app on a Mac.");
const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const archs = args.includes("--arm64") ? ["arm64"] : args.includes("--x64") ? ["x64"] : ["arm64", "x64"];
const step = (cmd, list) => {
  const r = spawnSync(cmd, list, { cwd: desktop, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${list.join(" ")} failed`);
};
step("npx", ["electron-vite", "build"]);
step("npx", ["electron-builder", "--mac", ...(args.includes("--dir") ? ["--dir"] : []), ...archs.map((a) => `--${a}`), "--publish", "never"]);
if (!args.includes("--dir")) {
  for (const a of archs) {
    const file = join(desktop, "dist", `Kiwimake-mac-${a}.dmg`);
    const bytes = readFileSync(file);
    console.log(`${file}  ${(statSync(file).size / 1024 / 1024).toFixed(1)} MB  sha256 ${createHash("sha256").update(bytes).digest("hex")}`);
  }
}
