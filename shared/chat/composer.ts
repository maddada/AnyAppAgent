// The composer's state (send, queue, stop), the draft kept per app, and "stick to the newest item
// unless the reader scrolled up". Both apps draw their own composer and list on top of these.
import type { App } from "../protocol.ts";

export type ComposerButton = "send" | "queue" | "stop";

export interface ComposerState {
  button: ComposerButton;
  /** The button can be pressed now. */
  enabled: boolean;
  /** For screen readers and tooltips. */
  label: string;
  placeholder: string;
}

/** The agent (or the build after it) is busy: a message sent now waits its turn. */
export function isBusy(app: App | undefined): boolean {
  return app?.status === "working" || app?.status === "building" || app?.status === "creating";
}

/**
 * While the agent works the button is Stop; typing turns it into Send again, and what is sent then
 * waits in the queue until the turn (and its build) ends, as in bb.
 */
export function composerState(
  app: App | undefined,
  text: string,
  opts: { sending?: boolean; stopping?: boolean; online?: boolean; images?: number } = {},
): ComposerState {
  // Pictures alone can be sent too.
  const hasText = text.trim().length > 0 || (opts.images ?? 0) > 0;
  const online = opts.online ?? true;
  const placeholder = app?.status === "creating" ? "Your app is being set up…" : "Ask for a change";
  if (app?.status === "working" && !hasText) {
    return { button: "stop", enabled: online && !opts.stopping, label: opts.stopping ? "Stopping" : "Stop", placeholder };
  }
  const queue = hasText && isBusy(app);
  return {
    button: queue ? "queue" : "send",
    enabled: !!app && online && hasText && !opts.sending,
    label: queue ? "Send when the agent is free" : "Send",
    placeholder,
  };
}

/** Enter sends on the PC, Shift+Enter makes a new line (the phone's keyboard always makes a new line). */
export function enterSends(key: string, shift: boolean, composing: boolean): boolean {
  return key === "Enter" && !shift && !composing;
}

/** The composer grows to this many lines of type.body, then scrolls (COMPONENTS.md, Composer). */
export const COMPOSER_MAX_LINES = 6;

/**
 * A draft per app, kept while the user moves between apps (in memory, for this run of the app):
 * the text, and the pictures attached but not sent yet (each app stores its own picture type).
 */
export class Drafts<Attachment = unknown> {
  private readonly texts = new Map<string, string>();
  private readonly attached = new Map<string, Attachment[]>();
  attachments(appId: string): Attachment[] {
    return this.attached.get(appId) ?? [];
  }
  setAttachments(appId: string, list: Attachment[]): void {
    if (list.length === 0) this.attached.delete(appId);
    else this.attached.set(appId, list);
  }
  get(appId: string): string {
    return this.texts.get(appId) ?? "";
  }
  set(appId: string, text: string): void {
    if (text === "") this.texts.delete(appId);
    else this.texts.set(appId, text);
  }
  clear(appId: string): void {
    this.texts.delete(appId);
    this.attached.delete(appId);
  }
}

/** Within this distance (px or dp) of the newest item the chat counts as "at the newest" and follows new items. */
export const FOLLOW_WITHIN = 88;

/**
 * Stick to the newest item while the agent works, unless the reader scrolled up to read; then a
 * "Jump to latest" control brings them back (bb's thread view).
 */
export class Follower {
  pinned = true;
  /** Call on every scroll with the distance from the newest item. Returns true when `pinned` changed. */
  scrolled(distanceFromNewest: number): boolean {
    const pinned = Math.abs(distanceFromNewest) <= FOLLOW_WITHIN;
    if (pinned === this.pinned) return false;
    this.pinned = pinned;
    return true;
  }
  /** New content arrived: scroll to it only when pinned. */
  shouldFollow(): boolean {
    return this.pinned;
  }
  /** The reader pressed Jump to latest, sent a message, or opened another app. */
  jump(): void {
    this.pinned = true;
  }
}
