// The automation API: the only names an automation script can use (plus Math, JSON, Number,
// String, Boolean, Array, Date, Map, Set, Promise, Error, parseInt, parseFloat, isNaN, isFinite).
// The runtime behind it is src/automate/api.ts; the fence that enforces it is
// tools/automate-fence.js. Read AGENTS.md, "Automations", before writing one.

/** One thing that starts an automation: at(), prayer(), every(), charging(), wifi(), bluetooth(), notification(), arrive(), leave() or appOpened(). */
type AutomationTrigger = { readonly kind: 'at' | 'prayer' | 'every' | 'charging' | 'wifi' | 'bluetooth' | 'notification' | 'place' | 'app'; readonly [key: string]: unknown };

type PrayerName = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

/** What started this run. */
type AutomationEvent = {
  /** A short label of the trigger: "maghrib", "07:30", "every 30 minutes", "charger in", "Home connected", or "test" for Try it now. */
  trigger: string;
  /** When the trigger was due (on the pretend clock while testing). */
  at: Date;
  /** True when this run comes from Try it now or the pretend clock. */
  test: boolean;
  /**
   * For notification(): the notification that started this run. Private: use it to decide, never
   * log(), speak() or send it unless the person asked for exactly that.
   */
  notification?: { app: string; title: string; text: string };
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

/**
 * When a notification comes from another app. `app` is part of its name ("WhatsApp"), `text` a
 * word or name it must mention ("Mum", in its title or text). The person allows notification
 * access once (asked on the card). The notification is in event.notification.
 */
declare function notification(options?: { app?: string; text?: string }): AutomationTrigger;

/** A place: the name of a place the person saved in Places ("Mosque"), or exact coordinates. */
type PlaceSpec = string | { lat: number; lon: number; name?: string };

/** When the person arrives at a place (within `radius` metres, default 150). Needs Location, all the time. */
declare function arrive(place: PlaceSpec, options?: { radius?: number }): AutomationTrigger;

/** When the person leaves a place. */
declare function leave(place: PlaceSpec, options?: { radius?: number }): AutomationTrigger;

/** When an app comes to the front (`app`: part of its name), or with `forMinutes` once it has stayed there that long. Needs Usage access. */
declare function appOpened(app: string, options?: { forMinutes?: number }): AutomationTrigger;

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

/**
 * Reading the screen and tapping (Accessibility, turned on once on the card). Never in password
 * fields, app installers, Settings, permission screens or this app: that is fixed.
 */
declare const screen: {
  /** What the app in front shows: its name and up to 200 lines of text. */
  read(): Promise<{ app: string; texts: readonly string[] }>;
  /** Taps the first button or item showing this text. */
  tap(text: string): Promise<void>;
};

/** Things no normal app can do, through the person's Shizuku app. Only these, nothing else. */
declare const shizuku: {
  wifi(on: boolean): Promise<void>;
  mobileData(on: boolean): Promise<void>;
  /** Stops another app (by its name). */
  stopApp(app: string): Promise<void>;
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
