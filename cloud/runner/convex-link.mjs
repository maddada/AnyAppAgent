// The runner's line to Convex (docs/CLOUD.md section 3, "The runner"): its routes, signed with
// the runner token, and an event sink that batches ServerEvents every 250 ms while text streams.
// Plain Node, no dependencies; the token is held in memory only and never logged.

export class ConvexLink {
  /** @param {string} site https://<name>.convex.site  @param {string} token the runner token */
  constructor(site, token, log = console.log) {
    if (!/^https:\/\/[a-z0-9-]+\.convex\.site$/.test(site)) throw new Error('bad Convex site URL');
    this.site = site;
    this.token = token;
    this.log = log;
    this.queue = [];
    this.timer = null;
    this.flushing = Promise.resolve();
  }

  async post(route, body = {}, { retries = 6 } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${this.site}${route}`, {
          // A box that paused mid-request leaves the connection dead: never wait forever.
          signal: AbortSignal.timeout(route === '/runner/take' ? 40_000 : 60_000),
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 401) throw Object.assign(new Error(`${route}: 401 (the runner token is no longer valid)`), { fatal: true });
        if (!res.ok) throw new Error(`${route}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        return await res.json();
      } catch (e) {
        if (e.fatal || attempt >= retries) throw e;
        await new Promise((r) => setTimeout(r, Math.min(15000, 500 * 2 ** attempt)));
      }
    }
  }

  hello() {
    return this.post('/runner/hello');
  }
  /**
   * Long poll: the next inbox row or null after about 25 s. Acknowledged at once; a row offered
   * again (its first answer was lost) is skipped by id.
   */
  async take() {
    this.seen ??= new Set();
    const r = await this.post('/runner/take', {}, { retries: 20 });
    const item = r.item ?? null;
    if (!item) return null;
    await this.post('/runner/ack', { ids: [item.id] });
    if (this.seen.has(item.id)) return null;
    this.seen.add(item.id);
    return item;
  }

  /** Queues a ServerEvent (or a runner event); sent within 250 ms, in order. */
  emit(event) {
    // A streaming item replaces its own earlier copy in the queue: only the newest text goes.
    const id = event.item?.id;
    if (id && (event.type === 'chat.item' || event.type === 'worker.item')) {
      const i = this.queue.findIndex((e) => e.type === event.type && e.item?.id === id);
      if (i >= 0) {
        this.queue[i] = event;
        return;
      }
    }
    this.queue.push(event);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const batch = this.queue.splice(0);
    if (!batch.length) return this.flushing;
    this.flushing = this.flushing.then(() => this.post('/runner/events', { events: batch }).catch((e) => this.log('events lost:', e.message)));
    return this.flushing;
  }

  async uploadFile(bytes, contentType) {
    const { url } = await this.post('/runner/upload-url');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes });
    if (!res.ok) throw new Error(`upload: ${res.status}`);
    return (await res.json()).storageId;
  }

  recordBuild(b) {
    return this.post('/runner/build', b);
  }
}

/** Reads the secrets JSON from stdin (never argv, env or a file). */
export async function readStdinJson() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw || '{}');
}

export function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next && !next.startsWith('--') ? next : true;
  }
  return out;
}
