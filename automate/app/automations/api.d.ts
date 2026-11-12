// The automation API: the only names an automation script can use (plus Math, JSON, Number,
// String, Boolean, Array, Date, Map, Set, Promise, Error, parseInt, parseFloat, isNaN, isFinite).
// The runtime behind it is src/automate/api.ts; the fence that enforces it is
// tools/automate-fence.js. Read AGENTS.md, "Automations", before writing one.

/** One thing that starts an automation. Make them with at(), prayer(), every(), charging(), wifi() or bluetooth(). */
type AutomationTrigger = { readonly kind: 'at' | 'prayer' | 'every' | 'charging' | 'wifi' | 'bluetooth'; readonly [key: string]: unknown };

type PrayerName = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

/** What started this run. */
type AutomationEvent = {
  /** A short label of the trigger: "maghrib", "07:30", "every 30 minutes", "charger in", "Home connected", or "test" for Try it now. */
  trigger: string;
  /** When the trigger was due (on the pretend clock while testing). */
  at: Date;
  /** True when this run comes from Try it now or the pretend clock. */
  test: boolean;
};

type AutomationDefinition = {
  /** Short name shown in the list: "Maghrib quiet time". */
  name: string;
  /** One plain sentence, in the person's words, of what it does. Shown on the card as "You asked for". */
  says: string;
  /** When it runs: one trigger or several. */
  when: AutomationTrigger | AutomationTrigger[];
  /** What it does. Await every power call. */
  run: (event: AutomationEvent) => void | Promise<void>;
};

/** An automation, as the runtime loads it. Opaque on purpose. */
type AutomationScript = { readonly __automation: true };

/** Declares the automation. Every script ends with `export default automation({ ... })`. */
declare function automation(definition: AutomationDefinition): AutomationScript;

// ---------- Triggers

/**
 * Every day at a local time, "HH:MM" (24 hours). `days` limits it to some weekdays
 * ('mon' ... 'sun').
 */
declare function at(time: string, options?: { days?: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[] }): AutomationTrigger;

/**
 * At a prayer time in Ajman (UAE Awqaf timetable), every day. `before` / `after` in minutes move
 * it earlier or later: prayer('isha', { before: 20 }) is 20 minutes before Isha.
 */
declare function prayer(name: PrayerName, options?: { before?: number; after?: number }): AutomationTrigger;

/** Again and again, every so many minutes or hours (at least 15 minutes while the safety locks are on). */
declare function every(interval: { minutes?: number; hours?: number }): AutomationTrigger;

/** When the charger is plugged in (default) or, with { plugged: false }, unplugged. */
declare function charging(options?: { plugged?: boolean }): AutomationTrigger;

/**
 * When the phone connects to Wi-Fi (default) or, with { connected: false }, loses it. `network` is
 * the Wi-Fi's name; with a name the person also allows Location, all the time (Android shows Wi-Fi
 * names only then). Without a name it is any Wi-Fi.
 */
declare function wifi(options?: { connected?: boolean; network?: string }): AutomationTrigger;

/**
 * When a Bluetooth device connects (default) or, with { connected: false }, disconnects. `device`
 * is part of its name ("Car" matches "My Car Audio"). Needs Nearby devices (asked on the card).
 */
declare function bluetooth(options?: { connected?: boolean; device?: string }): AutomationTrigger;

// ---------- Powers (each one shows on the card, and asks Android once for what it needs)

/** Says the text aloud on the alarm volume (heard in Do Not Disturb too). Up to 300 characters. */
declare function speak(text: string, options?: { language?: string }): Promise<void>;

/** Shows a notification. */
declare function notify(title: string, body?: string): Promise<void>;

declare const doNotDisturb: {
  /** Turns Do Not Disturb on (alarms still sound). With `minutes` it turns itself off again (at most 12 hours). */
  on(options?: { minutes?: number }): Promise<void>;
  /** Turns it off, if this app turned it on. */
  off(): Promise<void>;
  /** Whether Do Not Disturb is on now (by anyone). */
  isOn(): Promise<boolean>;
};

/** Sending: the phone asks the person every time before anything leaves it. https only. */
declare const web: {
  get(url: string): Promise<{ status: number; text: string }>;
  post(url: string, body: string | Record<string, unknown>): Promise<{ status: number; text: string }>;
};

// ---------- Helpers

/** Waits a little (at most 60 seconds). For longer waits use a trigger or doNotDisturb.on({ minutes }). */
declare function sleep(options: { seconds: number }): Promise<void>;

/** Adds a line to this run in the run log. Never log what the person wrote or who they are. */
declare function log(text: string): void;

/** Now (the pretend clock while testing). */
declare function now(): Date;

/** Today's (or a day's) prayer times in Ajman. */
declare function prayerTimes(day?: Date): Record<PrayerName, Date>;

/** Small memory kept between runs of this automation (plain JSON values). */
declare const memory: {
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
};
