// The native side of Automate (Kotlin: modules/automate/android). It wakes the app at
// exact times to run automations (even when the app is closed, after a reboot), and holds the
// powers that need Android: Do Not Disturb, speech, notifications, the ask-before-sending
// question and Stop all. The runtime in src/automate is its only user: scripts never see it.
import { requireNativeModule } from 'expo';

type Native = {
  arm(id: string, at: number, payload: string): Promise<boolean>;
  disarm(id: string): Promise<void>;
  disarmAll(): Promise<void>;
  armed(): Promise<{ id: string; at: number; payload: string }[]>;
  canExact(): boolean;

  dndAccess(): boolean;
  openDndSettings(): Promise<void>;
  dndIsOn(): boolean;
  dndOn(minutes: number): Promise<number>;
  dndOff(): Promise<boolean>;

  speak(text: string, language: string | null): Promise<void>;
  notify(title: string, body: string | null, tag: string): Promise<void>;
  canNotify(): boolean;

  ask(title: string, text: string, timeoutMs: number): Promise<string>;

  isStopped(): boolean;
  stopAll(): Promise<void>;
  resume(): Promise<void>;

  listen(kinds: string[], apps: string[]): Promise<void>;
  notificationAccess(): boolean;
  openNotificationAccess(): Promise<void>;
  openAppInfo(): Promise<void>;
  hasPermission(name: string): boolean;
};

const native = requireNativeModule<Native>('AppwinAutomate');

/** Wakes the app at `at` (ms) to run `payload` (JSON). Same id replaces. False when not exact. */
export const arm = (id: string, at: number, payload: object) => native.arm(id, at, JSON.stringify(payload));
export const disarm = (id: string) => native.disarm(id);
export const disarmAll = () => native.disarmAll();
export const armed = async () =>
  (await native.armed()).map((a) => ({ id: a.id, at: a.at, payload: safeJson(a.payload) }));
export const canExact = () => native.canExact();

export const dnd = {
  hasAccess: () => native.dndAccess(),
  openSettings: () => native.openDndSettings(),
  isOn: () => native.dndIsOn(),
  /** Turns it on (priority only: alarms still sound); ends by itself after `minutes` (0: stays on). Returns the end time or 0. */
  on: (minutes: number) => native.dndOn(minutes),
  /** Turns it off if this app turned it on. False when someone else did (then it is left alone). */
  off: () => native.dndOff(),
};

export const speakNow = (text: string, language?: string) => native.speak(text, language ?? null);
export const notifyNow = (title: string, body: string | undefined, tag: string) => native.notify(title, body ?? null, tag);
export const canNotify = () => native.canNotify();

/** A notification with Allow / Don't allow. "allow", "deny" or "timeout". */
export const ask = (title: string, text: string, timeoutMs: number) =>
  native.ask(title, text, timeoutMs) as Promise<'allow' | 'deny' | 'timeout'>;

export const isStopped = () => native.isStopped();
/** Stops everything at once: no automation runs, every wake-up is cancelled, Do Not Disturb this app turned on goes off, speech stops. */
export const stopAll = () => native.stopAll();
export const resume = () => native.resume();

/**
 * Starts the listener for these events ('bluetooth', 'charging', 'wifi'), or stops it for none;
 * 'notification' turns the notification watcher on for these apps (none: any app).
 */
export const listen = (kinds: string[], apps: string[] = []) => native.listen(kinds, apps);
/** Notifications from other apps: whether the person allowed access, and the pages to allow it. */
export const notificationAccess = () => native.notificationAccess();
export const openNotificationAccess = () => native.openNotificationAccess();
export const openAppInfo = () => native.openAppInfo();
/** Whether Android granted this permission (android.permission.*). */
export const hasPermission = (name: string) => native.hasPermission(name);

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
