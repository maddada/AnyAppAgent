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
  onLog?: (line: string) => void;
}): Promise<void> {
  if (existsSync(join(args.dir, "package.json"))) throw new Error(`${args.dir} already has a project`);
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
    "README.md": `# ${args.name}\n\nCreated by AnyAppAgent (fake builder).\n`,
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
  if (!existsSync(appJson)) throw new Error("This is not an app made with AnyAppAgent (no app.json or anyapp.json).");
  cpSync(args.src, args.dir, { recursive: true });
  const meta = JSON.parse(readFileSync(join(args.dir, "app.json"), "utf8")) as { expo: { name: string; slug: string; android?: { package?: string } } };
  meta.expo.name = args.name;
  meta.expo.slug = args.slug;
  meta.expo.android = { ...meta.expo.android, package: args.packageName };
  writeFileSync(join(args.dir, "app.json"), JSON.stringify(meta, null, 2));
  return { preset: "react-native" };
}
