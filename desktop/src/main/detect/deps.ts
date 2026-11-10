// The builder's dependency cache: node_modules for the template's lockfile, installed once with
// `npm ci` into %USERPROFILE%\.anyappagent\cache\deps-<hash> (builder/README.md). Without it the
// user's first app starts with a silent wait of a few minutes, so the tools step fills it.
// The hash and folders come from the builder itself (builder/lib/template.mjs, env.mjs), so the
// desktop can never disagree with it about which cache is current.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface DepsCache {
  ok: boolean;
  dir?: string;
  error?: string;
}

/** Pure part, unit tested: a cache folder is ready when the builder wrote its `.ready` marker. */
export function depsReady(cacheDir: string, hash: string, exists: (p: string) => boolean = existsSync): { ok: boolean; dir: string } {
  const dir = join(cacheDir, `deps-${hash}`);
  return { ok: exists(join(dir, ".ready")), dir };
}

// A real dynamic import at run time (the bundler must not try to resolve the builder's files).
const load = new Function("u", "return import(u)") as (url: string) => Promise<Record<string, unknown>>;

export async function detectDeps(repoRoot: string): Promise<DepsCache> {
  try {
    const env = await load(pathToFileURL(join(repoRoot, "builder", "lib", "env.mjs")).href);
    const tpl = await load(pathToFileURL(join(repoRoot, "builder", "lib", "template.mjs")).href);
    const hash = (tpl.depsHash as (dir: string) => string)(env.TEMPLATE_DIR as string);
    return depsReady(env.CACHE_DIR as string, hash);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
