// npm run apk  ->  builds the installable AnyAppAgent APK (release variant, JS bundled inside,
// no dev server needed) and prints its path.
//
//   npm run apk               # reuses android/ if it exists
//   npm run apk -- --clean    # regenerates android/ from app.json first (after config changes)
//   npm run apk -- --release  # signed with the release key (docs/RELEASING.md), one APK per ABI
//
// Writes dist/AnyAppAgent.apk and dist/AnyAppAgent-universal.apk (the desktop installer bundles
// the universal one). Without --release both are the same APK (x86_64 and arm64-v8a), signed with
// the React Native debug key like before. With --release, AnyAppAgent.apk is the arm64-v8a build
// (nearly every phone) and AnyAppAgent-universal.apk has arm64-v8a and x86_64.
//
// Uses JAVA_HOME / ANDROID_HOME from the environment, else this PC's defaults from
// docs/ENVIRONMENT.md (D:\tools\android\jdk, D:\tools\android\sdk).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const clean = process.argv.includes("--clean");
const release = process.argv.includes("--release");

const JAVA_HOME = process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME) ? process.env.JAVA_HOME : String.raw`D:\tools\android\jdk`;
const ANDROID_HOME = process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME) ? process.env.ANDROID_HOME : String.raw`D:\tools\android\sdk`;
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

// The release key first, so a missing key fails before a long build.
const signing = release ? (await import("./release-key.mjs")).releaseSigning() : null;

// The Easy Connect bridge (jar + arm64-v8a/x86_64 libgojni.so) into the native module first.
run(process.execPath, [join(root, "scripts", "stage-bridge.mjs")], root);

if (clean || !existsSync(join(root, "android", "gradlew"))) {
  run("npx", ["expo", "prebuild", "--platform", "android", "--no-install", ...(clean ? ["--clean"] : [])], root);
}

const gradlew = join(root, "android", isWin ? "gradlew.bat" : "gradlew");
const apkDir = join(root, "android", "app", "build", "outputs", "apk", "release");
const outs = [];
if (signing) {
  // Old outputs (a debug-signed app-release.apk) must never be mistaken for the release.
  rmSync(apkDir, { recursive: true, force: true });
  env.ORG_GRADLE_PROJECT_anyappReleaseStoreFile = signing.storeFile;
  env.ORG_GRADLE_PROJECT_anyappReleaseStorePassword = signing.storePassword;
  env.ORG_GRADLE_PROJECT_anyappReleaseKeyAlias = signing.keyAlias;
  env.ORG_GRADLE_PROJECT_anyappReleaseKeyPassword = signing.keyPassword;
  run(gradlew, ["assembleRelease", "--init-script", join(root, "scripts", "release.init.gradle"), "-PreactNativeArchitectures=x86_64,arm64-v8a", "-PanyappReleaseAbis=arm64-v8a,x86_64", "--console=plain"], join(root, "android"));
  outs.push([join(apkDir, "app-arm64-v8a-release.apk"), "AnyAppAgent.apk"], [join(apkDir, "app-universal-release.apk"), "AnyAppAgent-universal.apk"]);
} else {
  run(gradlew, ["assembleRelease", "-PreactNativeArchitectures=x86_64,arm64-v8a", "--console=plain"], join(root, "android"));
  const built = join(apkDir, "app-release.apk");
  outs.push([built, "AnyAppAgent.apk"], [built, "AnyAppAgent-universal.apk"]);
}

const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });
console.log("");
for (const [from, name] of outs) {
  if (!existsSync(from)) {
    console.error(`Build finished but ${from} is missing.`);
    process.exit(1);
  }
  const out = join(outDir, name);
  copyFileSync(from, out);
  const sha = createHash("sha256").update(readFileSync(out)).digest("hex");
  console.log(`APK: ${out} (${(statSync(out).size / 1048576).toFixed(1)} MB, sha256 ${sha})`);
}
if (signing) console.log(`Signed with the release key, certificate SHA-256 ${signing.certSha256}`);
