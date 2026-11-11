// Pages in the chat (copied from Ghostex pages): the card a published page shows as, and the answers
// message a page sends back to the agent. The phone and the PC draw these the same way; the server
// formats the message with pageAnswersMessage, so all three agree on one envelope:
//
//   <page-answers page="<id>" title="<title>">
//   { "Which layout?": "tabs", "Which layout? (note)": "keep search on top", "Additional notes": "..." }
//   </page-answers>
//
// A page that asks nothing sends {"seen": true, "reply"?: "..."} when the person marks it seen.
import type { ChatItem, PageInfo } from "../protocol.ts";

export const PAGE_ANSWERS_TAG = "page-answers";

/** What a page's answers carry under a question's key plus this, for the note box under it. */
export const NOTE_SUFFIX = " (note)";
/** The key of the page's last "Anything else?" box. */
export const NOTES_KEY = "Additional notes";

function escapeTitle(title: string): string {
  return title.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\r\n]+/g, " ");
}

function unescapeTitle(title: string): string {
  return title.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The message a page's answers reach the agent as (and the chat stores as the person's message). */
export function pageAnswersMessage(id: string, title: string, answers: unknown): string {
  return `<${PAGE_ANSWERS_TAG} page="${id}" title="${escapeTitle(title)}">\n${JSON.stringify(answers ?? null, null, 2)}\n</${PAGE_ANSWERS_TAG}>`;
}

/** The line the PC adds for the main chat when a helper made the page; never shown to the person. */
export function helperPageNote(from: { workerId: string; title: string }): string {
  return `(The helper "${from.title}" (${from.workerId}) made this page. If it needs these answers, pass them on with message_worker.)`;
}
const HELPER_NOTE = /\(The helper "[^"]*" \([^)]*\) made this page\.[^)]*\)/g;

export interface PageAnswers {
  pageId: string;
  title: string;
  answers: unknown;
  /** Text the person wrote around the envelope (none when it came from a page). */
  extra: string;
}

const ENVELOPE = new RegExp(`<${PAGE_ANSWERS_TAG} page="([0-9a-f]{1,64})" title="([^"]*)">\\s*([\\s\\S]*?)\\s*</${PAGE_ANSWERS_TAG}>`);

/** Reads a page's answers message; null for any other text. */
export function parsePageAnswers(text: string | undefined): PageAnswers | null {
  if (!text) return null;
  const match = ENVELOPE.exec(text);
  if (!match) return null;
  let answers: unknown = null;
  try {
    answers = JSON.parse(match[3]);
  } catch {
    answers = match[3];
  }
  const extra = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).replace(HELPER_NOTE, "").trim();
  return { pageId: match[1], title: unescapeTitle(match[2]), answers, extra };
}

export interface AnswerLine {
  /** The question (its answer key), or "Anything else" for the notes box. */
  label: string;
  /** The answer in words: "Tabs", "macOS, Windows", "Skipped". Empty when only a note was written. */
  value: string;
  note?: string;
}

function words(value: unknown): string {
  if (value === null || value === undefined) return "Skipped";
  if (value === "skipped") return "Skipped";
  if (Array.isArray(value)) return value.length ? value.map(words).join(", ") : "Skipped";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The answers card's lines, in the order the page sent them (notes folded under their question). */
export function answerLines(answers: unknown): AnswerLine[] {
  if (answers === null || typeof answers !== "object" || Array.isArray(answers)) return [{ label: "Answer", value: words(answers) }];
  const record = answers as Record<string, unknown>;
  if (record["seen"] === true) {
    const reply = typeof record["reply"] === "string" ? record["reply"].trim() : "";
    return [{ label: "Marked as seen", value: "", ...(reply ? { note: reply } : {}) }];
  }
  const lines: AnswerLine[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key.endsWith(NOTE_SUFFIX) && key.slice(0, -NOTE_SUFFIX.length) in record) continue;
    const note = record[`${key}${NOTE_SUFFIX}`];
    if (key === NOTES_KEY) {
      if (typeof value === "string" && value.trim()) lines.push({ label: "Anything else", value: value.trim() });
      continue;
    }
    lines.push({ label: key, value: words(value), ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}) });
  }
  return lines;
}

/** A short line for the app's tile and list ("Answered: Your app's plan"). */
export function answersPreview(parsed: PageAnswers): string {
  const record = parsed.answers as Record<string, unknown> | null;
  return record && typeof record === "object" && record["seen"] === true ? `Seen: ${parsed.title}` : `Answered: ${parsed.title}`;
}

export type PageCardState = "questions" | "look" | "answered" | "seen";

export interface PageCardView {
  title: string;
  state: PageCardState;
  /** The card's second line. */
  status: string;
  /** Who made it, when a helper did ("From the helper Make the plan"). */
  from?: string;
  /** The button or tap hint. */
  action: string;
  /** Lucide icon name for the card. */
  icon: "file-question" | "file-text" | "file-check";
}

/** How a page's card reads in the chat. */
export function pageCard(page: PageInfo): PageCardView {
  const count = page.questions?.length ?? 0;
  const from = page.from ? { from: `From the helper "${page.from.title}"` } : {};
  if (page.answeredAt) {
    return page.seen
      ? { title: page.title, state: "seen", status: "You marked it seen", action: "Open", icon: "file-check", ...from }
      : { title: page.title, state: "answered", status: "Answered", action: "Open", icon: "file-check", ...from };
  }
  if (count > 0) {
    return {
      title: page.title,
      state: "questions",
      status: count === 1 ? "1 question for you" : `${count} questions for you`,
      action: "Open and answer",
      icon: "file-question",
      ...from,
    };
  }
  return {
    title: page.title,
    state: "look",
    status: page.awaitsSeen ? "Have a look, then mark it seen" : "Have a look",
    action: "Open",
    icon: "file-text",
    ...from,
  };
}

/** True while the page still waits for the person. */
export function pageWaiting(page: PageInfo): boolean {
  return !page.answeredAt && ((page.questions?.length ?? 0) > 0 || page.awaitsSeen === true);
}

/** The pages of a chat that still wait for the person, newest last. */
export function waitingPages(items: readonly ChatItem[]): PageInfo[] {
  return items.filter((i) => i.kind === "page" && i.page && pageWaiting(i.page)).map((i) => i.page!);
}

/** The page's address to load: the path from POST /pages/:pageId/open on the PC's base URL, in a theme. */
export function pageUrl(baseUrl: string, path: string, theme: "light" | "dark"): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}#gx-theme=${theme}`;
}

/**
 * Whether a navigation inside the page's web view stays there: only the page's own address (its
 * hash may change). Everything else (a link the page holds) opens outside, in the browser.
 */
export function staysInPage(pageAddress: string, next: string): boolean {
  const strip = (u: string) => u.split("#")[0];
  return strip(next) === strip(pageAddress) || /^(about:blank|about:srcdoc|data:|blob:)/i.test(next);
}
