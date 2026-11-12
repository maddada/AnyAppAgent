// The card the person approves before an automation turns on. Everything on it except "You
// asked for" is drawn from the script's own code (the fence records every power call with its
// literal arguments) and from its triggers, never from the agent's description.
import type { CardAction } from './store';

export type Need = 'notifications' | 'dnd' | 'exact';

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
    default:
      return `Use ${a.call}`;
  }
}

/** The card's "It will" lines, without repeats. */
export function actionLines(actions: CardAction[]): string[] {
  return [...new Set(actions.map(actionLine))];
}

/** What Android has to allow, from the powers in the code. */
export function needsOf(actions: CardAction[]): Need[] {
  const needs = new Set<Need>(['exact']);
  for (const a of actions) {
    if (a.call === 'notify') needs.add('notifications');
    if (a.call === 'doNotDisturb.on' || a.call === 'doNotDisturb.off') needs.add('dnd');
  }
  return [...needs];
}

export const NEED_LABEL: Record<Need, { title: string; why: string }> = {
  exact: { title: 'Exact times', why: 'So it runs on the minute, even when the phone sleeps' },
  notifications: { title: 'Notifications', why: 'To show what it does' },
  dnd: { title: 'Do Not Disturb access', why: 'One switch in Settings, so it can turn Do Not Disturb on and off' },
};

/** What a changed script adds and drops, compared with the version the person approved. */
export function diffLines(before: string[] | undefined, after: string[]): { added: string[]; removed: string[] } {
  if (!before) return { added: [], removed: [] };
  return { added: after.filter((l) => !before.includes(l)), removed: before.filter((l) => !after.includes(l)) };
}
