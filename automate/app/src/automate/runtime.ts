// The automation runtime: loads the scripts (automations/), decides which may run (the card
// before on, a changed script needs a new OK, Stop all, the hard limits), wakes the phone for the
// next trigger, runs a script when Android wakes it, and writes every outcome to the run log.
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import * as Native from '../../modules/automate';
import { automations as compiledList } from '../../automations';
import { buildApi, clockNow, RefusedError, StoppedError, type RunContext } from './api';
import { APP_NAME } from './brand';
import { actionLines, diffLines, needsOf, type Need } from './card';
import { LIMITS, UNLOCKED_RUN_MS } from './limits';
import { ajmanClock } from './prayer';
import { addLog, getLog, getState, ready, update, updateAuto, useStoreVersion, type CardAction, type State } from './store';
import { describeTrigger, isEventTrigger, matches, nextOf, ScriptError, triggerLabel, type EventKind, type PhoneEvent, type Trigger } from './triggers';
import { diary } from '@/lib/diary';

/** What the fence turns each automations/<id>.ts into (tools/automate-fence.js). */
type Compiled = {
  id: string;
  hash: string;
  source: string;
  powers: string[];
  actions: CardAction[];
  define: (api: Record<string, unknown>) => unknown;
};

type Definition = { name: string; says: string; triggers: Trigger[]; run: (event: unknown) => unknown };

export type Loaded = {
  id: string;
  hash: string;
  source: string;
  powers: string[];
  actions: CardAction[];
  /** The card's "It will" lines, from the code. */
  lines: string[];
  needs: Need[];
  name: string;
  says: string;
  triggers: Trigger[];
  /** The card's "When" lines. */
  when: string[];
  error?: string;
};

export type Status = 'new' | 'on' | 'off' | 'changed' | 'broken';

const compiled = compiledList as unknown as Compiled[];

function isTrigger(t: unknown): t is Trigger {
  return !!t && typeof t === 'object' && ['at', 'prayer', 'every', 'charging', 'wifi', 'bluetooth'].includes((t as { kind?: string }).kind ?? '');
}

function defineScript(c: Compiled, ctx: RunContext): Definition {
  const raw = c.define(buildApi(ctx)) as { name?: unknown; says?: unknown; when?: unknown; run?: unknown } | undefined;
  if (!raw || typeof raw !== 'object') throw new ScriptError('The script does not describe an automation.');
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : c.id;
  const says = typeof raw.says === 'string' ? raw.says.trim().slice(0, 400) : '';
  const when = Array.isArray(raw.when) ? raw.when : [raw.when];
  const refused = when.find((t) => (t as { kind?: string } | undefined)?.kind === 'invalid') as { problem?: string } | undefined;
  if (refused) throw Object.assign(new ScriptError(refused.problem ?? 'A trigger was refused.'), { scriptName: name });
  if (!when.length || !when.every(isTrigger)) throw Object.assign(new ScriptError('"when" needs at(), prayer() or every().'), { scriptName: name });
  if (typeof raw.run !== 'function') throw new ScriptError('"run" must be a function.');
  return { name, says, triggers: when as Trigger[], run: raw.run as Definition['run'] };
}

function loadingContext(id: string, locksOff: boolean): RunContext {
  return { automation: id, name: id, started: Date.now(), deadline: Date.now() + 5_000, actions: 0, lines: [], locksOff, offset: 0, loading: true };
}

