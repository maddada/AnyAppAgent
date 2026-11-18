// Drives headless Chromium over the DevTools protocol, without dependencies (test/web.test.mjs).
//   const b = await openBrowser(); const page = await b.page(url); await page.eval("document.title"); await b.close();
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChromium() {
  for (const c of [process.env.CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome']) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

export async function openBrowser({ bin = findChromium(), profile } = {}) {
  if (!bin) throw new Error('no Chromium found');
  const dir = profile ?? fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-cdp-'));
  const child = spawn(bin, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', `--user-data-dir=${dir}`, '--remote-debugging-port=0', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const base = `http://127.0.0.1:${port}`;
  return {
    async page(url) {
      const t = await (await fetch(`${base}/json/new?${encodeURI(url)}`, { method: 'PUT' })).json();
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
      let id = 0;
      const pending = new Map();
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      };
      const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const n = ++id;
          pending.set(n, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
          ws.send(JSON.stringify({ id: n, method, params }));
        });
      await send('Runtime.enable');
      return {
        send,
        async eval(expr) {
          const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          return r.result.value;
        },
        async waitFor(expr, ms = 15000) {
          const end = Date.now() + ms;
          let last;
          while (Date.now() < end) {
            try {
              last = await this.eval(expr);
              if (last) return last;
            } catch {
              /* navigating */
            }
            await sleep(150);
          }
          throw new Error(`timed out waiting for ${expr} (last: ${JSON.stringify(last)})`);
        },
        close: () => ws.close(),
      };
    },
    async close() {
      child.kill('SIGKILL');
      await sleep(200);
      if (!profile) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
