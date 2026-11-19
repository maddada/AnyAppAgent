// A stand-in for builder/ while it is being written: same contract, no Android toolchain.
// createApp writes a tiny Expo-shaped project; buildApk waits ANYAPP_FAKE_BUILD_MS (default
// 1500) and writes a small dummy "APK". A build fails when ANYAPP_FAKE_BUILD_FAIL is "always",
// when it is a number N and this is one of the first N builds of the process, or while the
// project contains a file named FAKE_BUILD_FAIL (its text becomes the error).
// ANYAPP_FAKE_APK_DIR (tests on a device): build N copies <dir>/<package>-<N>.apk, a real APK made
// beforehand (app/dev/make-test-apk.mjs), and <package>-<N>-<abi>.apk as its ABI variants.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { BuildResult } from "./builder.ts";

let buildsSoFar = 0;

export async function createApp(args: {
  dir: string;
  name: string;
  slug: string;
  packageName: string;
  preset?: string;
  onLog?: (line: string) => void;
}): Promise<void> {
  if (existsSync(join(args.dir, "package.json"))) throw new Error(`${args.dir} already has a project`);
  if (args.preset === "web") return createWebProject(args.dir, args.name, args.slug, args.packageName);
  if (args.preset === "game") {
    // A game's shape (template-game/): anyapp.json, the game module and the Android app module.
    mkdirSync(join(args.dir, "game", "src", "commonMain", "kotlin"), { recursive: true });
    mkdirSync(join(args.dir, "app"), { recursive: true });
    writeFileSync(join(args.dir, "anyapp.json"), JSON.stringify({ preset: "game", slug: args.slug, package: args.packageName, name: args.name }, null, 2));
    writeFileSync(join(args.dir, "AGENTS.md"), "# Working on this game\n\nGames are meant to move to iPhone and the web later.\n");
    writeFileSync(join(args.dir, "settings.gradle.kts"), 'include(":game", ":app")\n');
    args.onLog?.("fake builder: game created");
    return;
  }
  mkdirSync(join(args.dir, "assets"), { recursive: true });
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: args.slug, version: "1.0.0", main: "index.js", private: true }, null, 2),
    "app.json": JSON.stringify(
      { expo: { name: args.name, slug: args.slug, icon: "./assets/icon.png", android: { package: args.packageName } } },
      null,
      2,
    ),
    "App.tsx": [
      'import { Text, View } from "react-native";',
      "",
      "export default function App() {",
      "  return (",
      '    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>',
      `      <Text>${args.name}</Text>`,
      "    </View>",
      "  );",
      "}",
      "",
    ].join("\n"),
    "README.md": `# ${args.name}\n\nCreated by Kiwimake (fake builder).\n`,
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(args.dir, name), content);
  args.onLog?.("fake builder: project created");
}

