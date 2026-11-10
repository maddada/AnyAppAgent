// Exact alarms that fire while the app is closed and after a reboot, and can play a sound and
// speak text. Native code: modules/alarms/android (Kotlin). Usage: see AGENTS.md, "Alarms".
import { requireNativeModule } from 'expo';

export type AlarmInput = {
  /** Your own stable id. Scheduling the same id again replaces the old alarm. */
  id: string;
  /** When to fire: a Date or a timestamp in milliseconds. */
  at: Date | number;
  /** Notification title. */
  title: string;
  /** Notification text. Defaults to `speak`. */
  body?: string;
  /** Text spoken aloud (text to speech) when the alarm fires, on the alarm volume. */
  speak?: string;
  /** Speech language as a BCP-47 tag, e.g. 'en-US' or 'ar'. Defaults to the phone's language. */
  language?: string;
  /** A file in assets/sounds/ without extension (e.g. 'adhan' for assets/sounds/adhan.mp3), played before the speech. */
  sound?: string;
  /** 'daily' fires again every day at the same local time until cancelled. */
  repeat?: 'daily';
  /**
   * For alarms with `sound` or `speak` (default true): when the phone is locked or its screen is
   * off, show a full-screen alarm with a Stop button (it wakes the screen) and lower other audio
   * while it plays. When the phone is in use it shows as a normal heads-up notification instead.
   * Use false for gentle announcements that should only speak.
   */
  fullScreen?: boolean;
};

export type ScheduledAlarm = Omit<AlarmInput, 'at'> & { at: number };

type NativeAlarm = Omit<AlarmInput, 'at'> & { at: number };

type AnyappAlarmsNative = {
  schedule(alarm: NativeAlarm): Promise<{ id: string; exact: boolean }>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  getAll(): Promise<ScheduledAlarm[]>;
  fireNow(alarm: NativeAlarm): Promise<void>;
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): Promise<void>;
  canUseFullScreenAlarms(): boolean;
  openFullScreenAlarmSettings(): Promise<void>;
};

const Native = requireNativeModule<AnyappAlarmsNative>('AnyappAlarms');

function toNative(alarm: AlarmInput): NativeAlarm {
  const at = alarm.at instanceof Date ? alarm.at.getTime() : alarm.at;
  return { ...alarm, at };
}

/** Schedules (or replaces) an alarm. `exact` is false only if the user revoked exact alarms. */
export function scheduleAlarm(alarm: AlarmInput): Promise<{ id: string; exact: boolean }> {
  return Native.schedule(toNative(alarm));
}

export function cancelAlarm(id: string): Promise<void> {
  return Native.cancel(id);
}

export function cancelAllAlarms(): Promise<void> {
  return Native.cancelAll();
}

/** Alarms still waiting to fire, soonest first. */
export function getScheduledAlarms(): Promise<ScheduledAlarm[]> {
  return Native.getAll();
}

/** Fires an alarm right now (notification, sound, speech): handy for a "Test" button. */
export function testAlarm(alarm: Omit<AlarmInput, 'at'>): Promise<void> {
  return Native.fireNow({ ...alarm, at: Date.now() });
}

export function canScheduleExactAlarms(): boolean {
  return Native.canScheduleExactAlarms();
}

export function openExactAlarmSettings(): Promise<void> {
  return Native.openExactAlarmSettings();
}

/** False if the user turned off full-screen alarms for this app (Android 14+ setting). */
export function canUseFullScreenAlarms(): boolean {
  return Native.canUseFullScreenAlarms();
}

export function openFullScreenAlarmSettings(): Promise<void> {
  return Native.openFullScreenAlarmSettings();
}
