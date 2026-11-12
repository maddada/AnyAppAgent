// Saves a value from the secrets file as an Instabox proxy Secret (docs/CLOUD.md section 8), so a
// box only ever sees a placeholder. Uses the signed-in CLI session (`instabox login`), never the API
// key (a personal org's key cannot manage Secrets). The value goes on stdin to the instabox
// executable started without a shell; it is never on a command line or printed.
//   INSTABOX_BIN=<instabox executable> node cloud/spike/instabox-secret.mjs ANTHROPIC_API_KEY --ai anthropic
//   INSTABOX_BIN=<instabox executable> node cloud/spike/instabox-secret.mjs <NAME> --host api.github.com --host github.com
import { spawn } from 'node:child_process';

import { readEnvFile } from './github-app.mjs';

const [name, ...scope] = process.argv.slice(2);
if (!/^[A-Z][A-Z0-9_]*$/.test(name ?? '')) throw new Error('usage: instabox-secret.mjs <NAME> (--ai <provider> | --host <host>)...');
if (!scope.length) throw new Error('give the hosts the Secret may go to (--ai anthropic, --host ...): never every host');
const value = readEnvFile()[name];
if (!value) throw new Error(`${name} is not in the secrets file`);
const bin = process.env.INSTABOX_BIN ?? 'instabox';
if (/\.(cmd|bat)$/i.test(bin)) throw new Error('INSTABOX_BIN must be the executable, not a .cmd shim');
const env = { ...process.env };
delete env.INSTABOX_API_KEY; // the signed-in session, not the API key
const child = spawn(bin, ['secrets', 'set', name, ...scope], { env, stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(value);
child.on('exit', (code) => process.exit(code ?? 1));
