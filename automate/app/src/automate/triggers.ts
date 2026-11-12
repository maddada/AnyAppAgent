// Triggers: what scripts get from at(), prayer(), every() (times) and charging(), wifi(),
// bluetooth() (events), when a time trigger is next due, which event matches, and how the card
// says each in plain words.
import { LIMITS } from './limits';
import { addDays, ajmanClock, ajmanDay, PRAYER_KEYS, PRAYER_LABEL, prayerTimesFor, type PrayerKey } from './prayer';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DayName = (typeof DAYS)[number];
const DAY_LABEL: Record<DayName, string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

export type Trigger =
  | { kind: 'at'; time: string; days?: DayName[] }
  | { kind: 'prayer'; name: PrayerKey; before?: number; after?: number }
  | { kind: 'every'; minutes: number }
  | { kind: 'charging'; plugged: boolean }
  | { kind: 'wifi'; connected: boolean; network?: string }
  | { kind: 'bluetooth'; connected: boolean; device?: string };

/** What the phone reports (modules/automate ListenerService). */
export type PhoneEvent =
  | { kind: 'charging'; plugged: boolean }
  | { kind: 'wifi'; connected: boolean; network?: string | null }
  | { kind: 'bluetooth'; connected: boolean; device?: string | null };

export type EventKind = PhoneEvent['kind'];

export function isEventTrigger(t: Trigger): t is Extract<Trigger, { kind: EventKind }> {
  return t.kind === 'charging' || t.kind === 'wifi' || t.kind === 'bluetooth';
}

export class ScriptError extends Error {}

function minutesOf(value: unknown, what: string): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 24 * 60) throw new ScriptError(`${what} must be a number of minutes from 0 to 1440.`);
  return Math.round(value);
}

/** at('07:30', { days }) */
export function makeAt(time: unknown, options?: { days?: unknown }): Trigger {
  if (typeof time !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new ScriptError(`at() needs a time like "07:30", not ${JSON.stringify(time)}.`);
  const days = options?.days;
  if (days !== undefined) {
    if (!Array.isArray(days) || days.some((d) => !DAYS.includes(d as DayName))) throw new ScriptError('days must be a list like ["mon", "fri"].');
    return Object.freeze({ kind: 'at', time, days: [...(days as DayName[])] });
  }
  return Object.freeze({ kind: 'at', time });
}

/** prayer('isha', { before: 20 }) */
export function makePrayer(name: unknown, options?: { before?: unknown; after?: unknown }): Trigger {
  if (typeof name !== 'string' || !PRAYER_KEYS.includes(name as PrayerKey)) throw new ScriptError(`prayer() needs one of ${PRAYER_KEYS.join(', ')}.`);
  const before = minutesOf(options?.before, 'before');
  const after = minutesOf(options?.after, 'after');
  return Object.freeze({ kind: 'prayer', name: name as PrayerKey, ...(before ? { before } : {}), ...(after ? { after } : {}) });
}

/** every({ minutes: 30 }) */
export function makeEvery(interval: { minutes?: unknown; hours?: unknown } | undefined, locksOff: boolean): Trigger {
  const m = Number(interval?.minutes ?? 0) + Number(interval?.hours ?? 0) * 60;
  if (!isFinite(m) || m <= 0) throw new ScriptError('every() needs { minutes } or { hours }.');
  const min = locksOff ? 1 : LIMITS.minEveryMinutes;
  if (m < min) throw new ScriptError(`every() cannot be more often than every ${min} minutes (safety lock).`);
  return Object.freeze({ kind: 'every', minutes: Math.round(m) });
}

function flag(value: unknown, what: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ScriptError(`${what} must be true or false.`);
  return value;
}

function name(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 64) throw new ScriptError(`${what} must be a short name.`);
  return value.trim();
}

/** charging({ plugged }): the charger plugged in (default) or unplugged. */
export function makeCharging(options?: { plugged?: unknown }): Trigger {
  return Object.freeze({ kind: 'charging', plugged: flag(options?.plugged, 'plugged', true) });
}

/** wifi({ connected, network }): Wi-Fi connects (default) or drops; `network` is its name. */
export function makeWifi(options?: { connected?: unknown; network?: unknown }): Trigger {
  const network = name(options?.network, 'network');
  return Object.freeze({ kind: 'wifi', connected: flag(options?.connected, 'connected', true), ...(network ? { network } : {}) });
}

