// What Automate remembers: which automations are on (and which exact version of each the
// person approved), the safety locks switch, the pretend clock and the run log. One copy in
// memory, saved to storage; the screens and the background runs share it (same JavaScript runtime).
import { useSyncExternalStore } from 'react';

import { load, save } from '@/lib/storage';

/** One line of the card, as drawn from the script's code by the fence. */
export type CardAction = { call: string; args: unknown[]; line: number };

export type AutoState = {
  on: boolean;
  /** The source hash the person approved. A different hash means the script changed. */
  approvedHash?: string;
  /** What the approved version could do (to show what a change adds). */
  approvedLines?: string[];
  approvedAt?: number;
  /** Run times in the last hour (hard limit). */
  recentRuns?: number[];
  lastRun?: number;
  lastResult?: 'ok' | 'error' | 'skipped';
  /** Hash a "changed" notice was already given for. */
  noticedHash?: string;
};

export type Pretend = { offset: number; automation: string; due: number };

export type State = {
  autos: Record<string, AutoState>;
  locksOff: boolean;
  pretend?: Pretend;
  recentSends?: number[];
  recentAllRuns?: number[];
};

export type LogKind = 'ran' | 'error' | 'skipped' | 'blocked' | 'stop' | 'resume' | 'changed' | 'on' | 'off' | 'locks' | 'asked' | 'pretend';

export type LogEntry = {
  id: string;
  at: number;
  kind: LogKind;
  title: string;
  automation?: string;
  lines?: string[];
  test?: boolean;
};

const STATE_KEY = 'automate.state';
const LOG_KEY = 'automate.log';
const MAX_LOG = 300;

let state: State = { autos: {}, locksOff: false };
let log: LogEntry[] = [];
let loaded: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();
let writing: Promise<void> = Promise.resolve();

function changed() {
  version += 1;
  listeners.forEach((l) => l());
}

export function ready(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      state = await load<State>(STATE_KEY, { autos: {}, locksOff: false });
      log = await load<LogEntry[]>(LOG_KEY, []);
      changed();
    })();
  }
  return loaded;
}

export function getState(): State {
  return state;
}

export function getLog(): LogEntry[] {
  return log;
}

/** Changes the state and saves it (in order). */
export async function update(fn: (s: State) => State | void): Promise<State> {
  await ready();
  const next = fn(state) ?? state;
  state = { ...next, autos: { ...next.autos } };
  changed();
  const snapshot = state;
  writing = writing.then(() => save(STATE_KEY, snapshot)).catch(() => {});
  await writing;
  return state;
}

export async function updateAuto(id: string, fn: (a: AutoState) => AutoState): Promise<void> {
  await update((s) => ({ ...s, autos: { ...s.autos, [id]: fn(s.autos[id] ?? { on: false }) } }));
}

export async function addLog(entry: Omit<LogEntry, 'id' | 'at'> & { at?: number }): Promise<LogEntry> {
  await ready();
  const full: LogEntry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...entry };
  log = [full, ...log].slice(0, MAX_LOG);
  changed();
  const snapshot = log;
  writing = writing.then(() => save(LOG_KEY, snapshot)).catch(() => {});
  await writing;
  return full;
}

export async function clearLog(): Promise<void> {
  log = [];
  changed();
  await save(LOG_KEY, log);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-renders when the state or the log changes. */
export function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