export async function buildApk(args: { dir: string; buildNumber: number; onLog?: (line: string) => void }): Promise<BuildResult> {
  buildsSoFar += 1;
  const delay = Number(process.env.ANYAPP_FAKE_BUILD_MS ?? 1500);
  args.onLog?.(`fake builder: building versionCode ${args.buildNumber}`);
  await new Promise((resolve) => setTimeout(resolve, delay / 2));
  args.onLog?.("fake builder: packaging");
  await new Promise((resolve) => setTimeout(resolve, delay / 2));
  const failSetting = process.env.ANYAPP_FAKE_BUILD_FAIL;
  const marker = join(args.dir, "FAKE_BUILD_FAIL");
  if (existsSync(marker)) {
    throw new Error(readFileSync(marker, "utf8").trim() || "Fake build failed because FAKE_BUILD_FAIL exists.");
  }
  if (failSetting === "always" || (failSetting && /^\d+$/.test(failSetting) && buildsSoFar <= Number(failSetting))) {
    throw new Error(`App.tsx:3:10 - error TS2304: Cannot find name 'Foo'. (fake failure ${buildsSoFar})`);
  }
  const ready = readyMadeApk(args.dir, args.buildNumber);
  if (ready) return ready;
  const outDir = join(tmpdir(), "anyapp-fake-builds", basename(args.dir));
  mkdirSync(outDir, { recursive: true });
  const apkPath = join(outDir, `app-${args.buildNumber}.apk`);
  const body = Buffer.concat([
    Buffer.from("PK\u0003\u0004"),
    Buffer.from(`fake apk versionCode=${args.buildNumber} at ${new Date().toISOString()}\n`),
    Buffer.alloc(4096, args.buildNumber % 256),
  ]);
  writeFileSync(apkPath, body);
  return { apkPath, sizeBytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
}

function readyMadeApk(dir: string, buildNumber: number): BuildResult | null {
  const from = process.env.ANYAPP_FAKE_APK_DIR;
  if (!from) return null;
  const pkg = (JSON.parse(readFileSync(join(dir, "app.json"), "utf8")) as { expo?: { android?: { package?: string } } }).expo?.android?.package;
  const file = (abi?: string) => join(from, `${pkg}-${buildNumber}${abi ? `-${abi}` : ""}.apk`);
  if (!pkg || !existsSync(file())) return null;
  const describe = (path: string) => {
    const data = readFileSync(path);
    return { apkPath: path, sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  };
  const variants = ["arm64-v8a", "x86_64"].filter((abi) => existsSync(file(abi))).map((abi) => ({ abi, ...describe(file(abi)) }));
  return { ...describe(file()), ...(variants.length > 0 ? { variants } : {}) };
}

export function getIconPath(args: { dir: string }): string | null {
  const path = join(args.dir, "assets", "icon.png");
  return existsSync(path) ? path : null;
}

/** "Make my own version": copies the source and renames it (React Native shape only). */
export async function adoptApp(args: { src: string; dir: string; name: string; slug: string; packageName: string }): Promise<{ preset: "react-native" }> {
  const { cpSync, readdirSync } = await import("node:fs");
  if (existsSync(args.dir) && readdirSync(args.dir).length > 0) throw new Error(`${args.dir} already exists and is not empty`);
  const appJson = join(args.src, "app.json");
  if (!existsSync(appJson)) throw new Error("This is not an app made with Kiwimake (no app.json or anyapp.json).");
  cpSync(args.src, args.dir, { recursive: true });
  const meta = JSON.parse(readFileSync(join(args.dir, "app.json"), "utf8")) as { expo: { name: string; slug: string; android?: { package?: string } } };
  meta.expo.name = args.name;
  meta.expo.slug = args.slug;
  meta.expo.android = { ...meta.expo.android, package: args.packageName };
  writeFileSync(join(args.dir, "app.json"), JSON.stringify(meta, null, 2));
  return { preset: "react-native" };
}

/** Rename: the new name, slug and package in app.json, in place (React Native shape only). */
export async function renameApp(args: { dir: string; name: string; slug: string; packageName: string }): Promise<{ preset: "react-native"; packageChanged: boolean }> {
  const path = join(args.dir, "app.json");
  if (!existsSync(path)) throw new Error("This is not an app made with Kiwimake (no app.json or anyapp.json).");
  const meta = JSON.parse(readFileSync(path, "utf8")) as { expo: { name: string; slug: string; android?: { package?: string } } };
  const packageChanged = meta.expo.android?.package !== args.packageName;
  meta.expo.name = args.name;
  meta.expo.slug = args.slug;
  meta.expo.android = { ...meta.expo.android, package: args.packageName };
  writeFileSync(path, JSON.stringify(meta, null, 2));
  return { preset: "react-native", packageChanged };
}

// ---------- web apps (docs/WEB-APPS.md): a tiny web project and a site in dist/, no npm or Vite.

function createWebProject(dir: string, name: string, slug: string, packageName?: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: slug, version: "1.0.0", private: true, type: "module" }, null, 2),
    "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><link rel="manifest" href="manifest.webmanifest"></head><body><div id="root">${name}</div><script type="module" src="./assets/app.js"></script></body></html>\n`,
    "src/App.tsx": `export const name = ${JSON.stringify(name)};\n`,
    ...(packageName ? { "anyapp.json": JSON.stringify({ preset: "web", slug, package: packageName }, null, 2) } : {}),
  };
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
}

export async function addWebVersion(args: { dir: string; name: string; slug: string }): Promise<{ webDir: string }> {
  const webDir = join(args.dir, "web");
  if (existsSync(webDir)) throw new Error(`${webDir} already exists`);
  createWebProject(webDir, args.name, args.slug);
  return { webDir };
}

export async function buildWeb(args: { dir: string; buildNumber: number; onLog?: (line: string) => void }): Promise<{ distDir: string; files: { path: string; size: number; sha256: string }[]; sizeBytes: number }> {
  const delay = Number(process.env.ANYAPP_FAKE_BUILD_MS ?? 1500) / 3;
  args.onLog?.(`fake builder: building the web version ${args.buildNumber}`);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const marker = join(args.dir, "FAKE_BUILD_FAIL");
  if (existsSync(marker)) throw new Error(readFileSync(marker, "utf8").trim() || "Fake web build failed because FAKE_BUILD_FAIL exists.");
  const { rmSync } = await import("node:fs");
  const distDir = join(args.dir, "dist");
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(join(distDir, "assets"), { recursive: true });
  const source = existsSync(join(args.dir, "src", "App.tsx")) ? readFileSync(join(args.dir, "src", "App.tsx"), "utf8") : "";
  const site: Record<string, string> = {
    "index.html": existsSync(join(args.dir, "index.html")) ? readFileSync(join(args.dir, "index.html"), "utf8") : "<!doctype html><title>app</title>\n",
    "assets/app.js": `/* build ${args.buildNumber} */\nconsole.log(${JSON.stringify(source)});\n`,
    "manifest.webmanifest": JSON.stringify({ name: basename(args.dir), start_url: "./", scope: "./", display: "standalone" }),
    "sw.js": `const CACHE = "kiwi-fake-${args.buildNumber}";\n`,
    "version.json": JSON.stringify({ build: args.buildNumber }),
  };
  const files = Object.entries(site).map(([path, content]) => {
    writeFileSync(join(distDir, path), content);
    return { path, size: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") };
  });
  return { distDir, files, sizeBytes: files.reduce((n, f) => n + f.size, 0) };
}
