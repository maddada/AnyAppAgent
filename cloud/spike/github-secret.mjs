// Mints a GitHub App installation token for ONE repo (Contents write, 1 hour) and saves it as an
// Instabox proxy Secret scoped to github.com and api.github.com, so a box can push and clone with
// only a placeholder (docs/CLOUD.md section 3, "Pushing from the box"). The token goes from this
// process to the instabox executable on stdin, without a shell; it is never printed or written.
//   INSTABOX_BIN=<instabox executable> node cloud/spike/github-secret.mjs <owner/repo> <SECRET_NAME>
import { spawn } from 'node:child_process';

import { installation, installationToken } from './github-app.mjs';

const [full, name] = process.argv.slice(2);
const [owner, repo] = (full ?? '').split('/');
if (!owner || !repo || !/^[A-Z][A-Z0-9_]*$/.test(name ?? '')) throw new Error('usage: github-secret.mjs <owner/repo> <SECRET_NAME>');
const bin = process.env.INSTABOX_BIN ?? 'instabox';
if (/\.(cmd|bat)$/i.test(bin)) throw new Error('INSTABOX_BIN must be the executable, not a .cmd shim');

const inst = await installation();
const t = await installationToken(inst, { repositories: [repo], permissions: { contents: 'write', metadata: 'read' } });
console.log(JSON.stringify({ repo: full, expires_at: t.expires_at, permissions: t.permissions, repositories: (t.repositories ?? []).map((r) => r.full_name) }));
const env = { ...process.env };
delete env.INSTABOX_API_KEY; // managing Secrets needs the signed-in CLI session
const child = spawn(bin, ['secrets', 'set', name, '--host', 'github.com', '--host', 'api.github.com'], { env, stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(t.token);
child.on('exit', (code) => process.exit(code ?? 1));
