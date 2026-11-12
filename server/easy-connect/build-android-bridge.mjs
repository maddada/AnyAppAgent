#!/usr/bin/env node
// Builds the Easy Connect bridge for the Kiwimake Android app: the same gomobile `bind` that
// Ghostex's apps/mobile/tailcat-bridge/build.sh runs, from the copy in ./tailcat-bridge, with the
// same pinned gomobile, using the private Go toolchain in %USERPROFILE%\.anyappagent\tools (made
// there by the companion's Easy Connect install when missing). Output, never inside the repo:
//   %USERPROFILE%\.anyappagent\tools\tailcatbridge\tailcatbridge.aar           (the gomobile AAR)
//   %USERPROFILE%\.anyappagent\tools\tailcatbridge\staged\libs\tailcatbridge.jar
//   %USERPROFILE%\.anyappagent\tools\tailcatbridge\staged\jniLibs\<abi>\libgojni.so
// The staged layout is what an Expo native module copies in (Ghostex stages it the same way,
// because AGP refuses a local .aar dependency inside a library module).
// Needs ANDROID_HOME (with an NDK under ndk/) and JAVA_HOME. Java package: dev.anyappagent, so
// the Java entry point is dev.anyappagent.tailcatbridge.Tailcatbridge.
// Usage: node server/easy-connect/build-android-bridge.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(HERE, "..");
const { ensureGoToolchain, goEnv } = await import(pathToFileURL(join(SERVER_DIR, "src", "easy-connect", "tailcat.ts")).href);

export const GOMOBILE_PIN = "v0.0.0-20260821190718-4776eadac327"; // Ghostex .github/workflows/release-gpui-android.yml
const JAVA_PACKAGE = "dev.anyappagent";
const ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"];
const EXE = process.platform === "win32" ? ".exe" : "";

const tools = join(homedir(), ".anyappagent", "tools");
const paths = { toolsDir: tools, dataDir: join(tools, "unused") };
const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!androidHome || !existsSync(join(androidHome, "ndk"))) throw new Error("Set ANDROID_HOME to an Android SDK that has an NDK (ndk/<version>).");
const ndk = process.env.ANDROID_NDK_HOME ?? join(androidHome, "ndk", readdirSync(join(androidHome, "ndk")).sort().at(-1));
const go = await ensureGoToolchain(paths, (m) => console.log(m));
const gobin = join(tools, "gopath", "bin");
const env = goEnv(paths, {
  GOBIN: gobin,
  ANDROID_HOME: androidHome,
  ANDROID_NDK_HOME: ndk,
  PATH: `${join(tools, "go", "bin")}${process.platform === "win32" ? ";" : ":"}${gobin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
});
delete env.GOOS;
delete env.GOARCH;
delete env.CGO_ENABLED;

function run(command, args, cwd) {
  console.log(`> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

run(go, ["install", `golang.org/x/mobile/cmd/gomobile@${GOMOBILE_PIN}`, `golang.org/x/mobile/cmd/gobind@${GOMOBILE_PIN}`], join(HERE, "tailcat-bridge"));
const out = join(tools, "tailcatbridge");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const aar = join(out, "tailcatbridge.aar");
run(join(gobin, `gomobile${EXE}`), ["bind", "-target=android", "-androidapi", "24", "-javapkg", JAVA_PACKAGE, "-o", aar, "."], join(HERE, "tailcat-bridge"));

const unpack = join(out, "unpack");
mkdirSync(unpack, { recursive: true });
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "unzip";
if (process.platform === "win32") run(tar, ["-xf", aar, "-C", unpack], out);
else run("unzip", ["-o", "-q", aar, "-d", unpack], out);
mkdirSync(join(out, "staged", "libs"), { recursive: true });
copyFileSync(join(unpack, "classes.jar"), join(out, "staged", "libs", "tailcatbridge.jar"));
for (const abi of ABIS) {
  mkdirSync(join(out, "staged", "jniLibs", abi), { recursive: true });
  copyFileSync(join(unpack, "jni", abi, "libgojni.so"), join(out, "staged", "jniLibs", abi, "libgojni.so"));
}
rmSync(unpack, { recursive: true, force: true });
console.log(`done: ${aar}\n      ${join(out, "staged")}`);
