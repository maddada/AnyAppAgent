// The one small interface between Kiwimake Cloud and whoever rents us machines (docs/CLOUD.md
// section 3, "One box per thread, behind a small interface"). Convex's actions and the scripts use
// only this; Instabox is the first implementation (instabox.ts). Fly.io Machines or another
// provider can replace it without touching the runner or the phone.

export type BoxState = 'creating' | 'starting' | 'running' | 'stopping' | 'stopped' | 'pausing' | 'paused' | 'resuming' | 'deleting' | 'deleted' | 'error';

export interface BoxInfo {
  id: string; // the provider's id
  name: string;
  state: BoxState;
  /** The provider's last error, short. */
  error?: string;
}

export interface CreateBoxOptions {
  /** Unique, lowercase letters, digits and '-'. */
  name: string;
  /** Start from this snapshot (an id or a name the provider resolves). */
  snapshot: string;
  /** Labels kept with the box (thread id, user id). */
  metadata?: Record<string, string>;
  /** Proxy Secrets the box may use (names); their real values never enter the box. */
  secrets?: string[];
  /** Plain env for every login shell (never secrets). */
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  /** Run with no shell: a program and its arguments. */
  argv: string[];
  /** Fed to stdin, then EOF (the only way a secret may reach a command). */
  stdin?: string;
  cwd?: string;
  timeoutSeconds?: number;
  /** Leave it out of the provider's command history (a command that carries stdin secrets). */
  noHistory?: boolean;
}

export interface BoxUsage {
  runningSeconds: number;
  vcpuSeconds: number;
  memGiBSeconds: number;
  diskGiBSeconds: number;
}

export interface SnapshotInfo {
  id: string;
  name: string;
  status: 'pending' | 'ready' | 'failed';
}

export interface BoxProvider {
  readonly name: string;
  create(o: CreateBoxOptions): Promise<BoxInfo>;
  get(id: string): Promise<BoxInfo | null>;
  /** Waits until the box is in one of `states` (or fails), up to `timeoutMs`. */
  waitFor(id: string, states: BoxState[], timeoutMs: number): Promise<BoxInfo>;
  start(id: string): Promise<void>;
  /** Stops a box (files kept, memory not): the state a snapshot is taken in. */
  stop(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  snapshot(id: string, name: string): Promise<SnapshotInfo>;
  getSnapshot(id: string): Promise<SnapshotInfo | null>;
  deleteSnapshot(id: string): Promise<void>;
  /** Puts the box's disks back to a snapshot, in place. */
  restore(id: string, snapshotId: string): Promise<void>;
  delete(id: string): Promise<void>;
  exec(id: string, o: ExecOptions): Promise<ExecResult>;
  /** Writes a file on the box (bytes), with its mode. */
  upload(id: string, path: string, data: Uint8Array, mode?: string): Promise<void>;
  download(id: string, path: string): Promise<Uint8Array>;
  usage(id: string, fromIso?: string): Promise<BoxUsage>;
  /**
   * Saves an org Secret (proxy delivery, scoped to hosts). Needs a provider key that may manage
   * Secrets (Instabox: a workspace's `workspace:admin` key; a personal org's key cannot).
   */
  setSecret(name: string, value: string, hosts: string[]): Promise<void>;
  /** Keeps a busy box from pausing itself while a model call is silent. */
  lease(id: string, leaseId: string, ttlSeconds: number): Promise<void>;
  endLease(id: string, leaseId: string): Promise<void>;
}

export class ProviderError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}
