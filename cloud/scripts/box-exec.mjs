// Runs one shell command on a box (dev): node scripts/box-exec.mjs <machine id> '<bash command>' [timeoutSeconds]
// No secrets ever go through here: it is for looking at a box.
import { env } from './dev.mjs';
const [id, cmd, t = '60'] = process.argv.slice(2);
const res = await fetch(`https://api.instabox.sh/v1/machines/${id}/exec`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.INSTABOX_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `x-${Date.now()}` },
  body: JSON.stringify({ argv: ['bash', '-lc', cmd], timeoutSeconds: Number(t) }),
});
const j = await res.json();
if (!res.ok) console.log(res.status, JSON.stringify(j).slice(0, 500));
else {
  process.stdout.write(j.stdout ?? '');
  if (j.stderr) process.stdout.write(`[stderr]\n${j.stderr}`);
  console.log(`[exit ${j.exitCode}${j.timedOut ? ', timed out' : ''}]`);
}
