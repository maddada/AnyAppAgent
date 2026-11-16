#!/usr/bin/env node
/* global __dirname, Buffer */
/**
 * The runtime version of an over-the-air update (docs/RELEASING.md, "Over-the-air updates"): a hash
 * of every input that ends up as native code in the Kiwimake APK. expo-updates only gives an update
 * to an APK with the same runtime version, so this must change whenever the JavaScript could meet
 * native code it was not built against.
 *
 * Copied from Ghostex's apps/mobile/app/scripts/ota-runtime-version.js (read only, never imported):
 * an explicit list of git-tracked sources, hashed from disk, instead of Expo's automatic
 * fingerprint. The Easy Connect bridge (Go, server/easy-connect) is built outside this folder and
 * staged into git-ignored folders (scripts/stage-bridge.mjs), so the fingerprint would hash whatever
 * build output happens to be on the PC; hashing its sources gives the same answer on every PC.
 *
 * Kiwimake bumps `version` and `versionCode` in app.json, package.json and package-lock.json with
 * every release. They do not change what the JavaScript can call, so they are left out: a release
 * that changes only JavaScript keeps the runtime version, and its update reaches the APKs already
 * on phones. Fonts and the launcher and notification icons are native resources, so they count.
 *
 * app.config.js calls it for release builds, and scripts/ota-export.mjs for update exports; both
 * run from the same checkout, so they agree. `node scripts/ota-runtime-version.js [--explain]`
 * prints it (and, with --explain, how many files each input contributed).
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/** The hashing rules' version: bump it whenever this script changes what a runtime version means. */
const FORMAT = 1;

const APP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");

/** Hashed by their native view (nativeView), not their bytes. */
const VERSIONED_JSON = ["app/app.json", "app/package.json", "app/package-lock.json"];

/** Pathspecs from the repository root. */
const INPUTS = [
  ...VERSIONED_JSON,
  "app/app.config.js",
  "app/certs",
  "app/scripts/build-apk.mjs",
  "app/scripts/release.init.gradle",
  "app/scripts/stage-bridge.mjs",
  ":(glob)app/modules/*/expo-module.config.json",
  ":(glob)app/modules/*/package.json",
  ":(glob)app/modules/*/android/**",
  // The Easy Connect bridge the native module carries (Go sources and its build).
  "server/easy-connect",
  // Native resources: the launcher, adaptive and notification icons, and the fonts expo-font embeds.
  "shared/theme/mark/android",
  "shared/theme/fonts",
];

/** JSON with object keys sorted, so reformatting or reordering changes nothing. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The file without the release version fields (they change with every release, not the native code). */
function nativeView(file, text) {
  const json = JSON.parse(text);
  if (file === "app/app.json") {
    const expo = { ...json.expo, android: { ...json.expo.android } };
    delete expo.version;
    delete expo.android.versionCode;
    return { ...json, expo };
  }
  if (file === "app/package.json") {
    const { version: _version, ...rest } = json;
    return rest;
  }
  // package-lock.json: the root package's version, at the top and under packages[""].
  const { version: _version, ...rest } = json;
  if (rest.packages && rest.packages[""]) {
    const { version: _rootVersion, ...root } = rest.packages[""];
    rest.packages = { ...rest.packages, "": root };
  }
  return rest;
}

function trackedFiles(pathspecs) {
  const output = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "-z", "--", ...pathspecs], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter(Boolean);
}

function fileDigest(file) {
  const full = path.join(REPO_ROOT, file);
  if (!fs.existsSync(full)) return "deleted";
  const stat = fs.lstatSync(full);
  if (VERSIONED_JSON.includes(file)) {
    return crypto.createHash("sha256").update(canonicalJson(nativeView(file, fs.readFileSync(full, "utf8")))).digest("hex");
  }
  const bytes = stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(full)) : fs.readFileSync(full);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Native choices app.config.js makes from the environment: a test build with its own package
 * (ANYAPP_ANDROID_PACKAGE) never shares updates with com.anyappagent.
 */
function settings(env = process.env) {
  return { package: env.ANYAPP_ANDROID_PACKAGE || "com.anyappagent" };
}

function otaRuntimeInputs(env = process.env) {
  return { files: trackedFiles(INPUTS), settings: settings(env) };
}

function otaRuntimeVersion(env = process.env) {
  const { files, settings: s } = otaRuntimeInputs(env);
  const hash = crypto.createHash("sha256");
  hash.update(`kiwimake-ota-runtime ${FORMAT} android ${JSON.stringify(s)}\n`);
  for (const file of [...files].sort()) hash.update(`${file}\0${fileDigest(file)}\n`);
  return hash.digest("hex").slice(0, 16);
}

module.exports = { otaRuntimeVersion, otaRuntimeInputs };

if (require.main === module) {
  if (process.argv.includes("--explain")) {
    const { files, settings: s } = otaRuntimeInputs();
    for (const spec of INPUTS) console.error(`${spec}: ${trackedFiles([spec]).length} files`);
    console.error(`${files.length} files in all, settings ${JSON.stringify(s)}`);
  }
  console.log(otaRuntimeVersion());
}
