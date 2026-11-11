#!/usr/bin/env node
// CLI for humans and tests.
//   node builder/cli.mjs create <dir> --name "<name>" [--slug <slug>] [--package <id>] [--preset react-native|kotlin]
//   node builder/cli.mjs build <dir> --build-number <n> [--quiet]
//   node builder/cli.mjs icon <dir>
//   node builder/cli.mjs warm [<spareRootDir>] [--preset react-native|kotlin]
//        (react-native: the deps cache and a spare; kotlin: a spare and one warm-up build for Gradle's caches)
import path from 'node:path';

import { buildApk, createApp, getIconPath } from './index.mjs';
import { ensureDepsCache } from './lib/template.mjs';
import { refillSpares, spareRootFor } from './lib/spare.mjs';

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(`usage:
  node builder/cli.mjs create <dir> --name "<name>" [--slug <slug>] [--package <id>] [--preset react-native|kotlin]
  node builder/cli.mjs build <dir> --build-number <n> [--quiet]
  node builder/cli.mjs icon <dir>
  node builder/cli.mjs warm [<dir-on-the-apps-volume>] [--preset react-native|kotlin]`);
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
    const root = spareRootFor(path.resolve(dirArg ?? 'C:\\aa\\apps\\x'), preset);
    await refillSpares(root, log, preset);
    log(`Warm in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
    usage(cmd ? `unknown command "${cmd}"` : undefined);
  }
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}
