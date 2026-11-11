// Home screen widgets. Declare each widget in app.json (modules/abilities/app.plugin.js), then
// set what it shows with setWidget whenever the data changes. Android draws the last content, so
// the widget stays right while the app is closed, and a timeline moves it on by itself.
import { native } from './native';

export type WidgetRow = { label: string; value?: string; strong?: boolean };

export type WidgetButton = {
  label: string;
  /** The action name (see onAction and useOpenAction). */
  action: string;
  /** true opens the app with the action; false (default) runs it in the background. */
  open?: boolean;
};

type Fields = {
  /** Small line at the top, in the accent colour. */
  title?: string;
  /** The big text: "5 of 8", "15:12". */
  value?: string;
  /** Up to two lines under it. */
  subtitle?: string;
  /** Shows a live countdown (1:23:45) in place of value until this moment. */
  countdownTo?: Date | number;
  /** A bar from 0 to 1. */
  progress?: number;
  /** Up to 6 label and value rows (today's times, a short list). strong rows use the accent. */
  rows?: WidgetRow[];
  button?: WidgetButton;
  /** Tapping the widget opens the app; with tapAction, useOpenAction gets this action too. */
  tapAction?: string;
  /** Accent colours like "#14532D" (light mode) and for dark mode. Default: a calm green. */
  accent?: string;
  accentDark?: string;
};

export type WidgetContent = Fields & {
  /** Later versions: from `at` on, these fields replace the ones above (next prayer, a new day). */
  timeline?: (Fields & { at: Date | number })[];
};

function ms(d: Date | number): number {
  return typeof d === 'number' ? d : d.getTime();
}

function toNative(c: Fields): Record<string, unknown> {
  const out: Record<string, unknown> = { ...c };
  if (c.countdownTo !== undefined) out.countdownTo = ms(c.countdownTo);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** Sets what widget [id] (from app.json) shows, on every copy of it on the home screen. */
export function setWidget(id: string, content: WidgetContent): void {
  const { timeline, ...fields } = content;
  const json = toNative(fields);
  if (timeline) json.timeline = timeline.map(({ at, ...e }) => ({ ...toNative(e), at: ms(at) }));
  native.setWidget(id, JSON.stringify(json));
}

/** True when the person has put widget [id] on the home screen. */
export function isWidgetPlaced(id: string): boolean {
  return native.isWidgetPlaced(id);
}

/**
 * Asks Android to add widget [id] to the home screen (it shows its own "Add" box). Use it for an
 * "Add to home screen" button. Returns false if the launcher cannot; then tell the person:
 * "Touch and hold the home screen, tap Widgets, find this app".
 */
export function pinWidget(id: string): boolean {
  return native.pinWidget(id);
}

/** The widget ids declared in app.json. */
export function widgetIds(): string[] {
  return native.widgetIds();
}
