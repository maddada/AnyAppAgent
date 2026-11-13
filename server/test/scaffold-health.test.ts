import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { REPO_DIR } from "../src/config.ts";
import { behindReasons, Templates } from "../src/health.ts";

it("the real new-app scaffold and health checker agree, including a claimed spare", () => {
  const root = mkdtempSync(join(tmpdir(), "kiwi-scaffold-health-"));
  try {
    // Exercise the real builder with source files from this repo. Only dependencies are stubbed:
    // no npm install, signing, Android build, shared cache, or background spare refill.
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs';
      import path from 'node:path';
      const builder = new URL(process.argv[1]);
      const { createApp } = await import(builder);
      const { depsHash, templateHash } = await import(new URL('./lib/template.mjs', builder));
      const root = process.argv[2];
      const cache = path.join(process.env.ANYAPP_HOME, 'cache', 'deps-' + depsHash(process.env.ANYAPP_TEMPLATE_DIR));
      fs.mkdirSync(path.join(cache, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(cache, '.ready'), 'test');
      await createApp({ dir: path.join(root, 'fresh'), name: 'Fresh tea', slug: 'fresh', packageName: 'com.anyapp.fresh' });
      const spare = path.join(process.env.ANYAPP_SPARE_DIR, 'spare-test');
      fs.cpSync(path.join(root, 'fresh'), spare, { recursive: true });
      fs.writeFileSync(path.join(spare, '.anyapp-spare.json'), JSON.stringify({ templateHash: templateHash() }));
      await createApp({ dir: path.join(root, 'claimed'), name: 'Claimed tea', slug: 'claimed', packageName: 'com.anyapp.claimed' });
      if (fs.existsSync(spare)) throw new Error('The ready spare was not claimed');
    `, pathToFileURL(join(REPO_DIR, "builder", "index.mjs")).href, root], {
      env: { ...process.env, ANYAPP_HOME: join(root, "state"), ANYAPP_TEMPLATE_DIR: join(REPO_DIR, "template"), ANYAPP_SPARE_DIR: join(root, "spares"), ANYAPP_NO_SPARE: "1", ANYAPP_SIGN_EXTERNAL: "1" },
      stdio: "pipe", timeout: 15000,
    });
    const templates = new Templates(REPO_DIR);
    expect(behindReasons(join(root, "fresh"), "react-native", templates)).toEqual([]);
    expect(behindReasons(join(root, "claimed"), "react-native", templates)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
