// The browser page a desktop opens to link its PC (docs/CLOUD.md section 3, milestone 7): the
// person signs in (Google, a code by email, or the dev test account), checks that the code matches
// the one on their PC, and says yes. It talks to Convex's own HTTP API (auth:signIn, then
// pclinks:approve with the session it got); the PC collects its link by polling.

export type PageConfig = {
  cloudUrl: string;
  code: string;
  google: boolean;
  email: boolean;
  testAccount: boolean;
};

export function pcLinkPage(cfg: PageConfig): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link your PC</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600&family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#F3EFE7;--surface:#FBF9F4;--text:#1F1B16;--text2:#575046;--border:#DED6C8;--accent:#1D6A4A;--on-accent:#F7F4EC;--problem:#A33A2A}
@media (prefers-color-scheme:dark){:root{--bg:#181613;--surface:#211E1A;--text:#EEE8DD;--text2:#BDB3A5;--border:#332F29;--accent:#6DBB8F;--on-accent:#0E2117;--problem:#E58A78}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 "IBM Plex Sans",system-ui,sans-serif}
main{max-width:480px;margin:0 auto;padding:48px 16px}
h1{font:600 32px/1.15 "Bricolage Grotesque",system-ui,sans-serif;margin:0 0 8px}
p{margin:0 0 16px;color:var(--text2)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;margin:0 0 16px}
.code{font:500 28px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:2px;color:var(--text);margin:4px 0 0}
.label{font-size:13px;color:var(--text2)}
.actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px}
button{font:500 15px "IBM Plex Sans",system-ui,sans-serif;border-radius:999px;border:0;padding:10px 18px;cursor:pointer}
.primary{background:var(--accent);color:var(--on-accent)}
.quiet{background:transparent;color:var(--text);box-shadow:inset 0 0 0 1px var(--border)}
input{width:100%;font:16px "IBM Plex Sans",system-ui,sans-serif;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);margin-top:12px}
input:focus{outline:2px solid var(--accent);outline-offset:0}
.problem{color:var(--problem)}
[hidden]{display:none!important}
</style></head><body><main>
<h1 id="title">Link your PC</h1>
<p id="lede">Sign in to your Kiwimake account so your PC can share apps, publish web apps and move apps to the cloud for you.</p>
<div class="card" id="codeCard"><div class="label">Check that your PC shows this code</div><div class="code" id="code"></div><div class="label" id="device"></div></div>
<div class="card" id="choose" hidden>
  <div>Sign in to link it</div>
  <div class="actions">
    ${cfg.testAccount ? '<button class="quiet" id="test">Test account (dev)</button>' : ''}
    ${cfg.email ? '<button class="quiet" id="emailBtn">Email me a code</button>' : ''}
    ${cfg.google ? '<button class="primary" id="google">Continue with Google</button>' : ''}
  </div>
</div>
<div class="card" id="emailCard" hidden>
  <div id="emailLine">Your email address</div>
  <input id="emailIn" type="email" autocomplete="email" placeholder="you@example.com">
  <input id="otpIn" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" hidden>
  <div class="actions"><button class="primary" id="emailGo">Send the code</button></div>
</div>
<div class="card" id="done" hidden><div id="doneLine"></div></div>
<p class="problem" id="problem" hidden></p>
<script>
const CLOUD = ${JSON.stringify(cfg.cloudUrl)};
const params = new URLSearchParams(location.search);
const CODE = (params.get('l') || ${JSON.stringify(cfg.code)}).toUpperCase();
const $ = (id) => document.getElementById(id);
const show = (id, on) => { const e = $(id); if (e) e.hidden = !on; };
function problem(text) { $('problem').textContent = text; show('problem', !!text); }
async function call(kind, path, args, token) {
  const res = await fetch(CLOUD + '/api/' + kind, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.status !== 'success') throw new Error(body.errorMessage || 'Something went wrong. Try again.');
  return body.value;
}
const clean = (m) => String(m).replace(/^.*Uncaught Error: /s, '').split('\\n')[0].replace(/ at .*$/, '');
async function approve(tokens) {
  const r = await call('mutation', 'pclinks:approve', { code: CODE }, tokens.token);
  show('choose', false); show('emailCard', false); show('codeCard', false);
  $('title').textContent = 'Your PC is linked';
  $('lede').textContent = '';
  $('doneLine').textContent = (r.email ? r.email + ' is now linked to ' : 'Your account is now linked to ') + r.deviceName + '. Go back to Kiwimake on your PC; you can close this page.';
  show('done', true);
}
async function signIn(args) {
  const v = await call('action', 'auth:signIn', args);
  if (v && v.tokens) return approve(v.tokens);
  return v;
}
async function start() {
  try {
    const r = await call('query', 'pclinks:request', { code: CODE });
    if (r.state === 'gone') { $('title').textContent = 'This code has run out'; $('lede').textContent = 'Start again from Kiwimake on your PC: Settings, Account, Sign in in the browser.'; show('codeCard', false); return; }
    $('code').textContent = r.code;
    $('device').textContent = 'From ' + r.deviceName;
    if (r.state === 'approved') { $('title').textContent = 'Your PC is linked'; $('lede').textContent = 'Go back to Kiwimake on your PC.'; return; }
    const oauth = params.get('code');
    const verifier = sessionStorage.getItem('kiwiVerifier');
    if (oauth && verifier) {
      sessionStorage.removeItem('kiwiVerifier');
      history.replaceState(null, '', location.pathname + '?l=' + CODE);
      return signIn({ params: { code: oauth }, verifier });
    }
    show('choose', true);
  } catch (e) { problem(clean(e.message)); }
}
const on = (id, fn) => { const e = $(id); if (e) e.onclick = async () => { problem(''); e.disabled = true; try { await fn(); } catch (err) { problem(clean(err.message)); } finally { e.disabled = false; } }; };
on('test', () => signIn({ provider: 'anonymous' }));
on('google', async () => {
  const v = await call('action', 'auth:signIn', { provider: 'google', params: { redirectTo: location.origin + '/pc/link?l=' + CODE } });
  sessionStorage.setItem('kiwiVerifier', v.verifier);
  location.href = v.redirect;
});
on('emailBtn', () => { show('choose', false); show('emailCard', true); $('emailIn').focus(); });
let sent = false;
on('emailGo', async () => {
  const email = $('emailIn').value.trim();
  if (!sent) {
    await signIn({ provider: 'resend-otp', params: { email } });
    sent = true;
    $('emailLine').textContent = 'We sent a code to ' + email + '. It works for 10 minutes.';
    show('emailIn', false); show('otpIn', true); $('otpIn').focus();
    $('emailGo').textContent = 'Sign in';
    return;
  }
  await signIn({ provider: 'resend-otp', params: { email, code: $('otpIn').value.trim() } });
});
start();
</script></main></body></html>`;
}
