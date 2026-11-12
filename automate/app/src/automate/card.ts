// The card the person approves before an automation turns on. Everything on it except "You
// asked for" is drawn from the script's own code (the fence records every power call with its
// literal arguments) and from its triggers, never from the agent's description.
import type { CardAction } from './store';
import type { Trigger } from './triggers';

export type Need = 'notifications' | 'dnd' | 'exact' | 'listening' | 'nearby' | 'locationAlways' | 'notificationAccess' | 'usageAccess' | 'screen' | 'shizuku';

function text(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function host(url: unknown): string {
  if (typeof url !== 'string') return 'an address worked out when it runs';
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1] : url;
}

/** One plain line for one power call in the code. */
export function actionLine(a: CardAction): string {
  const [first] = a.args;
  switch (a.call) {
    case 'speak': {
      const t = text(first);
      return t ? `Say "${t}" aloud` : 'Say something aloud (the words are worked out when it runs)';
    }
    case 'notify': {
      const t = text(first);
      return t ? `Show a notification: "${t}"` : 'Show a notification';
    }
    case 'doNotDisturb.on': {
      const m = first && typeof first === 'object' ? (first as { minutes?: unknown }).minutes : undefined;
      if (typeof m === 'number') return `Turn on Do Not Disturb for ${m} minutes (alarms still sound)`;
      if (m === null) return 'Turn on Do Not Disturb for a while worked out when it runs';
      return 'Turn on Do Not Disturb (alarms still sound)';
    }
    case 'doNotDisturb.off':
      return 'Turn Do Not Disturb off (only if this app turned it on)';
    case 'doNotDisturb.isOn':
      return 'Check whether Do Not Disturb is on';
    case 'web.get':
      return `Fetch from ${host(first)} (asks you first, every time)`;
    case 'web.post':
      return `Send to ${host(first)} (asks you first, every time)`;
    case 'screen.read':
      return 'Read what is on the screen (never password fields)';
    case 'screen.tap': {
      const t = text(first);
      return t ? `Tap "${t}" on the screen` : 'Tap a button on the screen (worked out when it runs)';
    }
    case 'shizuku.wifi':
      return first === true ? 'Turn Wi-Fi on (Shizuku)' : first === false ? 'Turn Wi-Fi off (Shizuku)' : 'Turn Wi-Fi on or off (Shizuku)';
    case 'shizuku.mobileData':
      return first === true ? 'Turn mobile data on (Shizuku)' : first === false ? 'Turn mobile data off (Shizuku)' : 'Turn mobile data on or off (Shizuku)';
    case 'shizuku.stopApp': {
      const t = text(first);
      return t ? `Stop the app ${t} (Shizuku)` : 'Stop an app (Shizuku)';
    }
    default:
      return `Use ${a.call}`;
  }
}

/** The card's "It will" lines, without repeats. */
export function actionLines(actions: CardAction[]): string[] {
  return [...new Set(actions.map(actionLine))];
}

/** What Android has to allow, from the powers in the code and the triggers. */
export function needsOf(actions: CardAction[], triggers: Trigger[] = []): Need[] {
  const needs = new Set<Need>(['exact']);
  for (const t of triggers) {
    if (t.kind === 'charging' || t.kind === 'wifi' || t.kind === 'bluetooth') needs.add('listening');
    if (t.kind === 'bluetooth') needs.add('nearby');
    if (t.kind === 'wifi' && t.network) needs.add('locationAlways');
    if (t.kind === 'notification') needs.add('notificationAccess');
    if (t.kind === 'place') needs.add('locationAlways');
    if (t.kind === 'app') {
      needs.add('listening');
      needs.add('usageAccess');
    }
  }
  for (const a of actions) {
    if (a.call === 'notify') needs.add('notifications');
    if (a.call === 'doNotDisturb.on' || a.call === 'doNotDisturb.off') needs.add('dnd');
    if (a.call.startsWith('screen.')) needs.add('screen');
    if (a.call.startsWith('shizuku.')) needs.add('shizuku');
  }
  return [...needs];
}

export const NEED_LABEL: Record<Need, { title: string; why: string }> = {
  exact: { title: 'Exact times', why: 'So it runs on the minute, even when the phone sleeps' },
  notifications: { title: 'Notifications', why: 'To show what it does' },
  dnd: { title: 'Do Not Disturb access', why: 'One switch in Settings, so it can turn Do Not Disturb on and off' },
  listening: { title: 'A small notice while it listens', why: 'Android needs it to keep listening for the charger, Wi-Fi or Bluetooth. Stop all is on it' },
  nearby: { title: 'Nearby devices', why: 'To see which Bluetooth device connects' },
  notificationAccess: {
    title: 'Notification access',
    why: 'To see notifications from other apps. If Android says "Restricted setting": App info, the three dots, Allow restricted settings, then try again',
  },
  usageAccess: { title: 'Usage access', why: 'One switch in Settings, so it can see which app is in front' },
  screen: {
    title: 'Screen access (Accessibility)',
    why: 'Lets it read the screen and tap, only for the steps above. Never password fields, installers, Settings or this app. If Android says "Restricted setting": App info, the three dots, Allow restricted settings',
  },
  shizuku: { title: 'Shizuku', why: 'Install Shizuku and start it (wireless debugging; again after every restart), then allow this app in it' },
  locationAlways: { title: 'Location, all the time', why: 'For places, and for Wi-Fi names (Android shows them only with it). The app keeps no record of where you are' },
};

/** What a changed script adds and drops, compared with the version the person approved. */
export function diffLines(before: string[] | undefined, after: string[]): { added: string[]; removed: string[] } {
  if (!before) return { added: [], removed: [] };
  return { added: after.filter((l) => !before.includes(l)), removed: before.filter((l) => !after.includes(l)) };
}
