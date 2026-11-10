// The one place the server talks to builder/ (contract in docs/SPEC.md). The real builder is
// used when builder/index.mjs exists, the fake one otherwise or when ANYAPP_BUILDER=fake.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_DIR } from "./config.ts";
import * as fake from "./fake-builder.ts";

export interface BuildResult {
  apkPath: string;
  sizeBytes: number;
  sha256: string;
}

export interface Builder {
  kind: "real" | "fake";
  createApp(args: { dir: string; name: string; slug: string; packageName: string; onLog?: (line: string) => void }): Promise<void>;
  buildApk(args: { dir: string; buildNumber: number; onLog?: (line: string) => void }): Promise<BuildResult>;
  getIconPath(args: { dir: string }): string | null;
}

export const REAL_BUILDER_PATH = join(REPO_DIR, "builder", "index.mjs");

export async function loadBuilder(choice: "auto" | "real" | "fake"): Promise<Builder> {
  const useReal = choice === "real" || (choice === "auto" && existsSync(REAL_BUILDER_PATH));
  if (!useReal) return { kind: "fake", ...fake };
  const mod = (await import(pathToFileURL(REAL_BUILDER_PATH).href)) as Omit<Builder, "kind">;
  for (const name of ["createApp", "buildApk", "getIconPath"] as const) {
    if (typeof mod[name] !== "function") throw new Error(`builder/index.mjs does not export ${name}()`);
  }
  return {
    kind: "real",
    createApp: (args) => mod.createApp(args),
    buildApk: (args) => mod.buildApk(args),
    getIconPath: (args) => mod.getIconPath(args),
  };
}