/** Every script, read without running it (for the list and the cards). */
export function loadAll(locksOff = getState().locksOff): Loaded[] {
  return compiled.map((c) => {
    const base = { id: c.id, hash: c.hash, source: c.source, powers: c.powers, actions: c.actions, lines: actionLines(c.actions), needs: needsOf(c.actions) };
    try {
      const d = defineScript(c, loadingContext(c.id, locksOff));
      return { ...base, needs: needsOf(c.actions, d.triggers), name: d.name, says: d.says, triggers: d.triggers, when: d.triggers.map(describeTrigger) };
    } catch (e) {
      const name = (e as { scriptName?: string }).scriptName ?? c.id;
      return { ...base, name, says: '', triggers: [], when: [], error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function statusOf(l: Loaded, s: State = getState()): Status {
  if (l.error) return 'broken';
  const a = s.autos[l.id];
  if (!a || (!a.on && !a.approvedHash)) return 'new';
  if (!a.on) return 'off';
  return a.approvedHash === l.hash ? 'on' : 'changed';
}

/** What a changed script adds and drops, compared with what the person approved. */
export function changesOf(l: Loaded) {
  return diffLines(getState().autos[l.id]?.approvedLines, l.lines);
}

async function tell(title: string, body: string) {
  try {
    if (Native.canNotify()) await Native.notifyNow(title, body, 'automate-notice');
  } catch {
    // a notice is a courtesy; the log has it
  }
}

/**
 * Brings everything in line with the scripts in this version of the app: a new or changed
 * script is noted (and does not run until its card is approved), then the next wake-ups are set.
 * Runs when the app starts (also after a quick update) and before every background run.
 */
export async function sync(): Promise<void> {
  await ready();
  const s = getState();
  for (const l of loadAll(s.locksOff)) {
    const a = s.autos[l.id];
    const status = statusOf(l, s);
    if ((status === 'new' || status === 'changed') && a?.noticedHash !== l.hash) {
      if (s.locksOff && !l.error) {
        await approve(l.id, true);
        continue;
      }
      const isNew = status === 'new';
      await addLog({
        kind: 'changed',
        automation: l.id,
        title: isNew ? `New automation: ${l.name}` : `${l.name} changed`,
        lines: isNew ? ['Check its card to turn it on'] : ['It does not run until you check the new version', ...diffSummary(l)],
      });
      await updateAuto(l.id, (x) => ({ ...x, noticedHash: l.hash }));
      await tell(isNew ? `New automation: ${l.name}` : `${l.name} changed`, isNew ? `Check its card in ${APP_NAME} to turn it on.` : 'Check it to keep it running.');
    }
  }
  await plan();
}

function diffSummary(l: Loaded): string[] {
  const { added, removed } = changesOf(l);
  return [...added.map((x) => `New: ${x}`), ...removed.map((x) => `Gone: ${x}`)];
}

/** Sets one wake-up per automation that is on: its next trigger. */
export async function plan(): Promise<void> {
  await ready();
  if (Native.isStopped()) {
    await Native.disarmAll();
    await Native.listen([]);
    return;
  }
  const s = getState();
  const wanted = new Set<string>();
  const listen = new Set<EventKind>();
  for (const l of loadAll(s.locksOff)) {
    if (statusOf(l, s) !== 'on') continue;
    for (const t of l.triggers) if (isEventTrigger(t)) listen.add(t.kind);
    const pretend = s.pretend?.automation === l.id ? s.pretend : undefined;
    if (pretend) {
      // Already fired (the run is under way): never arm it again, or it would run twice.
      if (pretend.due - pretend.offset > Date.now()) {
        await Native.arm(l.id, pretend.due - pretend.offset, { automation: l.id, name: l.name, due: pretend.due, trigger: 'pretend clock', test: true });
        wanted.add(l.id);
      }
      continue;
    }
    const next = nextOf(l.triggers, Date.now());
    if (!next) continue;
    await Native.arm(l.id, next.due, { automation: l.id, name: l.name, due: next.due, trigger: triggerLabel(next.trigger) });
    wanted.add(l.id);
  }
  for (const a of await Native.armed()) if (!wanted.has(a.id)) await Native.disarm(a.id);
  // The listener (charger, Wi-Fi, Bluetooth) runs only while an automation that is on needs it.
  await Native.listen([...listen].sort());
}

type Payload = { automation?: string; due?: number; trigger?: string; test?: boolean; plan?: boolean; event?: PhoneEvent };

/** Android woke the app (modules/automate TriggerReceiver -> headless task): run what is due. */
export async function runFromNative(data: { payload?: string } | undefined): Promise<void> {
  let p: Payload = {};
  try {
    p = JSON.parse(data?.payload ?? '{}') as Payload;
  } catch {
    p = {};
  }
  await ready();
  if (p.event) {
    await runEvent(p.event);
    return;
  }
  if (p.plan || !p.automation) {
    await sync();
    return;
  }
  await runOne(p.automation, { trigger: p.trigger ?? 'trigger', due: p.due ?? Date.now(), test: !!p.test, manual: false });
}

/** The phone reported an event (charger, Wi-Fi, Bluetooth): run every automation it starts. */
export async function runEvent(e: PhoneEvent): Promise<void> {
  await ready();
  const s = getState();
  for (const l of loadAll(s.locksOff)) {
    if (statusOf(l, s) !== 'on') continue;
    const hit = l.triggers.find((t) => matches(t, e));
    if (hit) await runOne(l.id, { trigger: triggerLabel(hit), due: Date.now(), test: false, manual: false });
  }
}

/** Try it now: runs the automation at once, through every safety rail. */
export async function tryNow(id: string): Promise<void> {
  await runOne(id, { trigger: 'test', due: Date.now(), test: true, manual: true });
}

async function runOne(id: string, how: { trigger: string; due: number; test: boolean; manual: boolean }): Promise<void> {
  await ready();
  const s = getState();
  const c = compiled.find((x) => x.id === id);
  const l = loadAll(s.locksOff).find((x) => x.id === id);
  if (!c || !l) {
    await Native.disarm(id);
    return;
  }
  if (Native.isStopped()) {
    await addLog({ kind: 'skipped', automation: id, title: `${l.name} did not run`, lines: ['Stop all is on'] });
    return;
  }
  const status = statusOf(l, s);
  if (!how.manual && status !== 'on') {
    await addLog({ kind: 'skipped', automation: id, title: `${l.name} did not run`, lines: [status === 'changed' ? 'It changed: check the new version first' : 'It is off'] });
    await sync(); // posts the "changed" notice if it was not given yet, and plans
    return;
  }
  if (status === 'broken') {
    await addLog({ kind: 'error', automation: id, title: `${l.name} has a problem`, lines: [l.error ?? ''] });
    return;
  }
  const hourAgo = Date.now() - 3600_000;
  const recent = (s.autos[id]?.recentRuns ?? []).filter((t) => t > hourAgo);
  const all = (s.recentAllRuns ?? []).filter((t) => t > hourAgo);
  if (!s.locksOff && (recent.length >= LIMITS.runsPerHour || all.length >= LIMITS.allRunsPerHour)) {
    await addLog({
      kind: 'blocked',
      automation: id,
      title: `${l.name} did not run`,
      lines: [recent.length >= LIMITS.runsPerHour ? `It already ran ${LIMITS.runsPerHour} times this hour (safety lock)` : `Automations already ran ${LIMITS.allRunsPerHour} times this hour (safety lock)`],
    });
    await plan();
    return;
  }

  const pretend = s.pretend?.automation === id ? s.pretend : undefined;
  const started = Date.now();
  const ctx: RunContext = {
    automation: id,
    name: l.name,
    started,
    deadline: started + (s.locksOff ? UNLOCKED_RUN_MS : LIMITS.runMs),
    actions: 0,
    lines: [],
    locksOff: s.locksOff,
    offset: pretend && !how.manual ? pretend.offset : 0,
  };
  const event = Object.freeze({ trigger: how.trigger === 'pretend clock' ? (l.triggers[0] ? triggerLabel(l.triggers[0]) : 'test') : how.trigger, at: new Date(how.due), test: how.test });
  let kind: 'ran' | 'error' | 'stop' | 'refused' = 'ran';
  let problem = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const d = defineScript(c, ctx);
    // Checked every half second against ctx.deadline, which moves on while the run waits for the person.
    const timeout = new Promise<never>((_, reject) => {
      timer = setInterval(() => {
        if (Date.now() > ctx.deadline) reject(new ScriptError('The run took too long and was stopped (safety lock).'));
      }, 500);
    });
    await Promise.race([Promise.resolve(d.run(event)), timeout]);
  } catch (e) {
    if (e instanceof StoppedError) kind = 'stop';
    else if (e instanceof RefusedError) kind = 'refused';
    else kind = 'error';
    problem = e instanceof Error ? e.message : String(e);
  } finally {
    if (timer) clearInterval(timer);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const when = pretend && !how.manual ? `on the pretend clock (${ajmanClock(how.due)} in Ajman)` : how.manual ? 'Try it now' : `at ${how.trigger}`;
  await update((x) => ({
    ...x,
    recentAllRuns: [...all, started],
    autos: { ...x.autos, [id]: { ...(x.autos[id] ?? { on: false }), recentRuns: [...recent, started], lastRun: started, lastResult: kind === 'ran' ? 'ok' : kind === 'refused' ? 'skipped' : 'error' } },
    pretend: pretend && !how.manual ? undefined : x.pretend,
  }));
  await addLog({
    kind: kind === 'stop' ? 'stop' : kind === 'refused' ? 'blocked' : kind,
    automation: id,
    test: how.test,
    title:
      kind === 'ran'
        ? `${l.name} ran, ${when}`
        : kind === 'stop'
          ? `${l.name} stopped: Stop all`
          : kind === 'refused'
            ? `${l.name} did not send anything, ${when}`
            : `${l.name} failed, ${when}`,
    lines: [...ctx.lines, ...(problem ? [problem] : []), `Took ${secs} s`],
  });
  diary(
    kind === 'ran'
      ? `${l.name} ran (${ctx.lines.length} steps)`
      : kind === 'refused'
        ? `${l.name} did not send: ${problem.slice(0, 80)}`
        : `${l.name} ${kind === 'stop' ? 'stopped by Stop all' : `failed: ${problem.slice(0, 120)}`}`,
  );
  await plan();
}

/** The person approved the card: this exact version may run. */
export async function approve(id: string, byLocksOff = false): Promise<void> {
  const l = loadAll().find((x) => x.id === id);
  if (!l || l.error) return;
  await updateAuto(id, (a) => ({ ...a, on: true, approvedHash: l.hash, approvedLines: l.lines, approvedAt: Date.now(), noticedHash: l.hash }));
  const next = nextOf(l.triggers, Date.now());
  await addLog({
    kind: 'on',
    automation: id,
    title: `${l.name} turned on`,
    lines: [
      ...(byLocksOff ? ['Without a card: the safety locks are off'] : []),
      ...l.lines,
      ...(next ? [`Next: ${new Date(next.due).toDateString() === new Date().toDateString() ? 'today' : new Date(next.due).toDateString()} ${ajmanClock(next.due)}`] : []),
    ],
  });
  diary(`${l.name} turned on`);
  await plan();
}

export async function turnOff(id: string): Promise<void> {
  const l = loadAll().find((x) => x.id === id);
  await updateAuto(id, (a) => ({ ...a, on: false }));
  await update((s) => (s.pretend?.automation === id ? { ...s, pretend: undefined } : s));
  await addLog({ kind: 'off', automation: id, title: `${l?.name ?? id} turned off` });
  await plan();
}

/** Stop all: nothing runs until Resume. Do Not Disturb this app turned on goes off. */
export async function stopEverything(): Promise<void> {
  await Native.stopAll();
  await update((s) => ({ ...s, pretend: undefined }));
  await addLog({ kind: 'stop', title: 'Stop all', lines: ['Nothing runs until you resume', 'Do Not Disturb that this app turned on is off'] });
  diary('Stop all');
}

export async function resumeEverything(): Promise<void> {
  await Native.resume();
  await addLog({ kind: 'resume', title: 'Resumed', lines: ['Automations that are on run again'] });
  await plan();
}

export async function setLocksOff(off: boolean): Promise<void> {
  await update((s) => ({ ...s, locksOff: off }));
  await addLog({
    kind: 'locks',
    title: off ? 'Safety locks turned off' : 'Safety locks back on',
    lines: off ? ['No hard limits, no asking before sending, automations turn on without a card', 'The run log and Stop all still work'] : ['Hard limits, asking before sending and the card before on are back'],
  });
  await sync();
}

/** Pretend clock: makes the automation's next trigger happen in 30 seconds, through the real wake-up. */
export async function pretendBefore(id: string): Promise<number | null> {
  const l = loadAll().find((x) => x.id === id);
  if (!l || statusOf(l) !== 'on') return null;
  const next = nextOf(l.triggers, Date.now());
  if (!next) return null;
  const offset = next.due - 30_000 - Date.now();
  await update((s) => ({ ...s, pretend: { offset, automation: id, due: next.due } }));
  await addLog({ kind: 'pretend', automation: id, title: `Pretend clock for ${l.name}`, lines: [`It is now ${ajmanClock(next.due - 30_000)} in Ajman for this automation`, `${triggerLabel(next.trigger)} comes in 30 seconds`] });
  await plan();
  return next.due;
}

export async function cancelPretend(): Promise<void> {
  await update((s) => ({ ...s, pretend: undefined }));
  await plan();
}

/** For the screens: the automations with their status, the log and Stop all, kept fresh. */
export function useAutomate() {
  const version = useStoreVersion();
  const [focus, setFocus] = useState(0);
  const s = getState();
  const list = useMemo(() => loadAll(s.locksOff), [s.locksOff]);
  // Stop all can also come from a notification: read it again whenever the app comes back.
  const stopped = useMemo(() => Native.isStopped(), [version, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void ready();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setFocus((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  return { list, state: s, log: getLog(), stopped, version, clock: clockNow };
}
