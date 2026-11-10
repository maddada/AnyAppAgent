// Copies the tailcat bridge (Easy Connect) into the native module, the Ghostex way:
//   modules/anyapp-native/android/libs/tailcatbridge.jar
//   modules/anyapp-native/android/src/main/jniLibs/{arm64-v8a,x86_64}/libgojni.so
// from %USERPROFILE%\.anyappagent\tools\tailcatbridge\staged (made by
// `node server/easy-connect/build-android-bridge.mjs`, see docs/EASY-CONNECT.md 4.2).
// Only arm64-v8a (phones) and x86_64 (the emulator): each libgojni.so is about 36 MB.
// These files are build output and stay out of Git (app/.gitignore). `npm run apk` runs this first.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staged = process.env.ANYAPP_BRIDGE_DIR ?? join(homedir(), ".anyappagent", "tools", "tailcatbridge", "staged");
const moduleDir = join(root, "modules", "anyapp-native", "android");
const ABIS = ["arm64-v8a", "x86_64"];

// The notification small icon from the shared mark (shared/theme/mark/android/res), every density.
const markRes = join(root, "..", "shared", "theme", "mark", "android", "res");
const DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];

const files = [
  ...DENSITIES.map((d) => [join(markRes, `drawable-${d}`, "ic_stat_anyappagent.png"), join(moduleDir, "src", "main", "res", `drawable-${d}`, "ic_stat_anyappagent.png")]),
  [join(staged, "libs", "tailcatbridge.jar"), join(moduleDir, "libs", "tailcatbridge.jar")],
  ...ABIS.map((abi) => [join(staged, "jniLibs", abi, "libgojni.so"), join(moduleDir, "src", "main", "jniLibs", abi, "libgojni.so")]),
];

const missing = files.filter(([from]) => !existsSync(from)).map(([from]) => from);
if (missing.length) {
  console.error(`The Easy Connect bridge is not built yet. Missing:\n  ${missing.join("\n  ")}`);
  console.error("Build it once with: node ../server/easy-connect/build-android-bridge.mjs (about 10 minutes).");
  process.exit(1);
}

for (const [from, to] of files) {
  const same = existsSync(to) && statSync(to).size === statSync(from).size && statSync(to).mtimeMs >= statSync(from).mtimeMs;
  if (same) continue;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`staged ${to}`);
}
console.log("Easy Connect bridge and notification icon staged.");
