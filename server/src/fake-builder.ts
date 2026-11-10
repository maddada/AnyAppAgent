// A stand-in for builder/ while it is being written: same contract, no Android toolchain.
// createApp writes a tiny Expo-shaped project; buildApk waits ANYAPP_FAKE_BUILD_MS (default
// 1500) and writes a small dummy "APK". A build fails when ANYAPP_FAKE_BUILD_FAIL is "always",
// when it is a number N and this is one of the first N builds of the process, or while the
// project contains a file named FAKE_BUILD_FAIL (its text becomes the error).
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

export function getIconPath(args: { dir: string }): string | null {
  const path = join(args.dir, "assets", "icon.png");
  return existsSync(path) ? path : null;
}
