// Builds the macOS app (docs/RELEASING.md, macOS): for Apple silicon and Intel, a disk image for
// people (dist/Kiwimake-mac-<arch>.dmg) and a zip for the updater (dist/Kiwimake-mac-<arch>.zip,
// Squirrel.Mac needs it).
//
//   node dev/build-mac.mjs [--arm64|--x64] [--dir] [--adhoc]
//
// By default it is a release build: signed with the Developer ID Application certificate in the
// keychain (hardened runtime, dev/entitlements.mac.plist), the app notarized and stapled by
// electron-builder, then each disk image signed, notarized and stapled here, and everything checked
// with dev/verify-mac.sh. Notarization reads the notarytool profile named by APPLE_KEYCHAIN_PROFILE
// (and APPLE_KEYCHAIN, the keychain that holds it; CI makes both). Without them it stops.
// --adhoc: ad-hoc signed, no hardened runtime, not notarized, for a Mac without the certificate.
//   It opens only after "Open Anyway" in Privacy & Security, and cannot update itself.
// --dir stops at dist/mac-<arch>/Kiwimake.app (no .dmg or .zip), for a quick local test.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Build the Mac app on a Mac.");
const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const archs = args.includes("--arm64") ? ["arm64"] : args.includes("--x64") ? ["x64"] : ["arm64", "x64"];
const adhoc = args.includes("--adhoc");
const dirOnly = args.includes("--dir");
const step = (cmd, list, env = {}) => {
  const r = spawnSync(cmd, list, { cwd: desktop, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${list.join(" ")} failed`);
};

const profile = process.env.APPLE_KEYCHAIN_PROFILE;
const keychain = process.env.APPLE_KEYCHAIN;
if (!adhoc && !dirOnly && !profile) {
  throw new Error("A release build is notarized: set APPLE_KEYCHAIN_PROFILE (xcrun notarytool store-credentials <name> ...), or build with --adhoc.");
}

step("npx", ["electron-vite", "build"]);
const signing = adhoc
  ? ["-c.mac.identity=-", "-c.mac.hardenedRuntime=false", "-c.mac.notarize=false", "-c.dmg.sign=false"]
  : // Fail instead of quietly making an unsigned app when the Developer ID is not in the keychain.
    ["-c.forceCodeSigning=true", ...(dirOnly && !profile ? ["-c.mac.notarize=false"] : [])];
// DRY_RUN_VERSION (the release workflow's dry runs): build as another version, to test an update.
const version = process.env.DRY_RUN_VERSION ? [`-c.extraMetadata.version=${process.env.DRY_RUN_VERSION}`] : [];
step("npx", ["electron-builder", "--mac", ...(dirOnly ? ["--dir"] : []), ...archs.map((a) => `--${a}`), "--publish", "never", ...signing, ...version]);
if (dirOnly) process.exit(0);

if (!adhoc) {
  // electron-builder notarized and stapled the app inside; the disk image itself needs its own ticket,
  // so Gatekeeper accepts it before it is opened, even offline.
  for (const a of archs) {
    const dmg = join(desktop, "dist", `Kiwimake-mac-${a}.dmg`);
    step("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", profile, ...(keychain ? ["--keychain", keychain] : []), "--wait", "--timeout", "45m"]);
    step("xcrun", ["stapler", "staple", dmg]);
  }
}
step("bash", [join(desktop, "dev", "verify-mac.sh"), ...(adhoc ? ["--adhoc"] : []), ...archs]);
for (const a of archs) {
  for (const ext of ["dmg", "zip"]) {
    const file = join(desktop, "dist", `Kiwimake-mac-${a}.${ext}`);
    console.log(`${file}  ${(statSync(file).size / 1024 / 1024).toFixed(1)} MB  sha256 ${createHash("sha256").update(readFileSync(file)).digest("hex")}`);
  }
}
