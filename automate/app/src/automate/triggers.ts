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
  | { kind: 'bluetooth'; connected: boolean; device?: string }
  | { kind: 'notification'; app?: string; text?: string }
  | { kind: 'place'; place: string; entering: boolean; lat?: number; lon?: number; radius?: number }
  | { kind: 'app'; app: string; minutes: number };

/** What the phone reports (modules/automate ListenerService). */
export type PhoneEvent =
  | { kind: 'charging'; plugged: boolean }
  | { kind: 'wifi'; connected: boolean; network?: string | null }
  | { kind: 'bluetooth'; connected: boolean; device?: string | null }
  | { kind: 'notification'; app: string; package: string; title?: string | null; text?: string | null }
  | { kind: 'place'; name: string; entering: boolean }
  | { kind: 'app'; app: string; package: string; minutes: number };

export type EventKind = PhoneEvent['kind'];

export function isEventTrigger(t: Trigger): t is Extract<Trigger, { kind: EventKind }> {
  return t.kind === 'charging' || t.kind === 'wifi' || t.kind === 'bluetooth' || t.kind === 'notification' || t.kind === 'place' || t.kind === 'app';
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

/** notification({ app, text }): a notification from an app (part of its name), optionally mentioning some text. */
export function makeNotification(options?: { app?: unknown; text?: unknown }): Trigger {
  const app = name(options?.app, 'app');
  const text = name(options?.text, 'text');
  return Object.freeze({ kind: 'notification', ...(app ? { app } : {}), ...(text ? { text } : {}) });
}

function place(spec: unknown, entering: boolean, options?: { radius?: unknown }): Trigger {
  const radius = options?.radius === undefined ? undefined : Number(options.radius);
  if (radius !== undefined && (!isFinite(radius) || radius < 50 || radius > 5000)) throw new ScriptError('radius must be 50 to 5000 metres.');
  if (typeof spec === 'string') {
    const n = name(spec, 'place');
    return Object.freeze({ kind: 'place', place: n as string, entering, ...(radius ? { radius } : {}) });
  }
  const o = spec as { lat?: unknown; lon?: unknown; name?: unknown } | undefined;
  const lat = Number(o?.lat);
  const lon = Number(o?.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new ScriptError('A place is a saved name ("Mosque") or { lat, lon, name }.');
  return Object.freeze({ kind: 'place', place: name(o?.name ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'name') as string, entering, lat, lon, ...(radius ? { radius } : {}) });
}

/** arrive('Mosque') or arrive({ lat, lon, name }): getting there. */
export function makeArrive(spec: unknown, options?: { radius?: unknown }): Trigger {
  return place(spec, true, options);
}

/** leave('Work'): going away from it. */
export function makeLeave(spec: unknown, options?: { radius?: unknown }): Trigger {
  return place(spec, false, options);
}

/** appOpened('YouTube', { forMinutes: 30 }): an app comes to the front (or has stayed there that long). */
export function makeAppOpened(app: unknown, options?: { forMinutes?: unknown }): Trigger {
  const a = name(app, 'app');
  if (!a) throw new ScriptError('appOpened() needs the app\'s name.');
  const m = options?.forMinutes === undefined ? 0 : Number(options.forMinutes);
  if (!isFinite(m) || m < 0 || m > 600) throw new ScriptError('forMinutes must be 0 to 600.');
  return Object.freeze({ kind: 'app', app: a, minutes: Math.round(m) });
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
  if (t.kind === 'place' && e.kind === 'place') return t.entering === e.entering && t.place.toLowerCase() === e.name.toLowerCase();
  if (t.kind === 'app' && e.kind === 'app') {
    const a = t.app.toLowerCase();
    return t.minutes === e.minutes && (e.app.toLowerCase().includes(a) || e.package.toLowerCase() === a);
  }
  if (t.kind === 'notification' && e.kind === 'notification') {
    const app = t.app?.toLowerCase();
    if (app && !e.app.toLowerCase().includes(app) && e.package.toLowerCase() !== app) return false;
    const words = `${e.title ?? ''}\n${e.text ?? ''}`.toLowerCase();
    return !t.text || words.includes(t.text.toLowerCase());
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
  if (t.kind === 'notification') return `a notification from ${t.app ?? 'an app'}`;
  if (t.kind === 'place') return `${t.entering ? 'arrived at' : 'left'} ${t.place}`;
  if (t.kind === 'app') return t.minutes ? `${t.app} for ${t.minutes} min` : `${t.app} opened`;
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
  if (t.kind === 'place') return t.entering ? `When you arrive at ${t.place}` : `When you leave ${t.place}`;
  if (t.kind === 'app') return t.minutes ? `When ${t.app} has been open for ${t.minutes} minutes` : `When ${t.app} opens`;
  if (t.kind === 'notification') {
    const from = t.app ? `from ${t.app}` : 'from any app';
    return t.text ? `When a notification ${from} mentions "${t.text}"` : `When a notification comes ${from}`;
  }
  if (t.kind === 'at') {
    const days = t.days ? t.days.map((d) => DAY_LABEL[d]).join(', ') : 'every day';
    return `At ${t.time}, ${days}`;
  }
  return t.minutes % 60 === 0 ? `Every ${t.minutes / 60 === 1 ? 'hour' : `${t.minutes / 60} hours`}` : t.minutes === 1 ? 'Every minute' : `Every ${t.minutes} minutes`;
}

export { ajmanClock };
