// npm run apk  ->  builds the installable AnyAppAgent APK (release variant, JS bundled inside,
// no dev server needed) and prints its path.
//
//   npm run apk               # reuses android/ if it exists
//   npm run apk -- --clean    # regenerates android/ from app.json first (after config changes)
//
// Uses JAVA_HOME / ANDROID_HOME from the environment, else this PC's defaults from
// docs/ENVIRONMENT.md (D:\tools\android\jdk, D:\tools\android\sdk).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const clean = process.argv.includes("--clean");

const JAVA_HOME = process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME) ? process.env.JAVA_HOME : "D:\tools\android\jdk";
const ANDROID_HOME = process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME) ? process.env.ANDROID_HOME : "D:\tools\android\sdk";
const env = {
  ...process.env,
  JAVA_HOME,
  ANDROID_HOME,
  ANDROID_SDK_ROOT: ANDROID_HOME,
  NODE_ENV: "production",
  PATH: [join(JAVA_HOME, "bin"), join(ANDROID_HOME, "platform-tools"), process.env.PATH].join(delimiter),
};

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  // Windows runs .bat/.cmd (npx, gradlew) through cmd.exe; paths are quoted for it.
  const r = isWin
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `"${[cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}"`], { cwd, env, stdio: "inherit", windowsVerbatimArguments: true })
    : spawnSync(cmd, args, { cwd, env, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

if (clean || !existsSync(join(root, "android", "gradlew"))) {
  run("npx", ["expo", "prebuild", "--platform", "android", "--no-install", ...(clean ? ["--clean"] : [])], root);
}
run(join(root, "android", isWin ? "gradlew.bat" : "gradlew"), ["assembleRelease", "-PreactNativeArchitectures=x86_64,arm64-v8a", "--console=plain"], join(root, "android"));

const built = join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!existsSync(built)) {
  console.error(`Build finished but ${built} is missing.`);
  process.exit(1);
}
const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "AnyAppAgent.apk");
copyFileSync(built, out);
console.log(`\nAPK: ${out}`);
