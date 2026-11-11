#!/usr/bin/env node
// CLI for humans and tests.
//   node builder/cli.mjs create <dir> --name "<name>" [--slug <slug>] [--package <id>] [--preset react-native|kotlin|expo-exact]
//   node builder/cli.mjs build <dir> --build-number <n> [--quiet] [--update-feed <url>] [--update-testing-feed <url>]
//   node builder/cli.mjs icon <dir>
//   node builder/cli.mjs warm [<spareRootDir>] [--preset react-native|kotlin|expo-exact]
//        (react-native: the deps cache and a spare; kotlin: a spare and one warm-up build for Gradle's caches)
//   node builder/cli.mjs keys list | backup <file> | restore <file> | move <app dir>
//        (signing keys, docs/DISTRIBUTION.md; the password comes from ANYAPP_KEYS_PASSWORD or is asked for)
import path from 'node:path';

import { appSigningKind, backupSigningKeys, buildApk, createApp, getIconPath, listSigningKeys, moveAppToOwnKey, restoreSigningKeys } from './index.mjs';
import { readAppMeta } from './lib/presets.mjs';
import { ensureDepsCache } from './lib/template.mjs';
import { refillSpares, spareRootFor } from './lib/spare.mjs';

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(`usage:
  node builder/cli.mjs create <dir> --name "<name>" [--slug <slug>] [--package <id>] [--preset react-native|kotlin|expo-exact]
  node builder/cli.mjs build <dir> --build-number <n> [--quiet]
  node builder/cli.mjs icon <dir>
  node builder/cli.mjs warm [<dir-on-the-apps-volume>] [--preset react-native|kotlin|expo-exact]
  node builder/cli.mjs keys list | backup <file> | restore <file> | move <app dir>`);
  process.exit(2);
}

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'quiet') flags.quiet = true;
      else {
        if (argv[i + 1] === undefined) usage(`--${k} needs a value`);
        flags[k] = argv[++i];
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

/** "Prayer Times!" -> "prayer-times" */
function slugify(name) {
  return (
    String(name)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'app'
  );
}

/** "prayer-times" -> "com.anyapp.prayertimes" */
function packageFor(slug) {
  let s = slug.replace(/[^a-z0-9]/g, '');
  if (!/^[a-z]/.test(s)) s = `app${s}`;
  return `com.anyapp.${s}`;
}

const { pos, flags } = parse(process.argv.slice(2));
const [cmd, dirArg] = pos;
const log = (l) => console.error(l);

try {
  if (cmd === 'create') {
    if (!dirArg || !flags.name) usage('create needs <dir> and --name');
    const dir = path.resolve(dirArg);
    const slug = flags.slug ?? slugify(flags.name);
    const packageName = flags.package ?? packageFor(slug);
    const t0 = Date.now();
    const preset = flags.preset ?? 'react-native';
    await createApp({ dir, name: flags.name, slug, packageName, preset, onLog: log });
    console.log(JSON.stringify({ dir, name: flags.name, slug, packageName, preset, ms: Date.now() - t0 }, null, 2));
  } else if (cmd === 'build') {
    if (!dirArg || !flags['build-number']) usage('build needs <dir> and --build-number');
    const result = await buildApk({
      dir: path.resolve(dirArg),
      buildNumber: Number(flags['build-number']),
      ...(flags['update-feed'] ? { updateFeed: flags['update-feed'] } : {}),
      ...(flags['update-testing-feed'] ? { updateTestingFeed: flags['update-testing-feed'] } : {}),
      onLog: flags.quiet ? undefined : log,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (cmd === 'icon') {
    if (!dirArg) usage('icon needs <dir>');
    console.log(getIconPath({ dir: path.resolve(dirArg) }) ?? 'null');
  } else if (cmd === 'warm') {
    const t0 = Date.now();
    const preset = flags.preset ?? 'react-native';
    if (preset === 'react-native') {
      const deps = await ensureDepsCache(log);
      log(`Deps cache: ${deps.dir}`);
    }
    if (preset === 'expo-exact') {
      // No spare: the pinned, patched Exact checkout and its one-time setup (lib/exact.mjs).
      const { ensureExact, exactEnv, exactDirFor } = await import('./lib/exact.mjs');
      const { androidEnv } = await import('./lib/env.mjs');
      const probe = path.resolve(dirArg ?? 'C:\\aa\\apps\\x');
      const { env, javaHome, sdk } = androidEnv();
      log(`Exact checkout: ${await ensureExact(probe, log, { env: exactEnv(env, { javaHome, sdk, exactDir: exactDirFor(probe) }).env })}`);
    } else {
      const root = spareRootFor(path.resolve(dirArg ?? 'C:\\aa\\apps\\x'), preset);
      await refillSpares(root, log, preset);
    }
    log(`Warm in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else if (cmd === 'keys') {
    await keys(pos[1], pos[2]);
  } else {
    usage(cmd ? `unknown command "${cmd}"` : undefined);
  }
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}

/** The package id of the app in `dir` (app.json for React Native, anyapp.json otherwise). */
async function packageOf(dir) {
  const meta = readAppMeta(dir);
  if (meta?.package) return meta.package;
  const fs = await import('node:fs');
  return JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).expo?.android?.package;
}

/** The backup password, never echoed or printed. */
async function password(confirm) {
  if (process.env.ANYAPP_KEYS_PASSWORD) return process.env.ANYAPP_KEYS_PASSWORD;
  if (!process.stdin.isTTY) usage('set ANYAPP_KEYS_PASSWORD (no terminal to ask for the password)');
  const ask = (q) =>
    new Promise((resolve) => {
      process.stderr.write(q);
      let text = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const on = (ch) => {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', on);
          process.stderr.write('\n');
          resolve(text);
        } else if (ch === '\u0003') process.exit(130);
        else if (ch === '\b' || ch === '\u007f') text = text.slice(0, -1);
        else text += ch;
      };
      process.stdin.on('data', on);
    });
  const first = await ask('Backup password: ');
  if (confirm && (await ask('Again: ')) !== first) throw new Error('The passwords are not the same.');
  return first;
}

async function keys(sub, arg) {
  if (sub === 'list') {
    console.log(JSON.stringify(await listSigningKeys(), null, 2));
  } else if (sub === 'backup') {
    if (!arg) usage('keys backup needs <file>');
    const r = await backupSigningKeys({ file: path.resolve(arg), password: await password(true) });
    console.log(JSON.stringify(r, null, 2));
  } else if (sub === 'restore') {
    if (!arg) usage('keys restore needs <file>');
    console.log(JSON.stringify(await restoreSigningKeys({ file: path.resolve(arg), password: await password(false) }), null, 2));
  } else if (sub === 'move') {
    if (!arg) usage('keys move needs <app dir>');
    const packageName = await packageOf(path.resolve(arg));
    if (appSigningKind({ packageName }) !== 'shared') throw new Error(`${packageName} already has its own key.`);
    console.log(JSON.stringify({ packageName, ...(await moveAppToOwnKey({ packageName, onLog: log })) }, null, 2));
  } else usage('keys needs list, backup, restore or move');
}
