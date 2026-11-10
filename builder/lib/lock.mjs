// Cross-process lock files (exclusive create), with stale-lock recovery.
import fs from 'node:fs';
import fsp from 'node:fs/promises';

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tries once to take the lock. Returns a release function, or null if someone else holds it. */
export async function tryLock(file, { staleMs = 30 * 60_000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fsp.open(file, 'wx');
      await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await fh.close();
      return async () => {
        await fsp.rm(file, { force: true });
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let info = {};
      try {
        info = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        /* half-written lock: treat by age */
      }
      const age = Date.now() - (info.at ?? fs.statSync(file).mtimeMs);
      const stale = (info.pid && !pidAlive(info.pid)) || age > staleMs;
      if (!stale) return null;
      await fsp.rm(file, { force: true });
    }
  }
  return null;
}

/** Waits for the lock (polling), runs fn, releases. */
export async function withFileLock(file, fn, { staleMs, timeoutMs = 30 * 60_000 } = {}) {
  const start = Date.now();
  let release;
  while (!(release = await tryLock(file, { staleMs }))) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for lock ${file}`);
    await sleep(500);
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}
