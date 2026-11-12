// Triggers: what scripts get from at(), prayer() and every(), when each is next due, and how the
// card says it in plain words.
import { LIMITS } from './limits';
import { addDays, ajmanClock, ajmanDay, PRAYER_KEYS, PRAYER_LABEL, prayerTimesFor, type PrayerKey } from './prayer';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DayName = (typeof DAYS)[number];
const DAY_LABEL: Record<DayName, string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

export type Trigger =
  | { kind: 'at'; time: string; days?: DayName[] }
  | { kind: 'prayer'; name: PrayerKey; before?: number; after?: number }
  | { kind: 'every'; minutes: number };

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

/** The first time this trigger is due strictly after `after` (ms), or null. */
export function nextDue(t: Trigger, after: number): number | null {
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
  return `every ${t.minutes} minutes`;
}

/** The card's "When" line. */
export function describeTrigger(t: Trigger): string {
  if (t.kind === 'prayer') {
    const p = PRAYER_LABEL[t.name];
    const when = t.before ? `${t.before} minutes before ${p}` : t.after ? `${t.after} minutes after ${p}` : `At ${p}`;
    return `${when}, every day (Ajman prayer times)`;
  }
  if (t.kind === 'at') {
    const days = t.days ? t.days.map((d) => DAY_LABEL[d]).join(', ') : 'every day';
    return `At ${t.time}, ${days}`;
  }
  return t.minutes % 60 === 0 ? `Every ${t.minutes / 60 === 1 ? 'hour' : `${t.minutes / 60} hours`}` : `Every ${t.minutes} minutes`;
}

export { ajmanClock };
