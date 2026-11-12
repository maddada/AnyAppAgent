#!/usr/bin/env node
// A stand-in runner for box lifecycle tests (scripts/m1-proof.mjs, RUNNER_ENTRY=stub-runner.mjs on
// the dev deployment): the Convex side of the loop only (hello, long poll with acks, events, a
// plain reply), no agent and no builds, so a lifecycle run costs no AI.
import fs from 'node:fs';
import { argsOf, ConvexLink, readStdinJson } from './convex-link.mjs';

const args = argsOf(process.argv.slice(2));
const log = (...m) => console.log(new Date().toISOString(), ...m);

async function main() {
  const secrets = await readStdinJson();
  if (!secrets.runnerToken) throw new Error('stdin must carry {"runnerToken": ...}');
  if (args['pid-file']) fs.writeFileSync(String(args['pid-file']), String(process.pid));
  const link = new ConvexLink(String(args.convex), secrets.runnerToken, log);
  const hello = await link.hello();
  log('hello', JSON.stringify({ app: hello.slug, buildHigh: hello.buildHigh }));
  let seq = 1000;
  const now = () => new Date().toISOString();
  for (;;) {
    let item;
    try {
      item = await link.take();
    } catch (e) {
      log('take failed:', e.message);
      if (e.fatal) break;
      continue;
    }
    if (!item) continue;
    log('took', item.kind);
    if (item.kind !== 'prompt') continue;
    link.emit({ type: 'runner.state', busy: true });
    link.emit({ type: 'inbox.done', inboxId: item.id });
    link.emit({ type: 'chat.item', item: { id: `u-${item.id}`, appId: hello.appId, seq: seq++, kind: 'user', text: item.payload.text, createdAt: now(), updatedAt: now() } });
    link.emit({
      type: 'chat.item',
      item: { id: `a-${item.id}`, appId: hello.appId, seq: seq++, kind: 'assistant', text: `The cloud machine for ${hello.name} got your message.`, createdAt: now(), updatedAt: now() },
    });
    link.emit({ type: 'app.updated', app: { id: hello.appId, status: 'idle', replying: false } });
    link.emit({ type: 'runner.state', busy: false });
    await link.flush();
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    if (args['pid-file']) fs.rmSync(String(args['pid-file']), { force: true });
    process.exit();
  });