/** bluetooth({ connected, device }): a Bluetooth device connects (default) or disconnects; `device` is part of its name. */
export function makeBluetooth(options?: { connected?: unknown; device?: unknown }): Trigger {
  const device = name(options?.device, 'device');
  return Object.freeze({ kind: 'bluetooth', connected: flag(options?.connected, 'connected', true), ...(device ? { device } : {}) });
}

/** Whether an event the phone reported starts this trigger. */
export function matches(t: Trigger, e: PhoneEvent): boolean {
  if (t.kind === 'charging' && e.kind === 'charging') return t.plugged === e.plugged;
  if (t.kind === 'wifi' && e.kind === 'wifi') {
    if (t.connected !== e.connected) return false;
    return !t.network || (!!e.network && e.network.toLowerCase() === t.network.toLowerCase());
  }
  if (t.kind === 'bluetooth' && e.kind === 'bluetooth') {
    if (t.connected !== e.connected) return false;
    return !t.device || (!!e.device && e.device.toLowerCase().includes(t.device.toLowerCase()));
  }
  return false;
}

/** The first time this trigger is due strictly after `after` (ms), or null (events have no time). */
export function nextDue(t: Trigger, after: number): number | null {
  if (isEventTrigger(t)) return null;
  if (t.kind === 'every') {
    const step = t.minutes * 60_000;
    return Math.floor(after / step) * step + step;
  }
  if (t.kind === 'prayer') {
    const today = ajmanDay(after);
    for (let i = -1; i < 3; i++) {
      const due = prayerTimesFor(addDays(today, i))[t.name] - (t.before ?? 0) * 60_000 + (t.after ?? 0) * 60_000;
      if (due > after) return due;
    }
    return null;
  }
  const [h, m] = t.time.split(':').map(Number);
  const base = new Date(after);
  for (let i = 0; i < 9; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, h, m, 0, 0);
    if (d.getTime() <= after) continue;
    if (t.days && !t.days.includes(DAYS[d.getDay()])) continue;
    return d.getTime();
  }
  return null;
}

/** The soonest of several triggers. */
export function nextOf(triggers: Trigger[], after: number): { due: number; trigger: Trigger } | null {
  let best: { due: number; trigger: Trigger } | null = null;
  for (const trigger of triggers) {
    const due = nextDue(trigger, after);
    if (due !== null && (!best || due < best.due)) best = { due, trigger };
  }
  return best;
}

/** Short label, for the run log and event.trigger: "maghrib", "07:30", "every 30 minutes". */
export function triggerLabel(t: Trigger): string {
  if (t.kind === 'prayer') return t.before ? `${t.before} min before ${t.name}` : t.after ? `${t.after} min after ${t.name}` : t.name;
  if (t.kind === 'at') return t.time;
  if (t.kind === 'charging') return t.plugged ? 'charger in' : 'charger out';
  if (t.kind === 'wifi') return `${t.network ?? 'Wi-Fi'} ${t.connected ? 'connected' : 'lost'}`;
  if (t.kind === 'bluetooth') return `${t.device ?? 'Bluetooth'} ${t.connected ? 'connected' : 'disconnected'}`;
  return `every ${t.minutes === 1 ? 'minute' : `${t.minutes} minutes`}`;
}

/** The card's "When" line. */
export function describeTrigger(t: Trigger): string {
  if (t.kind === 'prayer') {
    const p = PRAYER_LABEL[t.name];
    const when = t.before ? `${t.before} minutes before ${p}` : t.after ? `${t.after} minutes after ${p}` : `At ${p}`;
    return `${when}, every day (Ajman prayer times)`;
  }
  if (t.kind === 'charging') return t.plugged ? 'When the charger is plugged in' : 'When the charger is unplugged';
  if (t.kind === 'wifi') {
    const which = t.network ? `the Wi-Fi "${t.network}"` : 'any Wi-Fi';
    return t.connected ? `When the phone connects to ${which}` : `When the phone loses ${which}`;
  }
  if (t.kind === 'bluetooth') {
    const which = t.device ? `a Bluetooth device called "${t.device}"` : 'any Bluetooth device';
    return t.connected ? `When ${which} connects` : `When ${which} disconnects`;
  }
  if (t.kind === 'at') {
    const days = t.days ? t.days.map((d) => DAY_LABEL[d]).join(', ') : 'every day';
    return `At ${t.time}, ${days}`;
  }
  return t.minutes % 60 === 0 ? `Every ${t.minutes / 60 === 1 ? 'hour' : `${t.minutes / 60} hours`}` : t.minutes === 1 ? 'Every minute' : `Every ${t.minutes} minutes`;
}

export { ajmanClock };
