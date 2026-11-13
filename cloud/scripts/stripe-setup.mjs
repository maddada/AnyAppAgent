// Stripe test mode for the dev deployment (docs/CLOUD.md section 11): makes the webhook endpoint
// that Convex listens on, saves its signing secret, and sets both secrets on the dev deployment.
// Test mode only: refuses any key that is not sk_test_. No secret is ever printed: the signing
// secret goes from Stripe's answer straight into the secrets file and to Convex's CLI on stdin.
//   node scripts/stripe-setup.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env, setVar } from './dev.mjs';

const FILE = path.join(os.homedir(), '.appwin-secrets', 'cloud-dev.env');
const URL_ = 'https://perceptive-gnu-478.convex.site/stripe/webhook';
const EVENTS = ['checkout.session.completed', 'invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted'];

const key = env.STRIPE_SECRET_KEY ?? '';
if (!/^sk_test_[A-Za-z0-9]+$/.test(key)) throw new Error('STRIPE_SECRET_KEY must be a test key (sk_test_)');

async function stripe(method, p, form) {
  const res = await fetch(`https://api.stripe.com/v1${p}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${p}: ${res.status} ${json?.error?.message ?? ''}`);
  return json;
}

function writeVar(name, value) {
  const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith(`${name}=`));
  lines.push(`${name}=${value}`);
  fs.writeFileSync(FILE, lines.join('\n') + '\n');
}

const existing = (await stripe('GET', '/webhook_endpoints?limit=100')).data.filter((e) => e.url === URL_);
console.log(`test mode: ${!(await stripe('GET', '/balance')).livemode}; endpoints already on this URL: ${existing.length}`);
if (existing.length && env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
  console.log('an endpoint and its secret exist already: nothing made');
} else {
  // A secret is shown only when an endpoint is made: an old one without its secret here is replaced.
  for (const e of existing) await stripe('DELETE', `/webhook_endpoints/${e.id}`);
  const form = { url: URL_, description: 'Kiwimake Cloud (dev): credits and plans' };
  EVENTS.forEach((ev, i) => (form[`enabled_events[${i}]`] = ev));
  const made = await stripe('POST', '/webhook_endpoints', form);
  if (made.livemode) throw new Error('made in live mode: stop');
  if (!/^whsec_/.test(made.secret ?? '')) throw new Error('no signing secret in the answer');
  writeVar('STRIPE_WEBHOOK_SECRET', made.secret);
  console.log(`made ${made.id} (${made.enabled_events.length} events, status ${made.status}); its secret is in the secrets file`);
}
const now = Object.fromEntries(fs.readFileSync(FILE, 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]));
setVar('STRIPE_SECRET_KEY', now.STRIPE_SECRET_KEY);
setVar('STRIPE_WEBHOOK_SECRET', now.STRIPE_WEBHOOK_SECRET);
