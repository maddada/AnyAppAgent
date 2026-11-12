// Milestone 8 proof, step 1: a real PC app for the move, made straight from the builder's template
// (no agent) in the proof's own folders: its signing key goes to ANYAPP_HOME (the proof's own
// C:\aa\t\cb-home, never the person's %USERPROFILE%\.anyappagent), its code to the proof
// companion's apps folder, and it joins that companion's state with a short chat and a to-do. The
// companion must be stopped while this runs; it builds version 1 afterwards.
//   ANYAPP_HOME=C:\aa\t\cb-home node scripts/m8-seed-pc-app.mjs <stateDir> <appsDir>
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [stateDir, appsDir] = process.argv.slice(2);
const home = process.env.ANYAPP_HOME ?? '';
if (!/\\aa\\t\\/i.test(home)) throw new Error('Set ANYAPP_HOME to the proof folder (C:\\aa\\t\\...), never the person\'s own.');
const repo = join(import.meta.dirname, '..', '..');
const builder = await import(pathToFileURL(join(repo, 'builder', 'index.mjs')).href);
const { AppManager } = await import(pathToFileURL(join(repo, 'server', 'src', 'apps.ts')).href);
const { Store } = await import(pathToFileURL(join(repo, 'server', 'src', 'store.ts')).href);
const git = await import(pathToFileURL(join(repo, 'server', 'src', 'git.ts')).href);

const slug = 'tipjar';
const dir = join(appsDir, slug);
if (existsSync(dir)) throw new Error(`${dir} exists already`);
await builder.createApp({ dir, name: 'Tip Jar', slug, packageName: 'com.anyapp.tipjar', preset: 'react-native', onLog: (l) => console.log(String(l).slice(0, 160)) });
await git.initRepo(dir, 'First version (Kiwimake template)');

const fake = { kind: 'fake', createApp: async () => ({}), buildApk: async () => ({}), getIconPath: () => null };
const apps = new AppManager({ store: new Store(stateDir), builder: fake, config: { stateDir, appsDir, github: false, maxBuildFixes: 3 }, broadcast: () => {}, log: () => {} });
const now = new Date().toISOString();
const app = apps.adoptMovedApp(
  { id: crypto.randomUUID(), name: 'Tip Jar', slug, packageName: 'com.anyapp.tipjar', preset: 'react-native', status: 'idle', iconVersion: 1, signing: 'own', createdAt: now, updatedAt: now },
  dir,
  [
    { id: crypto.randomUUID(), appId: 'x', seq: 1, kind: 'user', text: 'A tip jar: tap to add a coin, see the total. (Seeded for the move proof.)', createdAt: now, updatedAt: now },
    { id: crypto.randomUUID(), appId: 'x', seq: 2, kind: 'assistant', text: 'Made from the Kiwimake template; this PC builds version 1.', createdAt: now, updatedAt: now },
  ],
  [{ id: crypto.randomUUID(), text: 'Add a reset button', done: false, createdAt: now, updatedAt: now }],
);
apps.store?.flush?.();
await new Promise((r) => setTimeout(r, 600));
console.log(`seeded ${app.name} ${app.id} in ${dir}`);
