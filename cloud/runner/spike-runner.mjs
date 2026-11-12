#!/usr/bin/env node
// The spike's runner (milestone 0 of docs/CLOUD.md): the smallest loop that proves phone -> Convex
// -> box -> Convex -> phone. It long-polls Convex for a prompt, runs one agent turn over ACP (the
// Claude Agent SDK's ACP adapter, as the companion does), posts the reply with its usage, builds
// the app with the builder (Gradle never sees the key: ANYAPP_SIGN_LATER=1), uploads the x86_64
// APK to Convex file storage and posts the build. Milestone 2 replaces it with server/'s real
// runner (events sink, helpers, pages, build cycle).
//
// Plain Node 22, no dependencies. Secrets: the runner token and (key-proxy mode only) the
// Anthropic key are read from stdin as JSON at start, never from argv, files or env, never logged.
//
//   echo '{"runnerToken":"...","anthropicKey":"..."}' | node spike-runner.mjs \
//     --convex https://<name>.convex.site --app /data/apps/spike --once
//
// Modes for the AI key:
//   instabox   (default when no anthropicKey is given) the agent gets ANTHROPIC_API_KEY from its
//              login shell: Instabox's Secrets proxy placeholder (ibsec_...), never the real key.
//   key-proxy  the runner holds the key in memory and serves a local forwarder on 127.0.0.1; the
//              agent runs as another Unix user (`agent`) with ANTHROPIC_BASE_URL pointing at it and
//              a dummy key, so the real key is never in the agent's environment or files.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import readline from 'node:readline';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const CONVEX = String(args.convex ?? '').replace(/\/$/, '');
const APP = path.resolve(String(args.app ?? '/data/apps/spike'));
const BUILDER = String(args.builder ?? '/opt/anyapp/repo/builder/cli.mjs');
const AGENT_USER = String(args['agent-user'] ?? 'agent');
const MODEL = String(args.model ?? 'claude-opus-5-5');
const EFFORT = String(args.effort ?? 'high');
const ACP_BIN = String(args.acp ?? 'claude-agent-acp');
const ONCE = Boolean(args.once);
const SKIP_BUILD = Boolean(args['skip-build']);

// List prices per million tokens (docs/CLOUD.md section 7): in, out, cache write, cache read.
const PRICES = { opus: [4, 20, 5, 0.2], sonnet: [2, 10, 2.5, 0.1] };

const log = (...m) => console.log(new Date().toISOString(), ...m);

async function readSecrets() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const s = JSON.parse(raw || '{}');
  if (!s.runnerToken) throw new Error('stdin must carry {"runnerToken": ...}');
  return s;
}

