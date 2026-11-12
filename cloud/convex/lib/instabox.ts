// Instabox (instabox.sh) behind the BoxProvider interface: its REST API with an API key
// (`machines:read|write|delete`, `images:*`). Runs in Convex's default runtime (fetch only) and
// in Node scripts. The key is passed in by the caller and never logged.
import { ProviderError, type BoxInfo, type BoxProvider, type BoxState, type BoxUsage, type CreateBoxOptions, type ExecOptions, type ExecResult, type SnapshotInfo } from './provider';

const API = 'https://api.instabox.sh';

/** Instabox's own machine states, in the interface's words. */
const STATES: Record<string, BoxState> = {
  creating: 'creating',
  starting: 'starting',
  running: 'running',
  stopping: 'stopping',
  stopped: 'stopped',
  suspending: 'pausing',
  suspended: 'paused',
  resuming: 'resuming',
  deleting: 'deleting',
  deleted: 'deleted',
  error: 'error',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Instabox implements BoxProvider {
  readonly name = 'instabox';
  constructor(
    private readonly key: string,
    private readonly orgId?: string,
  ) {
    if (!key) throw new Error('Instabox: no API key');
  }

  private async call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const idem = `kiwi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          // Lifecycle calls need one; the same key on a retry of this call makes it safe to repeat.
          ...(method !== 'GET' ? { 'Idempotency-Key': idem } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      // 429 (exec quota) and 503 (host busy) are retryable: a few short tries.
      if ((res.status === 429 || res.status === 503) && attempt < 4) {
        await sleep(Number(res.headers.get('Retry-After') ?? 0) * 1000 || 1500 * (attempt + 1));
        continue;
      }
      // A box that says "running" can still be finishing its create (or resume) operation for a
      // while: anything else on it is refused with 409 operation_conflict until then.
      const conflict = String(json?.error?.message ?? json?.message ?? '');
      if (res.status === 409 && (json?.error?.code ?? json?.code) === 'operation_conflict' && /active .*operation|in progress/i.test(conflict) && attempt < 40) {
        await sleep(3000);
        continue;
      }
      if (!res.ok) {
        const code = json?.error?.code ?? json?.code;
        const msg = json?.error?.message ?? json?.message ?? text.slice(0, 200);
        throw new ProviderError(`Instabox ${method} ${path.split('?')[0]}: ${res.status} ${code ?? ''} ${msg}`.trim(), res.status, code);
      }
      return json as T;
    }
  }

  private info(m: any): BoxInfo {
    let state = STATES[m.state] ?? 'error';
    // "running" with an operation still going (create, resume) is not ready for commands yet.
    if (state === 'running' && m.operationId) state = 'starting';
    return { id: m.id, name: m.name, state, ...(m.lastError ? { error: String(m.lastError).slice(0, 300) } : {}) };
  }

  /** Resolves a snapshot name to its id (ids pass through). */
  private async snapshotId(nameOrId: string): Promise<string> {
    if (/^(sn|im)_/.test(nameOrId)) return nameOrId;
    const list = await this.call<{ snapshots: any[] }>('GET', '/v1/snapshots');
    const s = list.snapshots.find((x) => x.name === nameOrId);
    if (!s) throw new ProviderError(`Instabox: no snapshot named ${nameOrId}`, 404, 'not_found');
    return s.id;
  }

  async create(o: CreateBoxOptions): Promise<BoxInfo> {
    const op = await this.call('POST', '/v1/machines', {
      name: o.name,
      snapshotId: await this.snapshotId(o.snapshot),
      ...(o.metadata ? { metadata: o.metadata } : {}),
      ...(o.env ? { env: o.env } : {}),
      secrets: o.secrets ?? [],
      ...(this.orgId ? { orgId: this.orgId } : {}),
    }, { 'Idempotency-Key': `create-${o.name}` });
    const id = op.machineId ?? op.machine?.id;
    if (!id) throw new ProviderError('Instabox: create returned no machine id', 500);
    return { id, name: o.name, state: 'creating' };
  }

  async get(id: string): Promise<BoxInfo | null> {
    try {
      return this.info(await this.call('GET', `/v1/machines/${id}`));
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return null;
      throw e;
    }
  }

  async waitFor(id: string, states: BoxState[], timeoutMs: number): Promise<BoxInfo> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const b = await this.get(id);
      if (!b) {
        if (states.includes('deleted')) return { id, name: '', state: 'deleted' };
        throw new ProviderError(`Instabox: box ${id} is gone`, 404, 'not_found');
      }
      if (states.includes(b.state)) return b;
      if (b.state === 'error') throw new ProviderError(`Instabox: box ${id} failed: ${b.error ?? 'error'}`, 500, 'machine_error');
      if (Date.now() > until) throw new ProviderError(`Instabox: box ${id} still ${b.state} after ${Math.round(timeoutMs / 1000)} s`, 504, 'timeout');
      await sleep(2000);
    }
  }

  async start(id: string) {
    await this.call('POST', `/v1/machines/${id}/start`, {});
  }
  async stop(id: string) {
    await this.call('POST', `/v1/machines/${id}/stop`, {});
  }
  async pause(id: string) {
    await this.call('POST', `/v1/machines/${id}/suspend`, {});
  }
  async resume(id: string) {
    await this.call('POST', `/v1/machines/${id}/resume`, {});
  }

  async snapshot(id: string, name: string): Promise<SnapshotInfo> {
    const s = await this.call('POST', `/v1/machines/${id}/snapshots`, { name, description: 'Kiwimake Cloud: a paused thread box' }, { 'Idempotency-Key': `snap-${name}` });
    return { id: s.id, name: s.name, status: s.status };
  }
  async getSnapshot(id: string): Promise<SnapshotInfo | null> {
    try {
      const s = await this.call('GET', `/v1/snapshots/${id}`);
      return { id: s.id, name: s.name, status: s.status };
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return null;
      throw e;
    }
  }
  async deleteSnapshot(id: string) {
    try {
      await this.call('DELETE', `/v1/snapshots/${id}`);
    } catch (e) {
      if (!(e instanceof ProviderError && e.status === 404)) throw e;
    }
  }
  async restore(id: string, snapshotId: string) {
    await this.call('POST', `/v1/machines/${id}/restore`, { snapshotId: await this.snapshotId(snapshotId), desiredState: 'running' });
  }

  async delete(id: string) {
    try {
      await this.call('DELETE', `/v1/machines/${id}`, undefined, { 'X-Confirm-Delete': id });
    } catch (e) {
      if (!(e instanceof ProviderError && e.status === 404)) throw e;
    }
  }

  async exec(id: string, o: ExecOptions): Promise<ExecResult> {
    const r = await this.call('POST', `/v1/machines/${id}/exec`, {
      argv: o.argv,
      ...(o.stdin !== undefined ? { stdin: o.stdin } : {}),
      ...(o.cwd ? { cwd: o.cwd } : {}),
      timeoutSeconds: o.timeoutSeconds ?? 60,
      ...(o.noHistory ? { noHistory: true } : {}),
    });
    return { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut: Boolean(r.timedOut) };
  }

  async upload(id: string, path: string, data: Uint8Array, mode?: string) {
    const q = new URLSearchParams({ path, parents: 'true', ...(mode ? { mode } : {}) });
    const res = await fetch(`${API}/v1/machines/${id}/files?${q}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/octet-stream' },
      body: data as Uint8Array<ArrayBuffer>,
    });
    if (!res.ok) throw new ProviderError(`Instabox upload ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  }

  async download(id: string, path: string): Promise<Uint8Array> {
    const res = await fetch(`${API}/v1/machines/${id}/files/content?${new URLSearchParams({ path })}`, { headers: { Authorization: `Bearer ${this.key}` } });
    if (!res.ok) throw new ProviderError(`Instabox download ${path}: ${res.status}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async usage(id: string, fromIso?: string): Promise<BoxUsage> {
    const u = await this.call('GET', `/v1/machines/${id}/usage${fromIso ? `?from=${encodeURIComponent(fromIso)}` : ''}`);
    return { runningSeconds: u.runningSeconds ?? 0, vcpuSeconds: u.vcpuSeconds ?? 0, memGiBSeconds: u.memGiBSeconds ?? 0, diskGiBSeconds: u.diskGiBSeconds ?? 0 };
  }

  async setSecret(name: string, value: string, hosts: string[]) {
    if (!this.orgId) throw new ProviderError('Instabox: setSecret needs the workspace org id', 400);
    if (!hosts.length) throw new ProviderError('Instabox: a Secret must be scoped to hosts', 400);
    await this.call('PUT', `/v1/orgs/${this.orgId}/secrets/${name}`, { value, delivery: 'proxy', hosts });
  }

  async lease(id: string, leaseId: string, ttlSeconds: number) {
    await this.call('PUT', `/v1/machines/${id}/activity-leases/${leaseId}`, { ttlSeconds });
  }
  async endLease(id: string, leaseId: string) {
    try {
      await this.call('DELETE', `/v1/machines/${id}/activity-leases/${leaseId}`);
    } catch (e) {
      if (!(e instanceof ProviderError && e.status === 404)) throw e;
    }
  }
}

/** The provider Convex uses, from its env vars (INSTABOX_API_KEY, optional INSTABOX_ORG_ID). */
export function boxProvider(): BoxProvider {
  return new Instabox(process.env.INSTABOX_API_KEY ?? '', process.env.INSTABOX_ORG_ID || undefined);
}
