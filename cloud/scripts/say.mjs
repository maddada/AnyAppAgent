// Sends one message to an app's chat as the proof's signed-in stand-in (dev): node scripts/say.mjs <session file> <appId> "<text>"
import fs from 'node:fs';
import { env } from './dev.mjs';
const [file, appId, text] = process.argv.slice(2);
const token = fs.readFileSync(file, 'utf8').trim();
const res = await fetch(`${env.CONVEX_URL}/api/mutation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ path: 'chat:send', args: { appId, text }, format: 'json' }) });
console.log((await res.json()).status);
