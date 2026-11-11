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
  // Which key signed it (builder/ since per-app keys, docs/DISTRIBUTION.md).
  signing?: { kind: "shared" | "own" | "moved"; certSha256: string };
  // The fast lane (docs/FAST-LANE.md): "quick" when only JavaScript changed (no Gradle), with the
  // signed quick update package; the native fingerprint of every React Native build.
  delivery?: "quick" | "full";
  runtime?: string;
  ota?: { path: string; sizeBytes: number; sha256: string; runtime: string };
}

export interface Builder {
  kind: "real" | "fake";
  createApp(args: { dir: string; name: string; slug: string; packageName: string; preset?: AppPreset; onLog?: (line: string) => void }): Promise<void>;
  buildApk(args: { dir: string; buildNumber: number; onLog?: (line: string) => void; updateFeed?: string; updateTestingFeed?: string; changeOwner?: string; changeOthers?: boolean; fast?: boolean }): Promise<BuildResult>;
  getIconPath(args: { dir: string }): string | null;
  /** "Make my own version" (docs/CHANGE-THIS-APP.md): a separate app from another app's code. */
  adoptApp?(args: { src: string; dir: string; name: string; slug: string; packageName: string; onLog?: (line: string) => void }): Promise<{ preset: AppPreset }>;
  // Signing keys (docs/DISTRIBUTION.md): only the real builder has them.
  keys?: {
    list(): Promise<{ keys: { id: string; kind: "shared" | "own" | "moved"; certSha256: string }[]; lastBackupAt: string | null; notBackedUp: string[] }>;
    backup(args: { file: string; password: string }): Promise<{ file: string; count: number; createdAt: string }>;
    restore(args: { file: string; password: string }): Promise<{ added: string[]; same: string[]; conflicts: { id: string; reason: string }[] }>;
    kind(packageName: string): "shared" | "own" | "moved";
    move(packageName: string): Promise<unknown>;
    // For the whole-PC backup (backup.ts). The entries are SECRET (keys and their passwords): they are
    // only ever written inside the backup's encryption, never logged.
    exportEntries?(): Promise<KeyEntry[]>;
    importEntries?(entries: KeyEntry[], createdAt: string): Promise<{ added: string[]; same: string[]; conflicts: { id: string; reason: string }[] }>;
    markBackedUp?(ids: string[], createdAt: string): Promise<void>;
  };
}

/** One signing key as builder/lib/keybackup.mjs exports it (opaque here). */
export interface KeyEntry {
  id: string;
  [field: string]: unknown;
}

interface KeysModule {
  listSigningKeys?: NonNullable<Builder["keys"]>["list"];
  backupSigningKeys?: NonNullable<Builder["keys"]>["backup"];
  restoreSigningKeys?: NonNullable<Builder["keys"]>["restore"];
  appSigningKind?: (args: { packageName: string }) => "shared" | "own" | "moved";
  moveAppToOwnKey?: (args: { packageName: string }) => Promise<unknown>;
  exportSigningKeys?: () => Promise<{ entries: KeyEntry[] }>;
  importSigningKeys?: (args: { entries: KeyEntry[]; createdAt: string }) => Promise<{ added: string[]; same: string[]; conflicts: { id: string; reason: string }[] }>;
  markSigningKeysBackedUp?: (args: { ids: string[]; createdAt: string }) => Promise<void>;
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
    ...(typeof mod.adoptApp === "function" ? { adoptApp: (args: Parameters<NonNullable<Builder["adoptApp"]>>[0]) => mod.adoptApp!(args) } : {}),
    ...(mod.listSigningKeys && mod.backupSigningKeys && mod.restoreSigningKeys && mod.appSigningKind && mod.moveAppToOwnKey
      ? {
          keys: {
            list: mod.listSigningKeys,
            backup: mod.backupSigningKeys,
            restore: mod.restoreSigningKeys,
            kind: (packageName: string) => mod.appSigningKind!({ packageName }),
            move: (packageName: string) => mod.moveAppToOwnKey!({ packageName }),
            ...(mod.exportSigningKeys && mod.importSigningKeys && mod.markSigningKeysBackedUp
              ? {
                  exportEntries: async () => (await mod.exportSigningKeys!()).entries,
                  importEntries: (entries: KeyEntry[], createdAt: string) => mod.importSigningKeys!({ entries, createdAt }),
                  markBackedUp: (ids: string[], createdAt: string) => mod.markSigningKeysBackedUp!({ ids, createdAt }),
                }
              : {}),
          },
        }
      : {}),
  };
}
