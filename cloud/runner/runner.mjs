#!/usr/bin/env node
// The box's runner (docs/CLOUD.md section 3). Started by Convex through boxes.ts's boot script
// with the runner token on stdin; runs server/src/cloud-runner.ts (the companion's work loop with
// its events going to Convex) until the token stops working.
//   node cloud/runner/runner.mjs --convex https://<name>.convex.site --pid-file <file>
//        [--state /data/kiwi/state] [--apps /data/apps] [--port 8790] [--agent-prefix '<json array>']
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argsOf, ConvexLink, readStdinJson } from './convex-link.mjs';

const args = argsOf(process.argv.slice(2));
const log = (...m) => console.log(new Date().toISOString(), ...m);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENT_WRAPPER = '/opt/kiwi/agent.sh';

async function main() {
  const secrets = await readStdinJson();
  if (!secrets.runnerToken) throw new Error('stdin must carry {"runnerToken": ...}');
  if (args['pid-file']) fs.writeFileSync(String(args['pid-file']), String(process.pid));
  // Files the agent writes in the apps folder stay group-writable for us (the kiwi group).
  process.umask(0o002);
  // The agent's AI key: Instabox's proxy placeholder for this box (ibsec_...), never a real key.
  // The agent may read it on purpose: the proxy swaps the real key in on the way out.
  const placeholder = process.env.ANTHROPIC_API_KEY ?? '';
  if (/^ibsec_[A-Za-z0-9_-]+$/.test(placeholder) && fs.existsSync('/opt/kiwi/agent-env')) {
    fs.writeFileSync('/opt/kiwi/agent-env', `export ANTHROPIC_API_KEY=${placeholder}\n`);
  }
  const link = new ConvexLink(String(args.convex), secrets.runnerToken, log);
  const hello = await link.hello();
  log('hello', JSON.stringify({ app: hello.slug, buildHigh: hello.buildHigh, hasKey: Boolean(hello.certSha256) }));

  // The companion's config, for the cloud (server/src/config.ts, cloud-settings.ts).
  const prefix = args['agent-prefix'] ? String(args['agent-prefix']) : fs.existsSync(AGENT_WRAPPER) ? JSON.stringify(['sudo', '-n', '-u', 'agent', '-H', AGENT_WRAPPER]) : '[]';
  Object.assign(process.env, {
    ANYAPP_CLOUD: '1',
    ANYAPP_AGENT_PREFIX: prefix,
    ANYAPP_STATE_DIR: String(args.state ?? '/data/kiwi/state'),
    ANYAPP_APPS_DIR: String(args.apps ?? '/data/apps'),
    ANYAPP_PORT: String(args.port ?? 8790),
    ANYAPP_HOST: '127.0.0.1',
    ANYAPP_GITHUB: 'off',
    ANYAPP_BUILDER: 'real',
    // Page files the agent writes: in a folder it shares with the runner (the kiwi group).
    ANYAPP_PAGE_DRAFTS_DIR: path.join(String(args.apps ?? '/data/apps'), '.pages'),
  });
  const { runCloudRunner } = await import(pathToFileURL(path.join(REPO, 'server', 'src', 'cloud-runner.ts')).href);
  await runCloudRunner({ link, hello, log });
  log('runner stopped');
}

main()
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (args['pid-file']) fs.rmSync(String(args['pid-file']), { force: true });
    process.exit();
  });
