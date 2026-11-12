// Starts the spike's runner on a box for one prompt (--once), handing it the runner token and
// (key-proxy mode) the Anthropic key on stdin through `instabox exec --stdin`: never argv, never a
// file on the box, never printed. The runner's own log lines are printed as they come.
//   INSTABOX_BIN=<path to instabox> node cloud/spike/run-runner.mjs <box> [--instabox-secrets]
import { spawn } from 'node:child_process';

import { runnerToken } from './convex.mjs';
import { readEnvFile } from './github-app.mjs';

const box = process.argv[2] ?? 'spike-build';
const viaInstabox = process.argv.includes('--instabox-secrets');
const env = readEnvFile();
const secrets = { runnerToken: runnerToken(), ...(viaInstabox ? {} : { anthropicKey: env.ANTHROPIC_API_KEY }) };
// The instabox executable itself (on Windows the npm .cmd shim needs a shell, which re-splits
// arguments: that once turned stdin into a script and printed it). No shell, fixed arguments.
const bin = process.env.INSTABOX_BIN ?? 'instabox';
if (/\.(cmd|bat)$/i.test(bin)) throw new Error('INSTABOX_BIN must be the executable, not a .cmd shim');
const child = spawn(bin, ['exec', box, '--stdin', '--stream', '--timeout', '600', '--', 'bash', '-l', '/opt/anyapp/cloud/runner/start.sh', env.CONVEX_SITE_URL], {
  env: { ...process.env, INSTABOX_API_KEY: env.INSTABOX_API_KEY },
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.end(JSON.stringify(secrets));
child.on('exit', (code) => process.exit(code ?? 1));
