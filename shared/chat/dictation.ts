// Dictation into a text box, the same on the phone and the desktop: where the spoken words go, and
// how the recognizer's running results (partials) and its finished words (final) are merged into the
// box without ever losing a word.
//
// - Words go in where the caret was when dictation started (or over the selected text); everything
//   before and after it stays as it was.
// - A partial is "the words heard so far". Some Android recognizers start the partials over after a
//   pause (only the newest stretch of speech), so a partial that is plainly a new stretch keeps the
//   one before it instead of replacing it.
// - The final may be the whole dictation or only its last stretch: either way nothing heard before
//   is lost. An empty final keeps what the partials showed.
// - When the person changes the box while it listens, their change stays and the words heard after
//   it go on from there.
// Plain TypeScript, no dependencies (tested in test/dictation.test.ts).

export interface DictationWrite {
  /** The whole box. */
  value: string;
  /** Where the caret goes: right after the dictated words. */
  caret: number;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,!?;:"()[\]{}\u2026\u060C\u061F]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Joins two runs of words with one space where they need one. */
export function joinWords(a: string, b: string): string {
  if (!b) return a;
  if (!a) return b;
  return /\s$/.test(a) || /^[\s.,!?;:)]/.test(b) ? a + b : `${a} ${b}`;
}

/** Puts `text` in `value` between `start` and `end`, with a space where the neighbours need one. */
export function insertAt(value: string, start: number, end: number, text: string): DictationWrite {
  const s = clamp(start, value.length);
  const e = Math.max(s, clamp(end, value.length));
  const before = value.slice(0, s);
  const after = value.slice(e);
  if (!text) return { value: before + after, caret: before.length };
  const lead = before && !/\s$/.test(before) && !/^[.,!?;:)]/.test(text) ? " " : "";
  const trail = after && !/^[\s.,!?;:)]/.test(after) ? " " : "";
  return { value: before + lead + text + trail + after, caret: before.length + lead.length + text.length };
}

const clamp = (n: number, max: number) => (Number.isFinite(n) ? Math.min(Math.max(0, Math.floor(n)), max) : max);

/**
 * Whether `next` is a new stretch of speech rather than a better guess at `prev`: it is shorter,
 * starts with another word, and either shares few of its words or is at most half as long (a better
 * guess hardly ever halves). ("I scream for" then "ice cream for" is a better guess; "make the
 * button blue" then "and" is a new stretch.)
 */
export function isNewStretch(prev: string, next: string): boolean {
  const p = words(prev);
  const n = words(next);
  if (p.length === 0 || n.length === 0) return false;
  if (n.length >= p.length) return false;
  if (p[0] === n[0]) return false;
  const seen = new Set(p);
  const shared = n.filter((w) => seen.has(w)).length;
  return shared / n.length < 0.5 || n.length * 2 <= p.length;
}

/** Whether a final `text` already holds `heard` (the stretches kept so far) at its start. */
function holdsAll(text: string, heard: string): boolean {
  const t = words(text);
  const h = words(heard);
  if (h.length === 0) return true;
  if (t.length < h.length) return false;
  const lead = Math.min(3, h.length);
  for (let i = 0; i < lead; i++) if (t[i] !== h[i]) return false;
  return true;
}

/**
 * One dictation into one box. Start it with the box's text and selection; give it each partial and
 * the final; write what it returns into the box. Before each result, `sync` with the box's text as it
 * is now, so a change the person made while it listened is kept.
 */
export class DictationText {
  private before: string;
  private after: string;
  /** Stretches of speech kept for good (an earlier stretch, or the words before a change). */
  private kept = "";
  /** The current stretch, as the recognizer last had it. */
  private live = "";
  /** Words of the current stretch already in the box before the person changed it. */
  private skip = "";
  private written: string;
  private done = false;

  constructor(value: string, selectionStart: number = value.length, selectionEnd: number = selectionStart) {
    const s = clamp(selectionStart, value.length);
    const e = Math.max(s, clamp(selectionEnd, value.length));
    this.before = value.slice(0, s);
    this.after = value.slice(e);
    this.written = value;
  }

  /** The box's text now. A change made outside dictation is kept; new words go on after it. */
  sync(current: string): void {
    if (current === this.written) return;
    const end = this.after && current.endsWith(this.after) ? current.length - this.after.length : current.length;
    if (end === current.length) this.after = "";
    this.before = current.slice(0, end);
    this.skip = joinWords(this.skip, this.live);
    this.kept = "";
    this.live = "";
    this.written = current;
  }

  /** The words heard so far in the current stretch. */
  partial(text: string): DictationWrite {
    if (this.done) return this.write();
    let t = this.unskip(text.trim());
    if (this.live && isNewStretch(this.live, t)) {
      this.kept = joinWords(this.kept, this.live);
      this.live = "";
    }
    this.live = t;
    return this.write();
  }

  /** The finished words. After this the dictation is over; a new one starts a new DictationText. */
  final(text: string): DictationWrite {
    if (this.done) return this.write();
    const t = this.unskip(text.trim());
    if (t) {
      if (this.kept && holdsAll(t, this.kept)) this.kept = "";
      this.live = t;
    }
    this.kept = joinWords(this.kept, this.live);
    this.live = "";
    this.done = true;
    return this.write();
  }

  /** The words this dictation added so far. */
  get spoken(): string {
    return joinWords(this.kept, this.live);
  }

  private unskip(text: string): string {
    if (!this.skip) return text;
    const skipWords = words(this.skip);
    const t = words(text);
    if (skipWords.length > 0 && t.length >= skipWords.length && skipWords.every((w, i) => t[i] === w)) {
      // Drop as many leading words of `text` as `skip` has, keeping the rest exactly as heard.
      let rest = text;
      for (let i = 0; i < skipWords.length; i++) rest = rest.replace(/^\s*\S+/, "");
      return rest.trim();
    }
    // A new stretch: nothing of it is in the box yet.
    this.skip = "";
    return text;
  }

  private write(): DictationWrite {
    const out = insertAt(this.before + this.after, this.before.length, this.before.length, this.spoken);
    this.written = out.value;
    return out;
  }
}