async function convex(route, body, token) {
  const res = await fetch(`${CONVEX}${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${route}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** A local forwarder to api.anthropic.com that adds the key (key-proxy mode). */
function startKeyProxy(key) {
  const server = http.createServer((req, res) => {
    const headers = { ...req.headers, host: 'api.anthropic.com', 'x-api-key': key };
    delete headers.authorization;
    const up = https.request({ host: 'api.anthropic.com', port: 443, method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: e.message } }));
    });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/** Minimal ACP client over stdio (newline-delimited JSON-RPC), as server/src/acp does it. */
class Acp {
  constructor(cmd, argv, env) {
    this.child = spawn(cmd, argv, { cwd: APP, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.next = 1;
    this.pending = new Map();
    this.text = '';
    this.tools = [];
    this.child.stderr.on('data', (d) => {
      const s = String(d).trim();
      if (s && !/key|token|secret/i.test(s)) this.stderr = (this.stderr ?? '') + s.slice(0, 500) + '\n';
    });
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => this.onLine(line));
    this.child.on('exit', (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`agent exited (${code}): ${(this.stderr ?? '').slice(-400)}`));
    });
  }
  send(msg) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  }
  request(method, params) {
    const id = this.next++;
    this.send({ id, method, params });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  onLine(line) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id !== undefined && (m.result !== undefined || m.error)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) p?.reject(new Error(m.error.message ?? JSON.stringify(m.error)));
      else p?.resolve(m.result);
      return;
    }
    if (m.method === 'session/update') {
      const u = m.params?.update ?? {};
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') this.text += u.content.text;
      if (u.sessionUpdate === 'tool_call' && u.title) this.tools.push(u.title);
      return;
    }
    if (m.method === 'session/request_permission' && m.id !== undefined) {
      // Unattended, as on the PC: allow (the session is in bypassPermissions mode anyway).
      const opts = m.params?.options ?? [];
      const pick = opts.find((o) => /allow_always/.test(o.kind)) ?? opts.find((o) => /allow/.test(o.kind)) ?? opts[0];
      this.send({ id: m.id, result: { outcome: pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' } } });
      return;
    }
    if (m.id !== undefined && m.method) this.send({ id: m.id, error: { code: -32601, message: `${m.method} is not supported` } });
  }
  kill() {
    this.child.kill('SIGTERM');
  }
}

function priceOf(model, u) {
  const p = /sonnet/i.test(model) ? PRICES.sonnet : PRICES.opus;
  const usd = (u.inputTokens * p[0] + u.outputTokens * p[1] + u.cacheWriteTokens * p[2] + u.cacheReadTokens * p[3]) / 1e6;
  return Math.round(usd * 1e6); // micros
}

function own(user) {
  // The agent works in the app folder as its own Unix user; the runner takes it back to build.
  spawnSync('sudo', ['chown', '-R', `${user}:${user}`, APP], { stdio: 'inherit' });
}

async function agentTurn(prompt, secrets, keyProxyPort) {
  const t0 = Date.now();
  const useProxy = Boolean(keyProxyPort);
  let cmd = ACP_BIN;
  let argv = [];
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  if (useProxy) {
    own(AGENT_USER);
    // sudo -u agent: another Unix user, so it cannot read the runner's memory or files.
    cmd = 'sudo';
    argv = [
      '-u', AGENT_USER, '-H', 'env', '-i',
      `PATH=${process.env.PATH}`,
      `HOME=/home/${AGENT_USER}`,
      'LANG=C.UTF-8',
      `ANTHROPIC_BASE_URL=http://127.0.0.1:${keyProxyPort}`,
      'ANTHROPIC_API_KEY=sk-ant-placeholder-not-a-key',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
      // The box's outbound HTTPS goes through Instabox's proxy, which re-signs with its own CA.
      'NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/instabox-proxy.crt',
      'SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt',
      ACP_BIN,
    ];
  } else {
    // Instabox mode: the login shell's ANTHROPIC_API_KEY is the Secrets proxy placeholder.
    cmd = 'bash';
    argv = ['-lc', `exec ${ACP_BIN}`];
  }
  const acp = new Acp(cmd, argv, env);
  try {
    await acp.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    const s = await acp.request('session/new', { cwd: APP, mcpServers: [] });
    const sessionId = s.sessionId;
    const opts = (s.configOptions ?? []).map((o) => ({ id: o.id, category: o.category, current: o.currentValue }));
    log('config options', JSON.stringify(opts));
    await acp.request('session/set_mode', { sessionId, modeId: 'bypassPermissions' }).catch((e) => log('set_mode failed', e.message));
    // The model first, then the effort (the adapter offers effort levels per model).
    const isModel = (o) => o.category === 'model' || o.id === 'model';
    const isEffort = (o) => o.category === 'thought_level' || o.id === 'effort';
    let options = s.configOptions ?? [];
    const modelOpt = options.find(isModel);
    if (modelOpt) options = (await acp.request('session/set_config_option', { sessionId, configId: modelOpt.id, value: MODEL })).configOptions ?? options;
    const effortOpt = options.find(isEffort);
    if (effortOpt) options = (await acp.request('session/set_config_option', { sessionId, configId: effortOpt.id, value: EFFORT })).configOptions ?? options;
    const now = Object.fromEntries(options.filter((o) => isModel(o) || isEffort(o)).map((o) => [o.id, o.currentValue]));
    log('session', sessionId, 'model and effort', JSON.stringify(now));
    const result = await acp.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] });
    const u = result?.usage ?? {};
    const usage = {
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      cacheWriteTokens: u.cachedWriteTokens ?? 0,
      cacheReadTokens: u.cachedReadTokens ?? 0,
    };
    return { text: acp.text.trim(), tools: acp.tools, stopReason: result?.stopReason, usage: { ...usage, costMicros: priceOf(MODEL, usage) }, ms: Date.now() - t0, sessionId, settings: now };
  } finally {
    acp.kill();
    if (useProxy) own(process.env.USER ?? 'madda');
  }
}

