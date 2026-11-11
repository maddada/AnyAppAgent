// The one place the server talks to builder/ (contract in docs/SPEC.md). The real builder is
// used when builder/index.mjs exists, the fake one otherwise or when ANYAPP_BUILDER=fake.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppPreset } from "../../shared/protocol.ts";
import { REPO_DIR } from "./config.ts";
import * as fake from "./fake-builder.ts";

export interface BuildResult {
  apkPath: string; // the full APK (every ABI)
  sizeBytes: number;
  sha256: string;
  // One smaller APK per ABI (builder/ with ABI splits); absent when the app has no native code.
  variants?: { abi: string; apkPath: string; sizeBytes: number; sha256: string }[];
}

export interface Builder {
  kind: "real" | "fake";
  createApp(args: { dir: string; name: string; slug: string; packageName: string; preset?: AppPreset; onLog?: (line: string) => void }): Promise<void>;
  buildApk(args: { dir: string; buildNumber: number; onLog?: (line: string) => void }): Promise<BuildResult>;
  getIconPath(args: { dir: string }): string | null;
  // Signing keys (docs/DISTRIBUTION.md): only the real builder has them.
  keys?: {
    list(): Promise<{ keys: { id: string; kind: "shared" | "own" | "moved"; certSha256: string }[]; lastBackupAt: string | null; notBackedUp: string[] }>;
    backup(args: { file: string; password: string }): Promise<{ file: string; count: number; createdAt: string }>;
    restore(args: { file: string; password: string }): Promise<{ added: string[]; same: string[]; conflicts: { id: string; reason: string }[] }>;
  };
}

interface KeysModule {
  listSigningKeys?: NonNullable<Builder["keys"]>["list"];
  backupSigningKeys?: NonNullable<Builder["keys"]>["backup"];
  restoreSigningKeys?: NonNullable<Builder["keys"]>["restore"];
}

export const REAL_BUILDER_PATH = join(REPO_DIR, "builder", "index.mjs");

export async function loadBuilder(choice: "auto" | "real" | "fake"): Promise<Builder> {
  const useReal = choice === "real" || (choice === "auto" && existsSync(REAL_BUILDER_PATH));
  if (!useReal) return { kind: "fake", ...fake };
  const mod = (await import(pathToFileURL(REAL_BUILDER_PATH).href)) as Omit<Builder, "kind" | "keys"> & KeysModule;
  for (const name of ["createApp", "buildApk", "getIconPath"] as const) {
    if (typeof mod[name] !== "function") throw new Error(`builder/index.mjs does not export ${name}()`);
  }
  return {
    kind: "real",
    createApp: (args) => mod.createApp(args),
    buildApk: (args) => mod.buildApk(args),
    getIconPath: (args) => mod.getIconPath(args),
    ...(mod.listSigningKeys && mod.backupSigningKeys && mod.restoreSigningKeys
      ? {
          keys: {
            list: mod.listSigningKeys,
            backup: mod.backupSigningKeys,
            restore: mod.restoreSigningKeys,
          },
        }
      : {}),
  };
}
