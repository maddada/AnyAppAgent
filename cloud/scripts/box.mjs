// A dev box by hand, for preparing the image (dev only; the product makes boxes through Convex).
//   node scripts/box.mjs create <name> [snapshot]     (from anyapp-box-v0 by default; prints the id)
//   node scripts/box.mjs delete <id>
//   node scripts/box.mjs snapshot <id> <name>          (stops it, saves it)
//   node scripts/box.mjs upload <id> <local file> <box path> [mode]
import fs from 'node:fs';
import { Instabox } from '../convex/lib/instabox.ts';
import { env } from './dev.mjs';

const ib = new Instabox(env.INSTABOX_API_KEY);
const [cmd, a, b, c, d] = process.argv.slice(2);
if (cmd === 'create') {
  const t = Date.now();
  const box = await ib.create({ name: a, snapshot: b ?? 'anyapp-box-v0', secrets: ['ANTHROPIC_API_KEY'] });
  await ib.waitFor(box.id, ['running'], 6 * 60_000);
  console.log(box.id, `ready in ${((Date.now() - t) / 1000).toFixed(0)} s`);
} else if (cmd === 'delete') {
  await ib.delete(a);
  console.log('deleted', a);
} else if (cmd === 'snapshot') {
  await ib.stop(a);
  await ib.waitFor(a, ['stopped'], 5 * 60_000);
  const s = await ib.snapshot(a, b);
  for (let i = 0; i < 120; i++) {
    const st = await ib.getSnapshot(s.id);
    if (st?.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('snapshot', s.id, b);
} else if (cmd === 'upload') {
  await ib.upload(a, c, fs.readFileSync(b), d);
  console.log('uploaded', c);
} else {
  console.error('usage: create <name> [snapshot] | delete <id> | snapshot <id> <name> | upload <id> <file> <path> [mode]');
  process.exit(2);
}