function build(n) {
  const t0 = Date.now();
  const r = spawnSync('node', [BUILDER, 'build', APP, '--build-number', String(n)], {
    env: { ...process.env, ANYAPP_SIGN_LATER: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const json = /\{[\s\S]*"apkPath"[\s\S]*\}\s*$/.exec(r.stdout ?? '')?.[0];
  let result = null;
  try {
    result = json ? JSON.parse(json) : null;
  } catch {}
  return { ok: r.status === 0, result, ms: Date.now() - t0, tail: out.split('\n').slice(-15).join('\n') };
}

async function upload(file, token) {
  const { url } = await convex('/runner/upload-url', {}, token);
  const data = fs.readFileSync(file);
  const t0 = Date.now();
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/vnd.android.package-archive' }, body: data });
  if (!res.ok) throw new Error(`upload: ${res.status}`);
  const { storageId } = await res.json();
  return { storageId, ms: Date.now() - t0, bytes: data.length };
}

function nextBuildNumber() {
  const dir = path.join(APP, 'build', 'apk');
  const nums = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => Number(/-(\d+)(?:-[\w-]+)?\.apk$/.exec(f)?.[1] ?? 0)) : [];
  return Math.max(0, ...nums) + 1;
}

async function main() {
  const secrets = await readSecrets();
  const token = secrets.runnerToken;
  let proxy = null;
  if (secrets.anthropicKey) {
    proxy = await startKeyProxy(secrets.anthropicKey);
    log(`key-proxy mode: forwarder on 127.0.0.1:${proxy.port}, agent runs as ${AGENT_USER}`);
  } else log('instabox mode: the agent uses the Secrets proxy placeholder');
  const metrics = [];
  for (;;) {
    const { item } = await convex('/runner/take', {}, token);
    if (!item) {
      if (ONCE && metrics.length) break;
      continue;
    }
    log('prompt', JSON.stringify(item.text.slice(0, 120)));
    await convex('/runner/post', { threadId: item.threadId, role: 'status', text: 'Working on it…' }, token);
    let turn;
    try {
      turn = await agentTurn(item.text, secrets, proxy?.port);
    } catch (e) {
      await convex('/runner/post', { threadId: item.threadId, role: 'status', text: `The agent stopped: ${e.message.slice(0, 300)}` }, token);
      log('turn failed', e.message);
      if (ONCE) break;
      continue;
    }
    log('turn', JSON.stringify({ ms: turn.ms, stopReason: turn.stopReason, usage: turn.usage, tools: turn.tools.length, settings: turn.settings }));
    await convex('/runner/post', { threadId: item.threadId, role: 'agent', text: turn.text || '(no text)', usage: turn.usage }, token);
    const m = { turn };
    if (!SKIP_BUILD) {
      const n = nextBuildNumber();
      const b = build(n);
      m.build = { ok: b.ok, ms: b.ms, delivery: b.result?.delivery, timings: b.result?.timings };
      log('build', JSON.stringify(m.build));
      if (!b.ok) {
        await convex('/runner/post', { threadId: item.threadId, role: 'status', text: `Build ${n} failed:\n${b.tail.slice(-600)}` }, token);
      } else {
        const x86 = b.result.variants?.find((v) => v.abi === 'x86_64')?.apkPath ?? b.result.apkPath;
        const up = await upload(x86, token);
        m.upload = { ms: up.ms, bytes: up.bytes };
        log('upload', JSON.stringify(m.upload));
        const how = b.result.delivery === 'quick' ? 'quick update (no Gradle)' : 'full build';
        await convex('/runner/post', { threadId: item.threadId, role: 'build', text: `Version ${n} is ready (${how}, ${(b.ms / 1000).toFixed(0)} s)`, apkFileId: up.storageId }, token);
      }
    }
    metrics.push(m);
    fs.writeFileSync(path.join(process.env.HOME ?? '/tmp', 'runner-metrics.json'), JSON.stringify(metrics, null, 2));
    if (ONCE) break;
  }
  proxy?.server.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
