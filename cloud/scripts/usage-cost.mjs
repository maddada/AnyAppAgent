// Adds up a runner log's usage lines at list price (convex/config.ts MODEL_PRICES):
//   node scripts/usage-cost.mjs <runner.log>...
import fs from 'node:fs';

const PRICES = { 'claude-opus-5-5': [4, 20, 5, 0.2], 'claude-sonnet-5-5': [2, 10, 2.5, 0.1] };
const by = {};
let total = 0;
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/usage (\S+)(?: (deep|focused|simple))? (claude-[a-z0-9-]+)\/(\S+): in (\d+), out (\d+), cache write (\d+), cache read (\d+)/g)) {
    const [, role, level, model, effort, i, o, w, r] = m;
    const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
    const usd = (Number(i) * p[0] + Number(o) * p[1] + Number(w) * p[2] + Number(r) * p[3]) / 1e6;
    const key = `${role}${level ? ` ${level}` : ''} ${model}/${effort}`;
    by[key] = (by[key] ?? 0) + usd;
    total += usd;
  }
}
for (const [k, v] of Object.entries(by)) console.log(`${k}: $${v.toFixed(3)}`);
console.log(`total: $${total.toFixed(3)}`);
