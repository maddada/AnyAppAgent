// Builds a tiny, real, installable APK for the mock PC (no Gradle, no Java code):
// a manifest, a launcher icon and a window background, linked with aapt2 and signed with
// apksigner from the Android SDK build-tools. The one screen is the framework's own
// android.app.Activity (hasCode=false); its background shows the app's icon and the version
// number, so an update is visible at a glance.
//
//   node dev/make-test-apk.mjs --package com.anyapp.prayeralarm --label "Prayer Alarm" --version 2 --out x.apk
//
// Needs ANDROID_HOME (or ANDROID_SDK_ROOT) with build-tools and a platform, and a JDK
// (JAVA_HOME or java/keytool on PATH). Every APK is signed with the same test key
// (dev/tmp/mock-apps.keystore), so version N+1 installs over version N.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appIconPng } from "./png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TMP = join(here, "tmp");
const isWin = process.platform === "win32";

export function sdkRoot() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk")];
  return candidates.find((p) => p && existsSync(join(p, "build-tools"))) ?? null;
}

function newestDir(parent, filter = () => true) {
  if (!existsSync(parent)) return null;
  const dirs = readdirSync(parent).filter(filter).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return dirs.length ? join(parent, dirs[dirs.length - 1]) : null;
}

export function tool(dir, name) {
  for (const ext of isWin ? [".exe", ".bat", ""] : [""]) {
    const p = join(dir, name + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

export function javaTool(name) {
  if (process.env.JAVA_HOME) {
    const p = tool(join(process.env.JAVA_HOME, "bin"), name);
    if (p) return p;
  }
  return name; // hope it's on PATH
}

export function toolchain() {
  const sdk = sdkRoot();
  if (!sdk) return null;
  const bt = newestDir(join(sdk, "build-tools"), (d) => /^\d/.test(d));
  const platform = newestDir(join(sdk, "platforms"), (d) => existsSync(join(sdk, "platforms", d, "android.jar")));
  if (!bt || !platform) return null;
  const aapt2 = tool(bt, "aapt2");
  const zipalign = tool(bt, "zipalign");
  const apksigner = tool(bt, "apksigner");
  if (!aapt2 || !apksigner) return null;
  return { sdk, aapt2, zipalign, apksigner, androidJar: join(platform, "android.jar") };
}

export function run(cmd, args) {
  // .bat files (apksigner) go through cmd.exe on Windows.
  if (isWin && cmd.endsWith(".bat")) {
    const line = [cmd, ...args].map((a) => (/[\s&()]/.test(a) ? `"${a}"` : a)).join(" ");
    return execFileSync("cmd.exe", ["/d", "/s", "/c", `"${line}"`], { stdio: ["ignore", "pipe", "pipe"], windowsVerbatimArguments: true });
  }
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
}

export const KEYSTORE = join(TMP, "mock-apps.keystore");

export function ensureKeystore() {
  if (existsSync(KEYSTORE)) return;
  mkdirSync(TMP, { recursive: true });
  run(javaTool("keytool"), [
    "-genkeypair", "-keystore", KEYSTORE, "-storepass", "mockmock", "-keypass", "mockmock", "-alias", "mock",
    "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=AnyAppAgent mock",
  ]);
}

// Seven-segment digits as vector paths, for the version number on the window background.
const SEG = {
  a: "M14,4h32l-6,6h-20z", b: "M48,6v32l-6,-4v-22z", c: "M48,42v32l-6,-6v-22z", d: "M14,76h32l-6,-6h-20z",
  e: "M12,42v32l6,-6v-22z", f: "M12,6v32l6,-4v-22z", g: "M16,40l4,-4h20l4,4l-4,4h-20z",
};
const DIGITS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abfgcd"];

function versionVector(n) {
  const digits = String(n).split("").map(Number);
  const w = 60 * digits.length;
  const paths = digits
    .map((d, i) => DIGITS[d].split("").map((s) => `<path android:fillColor="#FFFFFFFF" android:pathData="${SEG[s].replace(/^M(\d+)/, (_, x) => `M${Number(x) + i * 60}`)}"/>`).join(""))
    .join("");
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${w * 1.6}dp" android:height="${80 * 1.6}dp" android:viewportWidth="${w}" android:viewportHeight="80">${paths}</vector>`;
}

export function makeApk({ packageName, label, versionCode, color = "#22a06b", glyph = "star", out }) {
  const tc = toolchain();
  if (!tc) throw new Error("Android build-tools not found (set ANDROID_HOME).");
  ensureKeystore();
  const work = join(TMP, "work", `${packageName}-${versionCode}`);
  rmSync(work, { recursive: true, force: true });
  const res = join(work, "res");
  for (const d of ["mipmap-xxxhdpi", "drawable", "values"]) mkdirSync(join(res, d), { recursive: true });

  writeFileSync(join(res, "mipmap-xxxhdpi", "ic_launcher.png"), appIconPng(192, color, glyph));
  writeFileSync(join(res, "drawable", "icon_big.png"), appIconPng(256, color, glyph));
  writeFileSync(join(res, "drawable", "version.xml"), versionVector(versionCode));
  writeFileSync(
    join(res, "drawable", "screen.xml"),
    `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item><color android:color="${color}"/></item>
  <item android:gravity="center" android:bottom="260dp"><bitmap android:src="@drawable/icon_big" android:gravity="center"/></item>
  <item android:gravity="center" android:top="200dp" android:drawable="@drawable/version"/>
</layer-list>`,
  );
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, '\\"').replace(/'/g, "\\'");
  writeFileSync(
    join(res, "values", "values.xml"),
    `<resources>
  <string name="app_name">${esc(label)}</string>
  <style name="Screen" parent="@android:style/Theme.Material.Light.NoActionBar">
    <item name="android:windowBackground">@drawable/screen</item>
    <item name="android:statusBarColor">${color}</item>
    <item name="android:navigationBarColor">${color}</item>
  </style>
</resources>`,
  );
  writeFileSync(
    join(work, "AndroidManifest.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}">
  <application android:label="@string/app_name" android:icon="@mipmap/ic_launcher" android:hasCode="false" android:theme="@style/Screen">
    <activity android:name="android.app.Activity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>`,
  );

  const flat = join(work, "compiled.zip");
  run(tc.aapt2, ["compile", "--dir", res, "-o", flat]);
  const unsigned = join(work, "unsigned.apk");
  run(tc.aapt2, [
    "link", "-o", unsigned, "-I", tc.androidJar, "--manifest", join(work, "AndroidManifest.xml"),
    "--min-sdk-version", "24", "--target-sdk-version", "34",
    "--version-code", String(versionCode), "--version-name", `1.${versionCode}`, flat,
  ]);
  let aligned = unsigned;
  if (tc.zipalign) {
    aligned = join(work, "aligned.apk");
    run(tc.zipalign, ["-f", "-p", "4", unsigned, aligned]);
  }
  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  copyFileSync(aligned, outPath);
  run(tc.apksigner, ["sign", "--v4-signing-enabled", "false", "--ks", KEYSTORE, "--ks-pass", "pass:mockmock", "--key-pass", "pass:mockmock", "--ks-key-alias", "mock", outPath]);
  rmSync(work, { recursive: true, force: true });
  return outPath;
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (k, d) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const out = makeApk({
    packageName: get("package", "com.anyapp.test"),
    label: get("label", "Test App"),
    versionCode: Number(get("version", "1")),
    color: get("color", "#22a06b"),
    glyph: get("glyph", "star"),
    out: get("out", join(TMP, "test.apk")),
  });
  console.log(out);
}
