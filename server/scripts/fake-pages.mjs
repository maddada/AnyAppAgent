#!/usr/bin/env node
// A local stand-in for GitHub Pages, for tests and the proof run (docs/WEB-APPS.md). It serves the
// main branch of every bare repo the companion pushed to with ANYAPP_WEB_HOST=local:
//   node server/scripts/fake-pages.mjs <ANYAPP_WEB_LOCAL_DIR> <port> [login]
//   GET /anyapp-<slug>-web/<path>  ->  <dir>/<login>/anyapp-<slug>-web.git, main:<path>
// Like GitHub Pages: a folder serves its index.html, a folder without the slash redirects to it,
// files are served with Cache-Control max-age=600, and anything missing is a 404. It reads the
// pushed commit itself (git cat-file), so it proves exactly what was pushed is what is served.
// FAKE_PAGES_NO_STORE=1 sends Cache-Control no-store instead, so only a service worker can keep the
// files for offline (the proof that offline is the service worker, not the browser's HTTP cache).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [dir, portArg, login = 'you'] = process.argv.slice(2);
if (!dir || !portArg) {
  console.error('usage: node server/scripts/fake-pages.mjs <dir> <port> [login]');
  process.exit(2);
}

const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json', png: 'image/png',
  svg: 'image/svg+xml', ico: 'image/x-icon', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8',
};

function git(gitDir, args, encoding = 'buffer') {
  return new Promise((resolve) => {
    execFile('git', [`--git-dir=${gitDir}`, ...args], { encoding, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : stdout));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
  const repo = parts.shift();
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Cache-Control': process.env.FAKE_PAGES_NO_STORE === '1' ? 'no-store' : 'max-age=600', 'Access-Control-Allow-Origin': '*', ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (!repo || !/^anyapp-[a-z0-9-]+-web$/.test(repo) || parts.some((p) => p === '..')) return send(404, 'Not found');
  const gitDir = path.join(dir, login, `${repo}.git`);
  if (!existsSync(gitDir)) return send(404, 'Not found');
  let file = parts.join('/');
  const kind = file ? (await git(gitDir, ['cat-file', '-t', `main:${file}`], 'utf8'))?.trim() : 'tree';
  if (kind === 'tree') {
    if (!url.pathname.endsWith('/')) return send(301, '', { Location: `${url.pathname}/` });
    file = file ? `${file}/index.html` : 'index.html';
  }
  const body = await git(gitDir, ['cat-file', 'blob', `main:${file}`]);
  if (body === null) return send(404, 'Not found');
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  send(200, body, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Content-Length': body.length });
});

server.listen(Number(portArg), '127.0.0.1', () => console.log(`fake GitHub Pages: http://localhost:${portArg}/anyapp-<slug>-web/ from ${dir}/${login}`));
