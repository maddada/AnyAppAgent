#!/usr/bin/env node
// Exports the phone app's over-the-air update from this checkout (docs/RELEASING.md):
//   <out>/android/export/           `expo export` output (Hermes bundle, assets, metadata.json)
//   <out>/android/expo-config.json  the public app config the update carries (Constants.expoConfig)
//   <out>/android/ota.json          platform, runtime version, version, commit and "What's new"
//   <out>/certificate.pem           the certificate the app checks updates with
// scripts/ota-publish.mjs signs and uploads it.
//
//   node scripts/ota-export.mjs <out-dir> [--whats-new '["One short line."]'] [--allow-dirty]
//
// Copied from Ghostex's tooling/release-mobile/ota-export.sh (read only, never imported). It runs
// with KIWIMAKE_RELEASE=1 like `npm run apk -- --release`, so the runtime version here equals the one
// inside the release APK built from the same commit. It refuses a checkout with uncommitted
// changes in the app, shared/ or the Easy Connect bridge (an update is always one commit),
// unless --allow-dirty (local tests only).
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoEmDash, parseWhatsNew, PLATFORM } from "./ota-lib.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const out = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--whats-new"));
if (!out) {
  console.error("usage: node scripts/ota-export.mjs <out-dir> [--whats-new '[\"...\"]'] [--allow-dirty]");
  process.exit(2);
}

const dirty = execFileSync("git", ["-C", REPO_ROOT, "status", "--porcelain", "--", "app", "shared", "server/easy-connect"], { encoding: "utf8" }).trim();
if (dirty && !flag("allow-dirty")) {
  console.error(`ota-export: commit these first (an update is always one commit):\n${dirty}`);
  process.exit(1);
}
const whatsNew = parseWhatsNew(option("whats-new") ?? process.env.KIWIMAKE_OTA_WHATS_NEW);
assertNoEmDash(whatsNew);

const env = { ...process.env, KIWIMAKE_RELEASE: "1", NODE_ENV: "production" };
const outDir = path.resolve(out);
const dir = path.join(outDir, PLATFORM);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const exported = spawnSync(npx, ["expo", "export", "--platform", PLATFORM, "--output-dir", path.join(dir, "export")], { cwd: APP_ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
if (exported.status !== 0) process.exit(exported.status ?? 1);
const config = execFileSync(npx, ["expo", "config", "--type", "public", "--json"], { cwd: APP_ROOT, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32" });
const expoConfig = JSON.parse(config);
writeFileSync(path.join(dir, "expo-config.json"), JSON.stringify(expoConfig));

// The same process environment as app.config.js had, so the runtime versions agree.
Object.assign(process.env, env);
const { otaRuntimeVersion } = createRequire(import.meta.url)("./ota-runtime-version.js");
const runtimeVersion = otaRuntimeVersion(env);
if (expoConfig.android?.runtimeVersion !== runtimeVersion) {
  console.error(`ota-export: app.config.js says runtime ${expoConfig.android?.runtimeVersion}, this script ${runtimeVersion}`);
  process.exit(1);
}
const commit = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const info = { platform: PLATFORM, runtimeVersion, version: expoConfig.version, commit: dirty ? `${commit}-dirty` : commit, whatsNew };
writeFileSync(path.join(dir, "ota.json"), `${JSON.stringify(info, null, 2)}\n`);
copyFileSync(path.join(APP_ROOT, "certs", "certificate.pem"), path.join(outDir, "certificate.pem"));
JSON.parse(readFileSync(path.join(dir, "export", "metadata.json"), "utf8"));
console.log(`Exported the update for Kiwimake ${info.version}, runtime ${runtimeVersion}, commit ${info.commit}, into ${outDir}`);
