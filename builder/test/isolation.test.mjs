// Proves that an app's node_modules is its own copy: an agent patching a file in it or running
// `npm install <pkg>` cannot change the shared dependency cache or template/node_modules.
//   node --test builder/test/
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { createApp } from '../index.mjs';
import { TEMPLATE_DIR } from '../lib/env.mjs';
import { npmCommand, run } from '../lib/exec.mjs';
import { ensureDepsCache } from '../lib/template.mjs';

process.env.ANYAPP_NO_SPARE = '1'; // do not start background spare refills from a test

const ROOT = process.env.ANYAPP_TEST_DIR ?? 'C:\\aa\\t';
const SAMPLES = ['react/index.js', 'expo/package.json', 'react-native/package.json', 'typescript/package.json'];

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function snapshot(nodeModules) {
  const out = {};
  for (const rel of SAMPLES) {
    const p = path.join(nodeModules, rel);
    if (fs.existsSync(p)) out[rel] = { sha: sha(p), ino: fs.statSync(p, { bigint: true }).ino };
  }
  out.packages = fs.readdirSync(nodeModules).sort().join(',');
  return out;
}

async function countHardLinked(dir) {
  let linked = 0;
  let files = 0;
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        files++;
        if ((await fsp.stat(p)).nlink > 1) linked++;
      }
    }
  };
  await walk(dir);
  return { linked, files };
}

test('an app cannot change the shared dependency cache or template/node_modules', { timeout: 10 * 60_000 }, async () => {
  const cache = path.join((await ensureDepsCache()).dir, 'node_modules');
  const templateNm = path.join(TEMPLATE_DIR, 'node_modules');
  const before = { cache: snapshot(cache), template: fs.existsSync(templateNm) ? snapshot(templateNm) : null };

  const dir = path.join(ROOT, `iso-${crypto.randomBytes(3).toString('hex')}`);
  try {
    await createApp({ dir, name: 'Isolation', slug: 'isolation', packageName: 'com.anyapp.isolation' });
    const appNm = path.join(dir, 'node_modules');

    // 1. Not a single hard-linked file, and different files (inodes) from the shared copies.
    const { linked, files } = await countHardLinked(appNm);
    assert.ok(files > 10_000, `expected a full node_modules, found ${files} files`);
    assert.equal(linked, 0, `${linked} files in the app's node_modules are hard links`);
    const app = snapshot(appNm);
    for (const rel of Object.keys(before.cache)) {
      if (rel === 'packages') continue;
      assert.notEqual(app[rel].ino, before.cache[rel].ino, `${rel} shares its file with the deps cache`);
      if (before.template?.[rel]) assert.notEqual(app[rel].ino, before.template[rel].ino, `${rel} shares its file with the template`);
    }

    // 2. Patch a file in place, as an agent might.
    await fsp.appendFile(path.join(appNm, 'react', 'index.js'), '\n// patched by an agent\n');

    // 3. Install a new package, as an agent might.
    const npm = npmCommand();
    await run(npm.cmd, [...npm.pre, 'install', 'left-pad@1.3.0', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: dir,
      shell: npm.shell,
    });
    assert.ok(fs.existsSync(path.join(appNm, 'left-pad', 'package.json')), 'npm install did not add left-pad');

    // 4. The shared copies are exactly as before.
    assert.deepEqual(snapshot(cache), before.cache, 'the shared deps cache changed');
    if (before.template) assert.deepEqual(snapshot(templateNm), before.template, 'template/node_modules changed');
    assert.ok(!fs.existsSync(path.join(cache, 'left-pad')), 'left-pad appeared in the deps cache');
    if (before.template) assert.ok(!fs.existsSync(path.join(templateNm, 'left-pad')), 'left-pad appeared in template/node_modules');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
