// Spare app folders: a complete, installed copy of the template kept ready next to the apps, so
// createApp only has to rename it into place (instant on the same volume) and fill in the name.
// After each claim a detached background process makes the next spare.
//
//   node spare.mjs refill <spareRoot>     (what createApp spawns)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeAppTree, templateHash } from './template.mjs';
import { tryLock } from './lock.mjs';

const MARKER = '.anyapp-spare.json';
const SPARES_WANTED = 1;

/** Spares must be on the same volume as the app folder; ANYAPP_SPARE_DIR overrides. */
export function spareRootFor(dir) {
  if (process.env.ANYAPP_SPARE_DIR) return path.resolve(process.env.ANYAPP_SPARE_DIR);
  return path.join(path.parse(path.resolve(dir)).root, 'aa', '.spare');
}

function readMarker(spareDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(spareDir, MARKER), 'utf8'));
  } catch {
    return null;
  }
}

function readySpares(root, hash) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('spare-'))
    .map((e) => path.join(root, e.name))
    .filter((d) => readMarker(d)?.templateHash === hash);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Moves a ready spare to dir. Returns true on success, false if none could be used. */
export async function claimSpare(dir, hash) {
  const root = spareRootFor(dir);
  for (const spare of readySpares(root, hash)) {
    // A just-written spare can briefly be held open by antivirus scanning: retry a little.
    for (let i = 0; i < 5; i++) {
      try {
        if (fs.existsSync(dir)) await fsp.rmdir(dir); // createApp only allows an empty dir
        await fsp.rename(spare, dir);
        await fsp.rm(path.join(dir, MARKER), { force: true });
        return true;
      } catch (e) {
        if (e.code === 'EXDEV') return false; // other volume
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break;
        await sleep(200 * (i + 1));
      }
    }
  }
  return false;
}

/** Starts a detached process that makes a new spare (returns at once). */
export function refillSparesInBackground(dir) {
  if (process.env.ANYAPP_NO_SPARE === '1') return;
  const root = spareRootFor(dir);
  try {
    fs.mkdirSync(root, { recursive: true });
    const out = fs.openSync(path.join(root, 'refill.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'refill', root], {
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    });
    child.unref();
    fs.closeSync(out);
  } catch {
    /* a spare is only an optimisation */
  }
}

/** Removes outdated spares and makes new ones until SPARES_WANTED are ready. */
export async function refillSpares(root, log = console.log) {
  await fsp.mkdir(root, { recursive: true });
  const release = await tryLock(path.join(root, '.refill.lock'), { staleMs: 20 * 60_000 });
  if (!release) {
    log('Another refill is running.');
    return;
  }
  try {
    const hash = templateHash();
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const d = path.join(root, e.name);
      const stale = e.name.startsWith('tmp-') || (e.name.startsWith('spare-') && readMarker(d)?.templateHash !== hash);
      if (stale) {
        log(`Removing outdated ${e.name}`);
        await fsp.rm(d, { recursive: true, force: true, maxRetries: 3 });
      }
    }
    while (readySpares(root, hash).length < SPARES_WANTED) {
      const id = crypto.randomBytes(4).toString('hex');
      const tmp = path.join(root, `tmp-${id}`);
      const t0 = Date.now();
      await makeAppTree(tmp, log);
      await fsp.writeFile(path.join(tmp, MARKER), JSON.stringify({ templateHash: hash, at: new Date().toISOString() }));
      await fsp.rename(tmp, path.join(root, `spare-${id}`));
      log(`Spare spare-${id} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  } finally {
    await release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'refill') {
  const root = process.argv[3];
  const stamp = () => new Date().toISOString();
  refillSpares(root, (m) => console.log(`${stamp()} ${m}`)).catch((e) => {
    console.error(`${stamp()} Refill failed: ${e.stack ?? e}`);
    process.exit(1);
  });
}
