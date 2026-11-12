// A tiny Instabox REST helper for scripts: reads the API key from the secrets file, never prints it.
//   node scripts/ib.mjs GET /v1/machines
import { readEnvFile } from '../spike/github-app.mjs';
const [method = 'GET', path = '/v1/machines', body] = process.argv.slice(2);
const key = readEnvFile().INSTABOX_API_KEY;
const res = await fetch(`https://api.instabox.sh${path}`, {
  method,
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'Idempotency-Key': `s-${Date.now()}` } : {}) },
  body: body ?? undefined,
});
const text = await res.text();
console.log(res.status, text.length > 6000 ? text.slice(0, 6000) + '...' : text);
