// The names a script gets (the same list as tools/automate-fence.js API and HELPERS). Every
// power goes through gate(): Stop all, the run's time and action budget, permissions, the hard
// limits and the ask-before-sending question all live here, not in the scripts.
import * as Native from '../../modules/automate';
import { LIMITS, isPrivateHost } from './limits';
import { prayerTimesFor, ajmanDay, PRAYER_KEYS, ajmanClock } from './prayer';
import { getState, update } from './store';
import { makeAt, makeBluetooth, makeCharging, makeEvery, makePrayer, makeWifi, ScriptError } from './triggers';
import { APP_NAME } from './brand';
import { load, save } from '@/lib/storage';

const BLOCKED = new Set(['constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'caller', 'callee', 'arguments']);

/** How long a run waits for speech to finish before it goes on. */
const SPEAK_WAIT_MS = 15_000;

/** The person said no (or did not answer) to sending: nothing was sent. */
export class RefusedError extends Error {
  constructor(public readonly reason: 'no' | 'no answer') {
    super(reason === 'no' ? 'You said no: nothing was sent.' : 'No answer in time: nothing was sent.');
  }
}

export class StoppedError extends Error {
  constructor() {
    super('Stop all is on');
  }
}

export type RunContext = {
  automation: string;
  name: string;
  /** Real time the run started. */
  started: number;
  deadline: number;
  actions: number;
  lines: string[];
  locksOff: boolean;
  /** Pretend clock offset (ms) while testing. */
  offset: number;
  /** For definitions loaded outside a run (the list, the card): powers refuse. */
  loading?: boolean;
};

function key(k: unknown): string | number {
  if (typeof k === 'number') return k;
  if (typeof k === 'symbol') throw new ScriptError('Symbols are not allowed in an automation.');
  const s = String(k);
  if (BLOCKED.has(s)) throw new ScriptError(`"${s}" is not allowed in an automation.`);
  return s;
}

function fenceHelpers(ctx: RunContext) {
  let ticks = 0;
  const tick = () => {
    ticks += 1;
    if ((ticks & 1023) === 0 || ticks < 2) {
      if (Date.now() > ctx.deadline) throw new ScriptError('The run took too long and was stopped (safety lock).');
      if (!ctx.loading && Native.isStopped()) throw new StoppedError();
    }
  };
  return {
    $get: (o: any, k: unknown) => o[key(k)],
    $set: (o: any, k: unknown, v: unknown) => (o[key(k)] = v),
    $call: (o: any, k: unknown, args: unknown[]) => o[key(k)](...args),
    $del: (o: any, k: unknown) => delete o[key(k)],
    $upd: (o: any, k: unknown, fn: (old: any) => unknown) => {
      const kk = key(k);
      return (o[kk] = fn(o[kk]));
    },
    $tick: tick,
  };
}

/** The clock scripts see: real time plus the pretend clock's offset. */
export function clockNow(ctx?: { offset: number }): number {
  return Date.now() + (ctx ? ctx.offset : (getState().pretend?.offset ?? 0));
}

export function buildApi(ctx: RunContext): Record<string, unknown> {
  const gate = (what: string) => {
    if (ctx.loading) throw new ScriptError(`${what} only works inside run().`);
    if (Native.isStopped()) throw new StoppedError();
    if (Date.now() > ctx.deadline) throw new ScriptError('The run took too long and was stopped (safety lock).');
    ctx.actions += 1;
    if (!ctx.locksOff && ctx.actions > LIMITS.actionsPerRun) throw new ScriptError(`More than ${LIMITS.actionsPerRun} actions in one run (safety lock).`);
  };
  const line = (s: string) => {
    if (ctx.lines.length < 60) ctx.lines.push(s.slice(0, 200));
  };

  const send = async (method: 'GET' | 'POST', url: unknown, body?: unknown) => {
    gate(method === 'GET' ? 'web.get' : 'web.post');
    if (typeof url !== 'string') throw new ScriptError('web needs an address.');
    const m = /^([a-z]+):\/\/([^/?#:]+|\[[^\]]+\])/i.exec(url);
    if (!m) throw new ScriptError('That is not a web address.');
    const host = m[2];
    if (!ctx.locksOff) {
      if (m[1].toLowerCase() !== 'https') throw new ScriptError('Only https addresses (safety lock).');
      if (isPrivateHost(host)) throw new ScriptError('Not to this phone or its home network (safety lock).');
      const hourAgo = Date.now() - 3600_000;
      const recent = (getState().recentSends ?? []).filter((t) => t > hourAgo);
      if (recent.length >= LIMITS.sendsPerHour) throw new ScriptError(`More than ${LIMITS.sendsPerHour} sends in an hour (safety lock).`);
      const what = method === 'GET' ? `fetch from ${host}` : `send to ${host}`;
      line(`Asked you: ${what}`);
      // The run's clock stops while it waits for the person: a slow answer is not a slow script.
      const asked = Date.now();
      const answer = await Native.ask(`${ctx.name} wants to ${what}`, method === 'POST' ? `It sends: ${String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 160)}` : url, LIMITS.askMs);
      ctx.deadline += Date.now() - asked;
      if (Native.isStopped()) throw new StoppedError();
      if (answer !== 'allow') throw new RefusedError(answer === 'deny' ? 'no' : 'no answer');
      line('You allowed it');
      await update((s) => ({ ...s, recentSends: [...recent, Date.now()] }));
    }
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    if (payload && !ctx.locksOff && payload.length > 100_000) throw new ScriptError('Too much to send (safety lock).');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        method,
        body: payload,
        headers: payload && typeof body !== 'string' ? { 'content-type': 'application/json' } : undefined,
        signal: controller.signal,
      });
      const text = (await res.text()).slice(0, 100_000);
      line(`${method === 'GET' ? 'Fetched from' : 'Sent to'} ${host}: ${res.status}`);
      return Object.freeze({ status: res.status, text });
    } finally {
      clearTimeout(timer);
    }
  };

  const memoryKey = `automate.memory.${ctx.automation}`;

  // A refused trigger (every 1 minute while the locks are on) becomes a marker, so the card still
  // shows the automation's own name with the reason, instead of a bare error.
  const trigger = (make: () => unknown) => {
    try {
      return make();
    } catch (e) {
      if (e instanceof ScriptError) return Object.freeze({ kind: 'invalid', problem: e.message });
      throw e;
    }
  };

  return Object.freeze({
    automation: (definition: unknown) => definition,
    at: (time: unknown, options?: { days?: unknown }) => trigger(() => makeAt(time, options)),
    prayer: (name: unknown, options?: { before?: unknown; after?: unknown }) => trigger(() => makePrayer(name, options)),
    every: (interval?: { minutes?: unknown; hours?: unknown }) => trigger(() => makeEvery(interval, ctx.locksOff)),
    charging: (options?: { plugged?: unknown }) => trigger(() => makeCharging(options)),
    wifi: (options?: { connected?: unknown; network?: unknown }) => trigger(() => makeWifi(options)),
    bluetooth: (options?: { connected?: unknown; device?: unknown }) => trigger(() => makeBluetooth(options)),

    speak: async (text: unknown, options?: { language?: unknown }) => {
      gate('speak');
      const t = String(text ?? '').trim();
      if (!t) throw new ScriptError('speak() needs some text.');
      if (!ctx.locksOff && t.length > LIMITS.maxSpeak) throw new ScriptError(`Spoken text is limited to ${LIMITS.maxSpeak} characters (safety lock).`);
      const language = typeof options?.language === 'string' ? options.language : undefined;
      // Speech is best effort: a voice engine that does not start (it can take long the first
      // time after a restart) must not stop the rest of the automation. One more try, then a note.
      for (let attempt = 1; ; attempt++) {
        try {
          // A voice that never says it finished (a busy phone) must not hold the run: at most 15 s.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const finished = await Promise.race([
            Native.speakNow(t, language).then(() => true),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(false), SPEAK_WAIT_MS);
            }),
          ]).finally(() => clearTimeout(timer));
          line(finished ? `Said "${t.slice(0, 120)}"` : `Started saying "${t.slice(0, 60)}" (still speaking after 15 s, going on)`);
          return;
        } catch (e) {
          if (Native.isStopped()) throw new StoppedError();
          if (attempt >= 2 || ctx.deadline - Date.now() < 20_000) {
            line(`Could not say "${t.slice(0, 60)}": ${e instanceof Error ? e.message : String(e)}`);
            return;
          }
        }
      }
    },

    notify: async (title: unknown, body?: unknown) => {
      gate('notify');
      const t = String(title ?? '').slice(0, 120);
      if (!Native.canNotify()) throw new ScriptError(`Notifications are off for ${APP_NAME}: allow them on its card.`);
      line(`Showed "${t}"`);
      await Native.notifyNow(t, body === undefined ? undefined : String(body).slice(0, 400), ctx.automation);
    },

    doNotDisturb: Object.freeze({
      on: async (options?: { minutes?: unknown }) => {
        gate('doNotDisturb.on');
        if (!Native.dnd.hasAccess()) throw new ScriptError('Do Not Disturb access is not allowed yet: allow it on the card.');
        let minutes = Number(options?.minutes ?? 0);
        if (!isFinite(minutes) || minutes < 0) throw new ScriptError('minutes must be a positive number.');
        if (!ctx.locksOff && (minutes === 0 || minutes > LIMITS.maxDndMinutes)) minutes = Math.min(minutes || LIMITS.maxDndMinutes, LIMITS.maxDndMinutes);
        const until = await Native.dnd.on(Math.round(minutes));
        line(until ? `Do Not Disturb on until ${ajmanClock(until)}` : 'Do Not Disturb on');
      },
      off: async () => {
        gate('doNotDisturb.off');
        if (!Native.dnd.hasAccess()) throw new ScriptError('Do Not Disturb access is not allowed yet: allow it on the card.');
        const done = await Native.dnd.off();
        line(done ? 'Do Not Disturb off' : 'Do Not Disturb left as it was (this app did not turn it on)');
      },
      isOn: async () => {
        gate('doNotDisturb.isOn');
        return Native.dnd.isOn();
      },
    }),

    web: Object.freeze({
      get: (url: unknown) => send('GET', url),
      post: (url: unknown, body: unknown) => send('POST', url, body),
    }),

    sleep: async (options?: { seconds?: unknown }) => {
      gate('sleep');
      let s = Number(options?.seconds ?? 0);
      if (!isFinite(s) || s < 0) s = 0;
      if (!ctx.locksOff) s = Math.min(s, LIMITS.maxSleepSeconds);
      const end = Date.now() + s * 1000;
      while (Date.now() < end) {
        if (Native.isStopped()) throw new StoppedError();
        await new Promise((r) => setTimeout(r, Math.min(500, end - Date.now())));
      }
    },

    log: (text: unknown) => {
      if (ctx.loading) return;
      line(String(text ?? ''));
    },

    now: () => new Date(clockNow(ctx)),

    prayerTimes: (day?: unknown) => {
      const at = day instanceof Date ? day.getTime() : clockNow(ctx);
      const times = prayerTimesFor(ajmanDay(at));
      return Object.freeze(Object.fromEntries(PRAYER_KEYS.map((k) => [k, new Date(times[k])])));
    },

    memory: Object.freeze({
      get: async (k: unknown, fallback: unknown) => {
        const all = await load<Record<string, unknown>>(memoryKey, {});
        const kk = String(key(k));
        return Object.prototype.hasOwnProperty.call(all, kk) ? all[kk] : fallback;
      },
      set: async (k: unknown, value: unknown) => {
        const all = await load<Record<string, unknown>>(memoryKey, {});
        const next = { ...all, [String(key(k))]: value };
        if (!ctx.locksOff && JSON.stringify(next).length > LIMITS.memoryBytes) throw new ScriptError('Memory is full for this automation (safety lock).');
        await save(memoryKey, next);
      },
    }),

    ...fenceHelpers(ctx),
  });
}
