// "Change this app" (docs/CHANGE-THIS-APP.md): a suggestion someone sends the person who made an
// app, as plain text through Android's share menu (WhatsApp, SMS, email). The same words come from
// AnyAppAgent on a friend's phone and from the app's own explanation sheet (Kotlin,
// com.anyapp.updates.ChangeSheet writes exactly this format; keep them the same). The owner shares
// the message into AnyAppAgent or pastes it on the PC, and it is filed under the right app by the
// last line, which names the app's package.
//
//   Ahmad suggests a change to Prayer Times:
//
//   Bigger numbers, I can't read Isha.
//
//   If you made Prayer Times with AnyAppAgent, share this message to AnyAppAgent or paste it there.
//   anyapp-suggestion: com.anyapp.prayertimes 37

export const SUGGESTION_MARK = "anyapp-suggestion:";
const PACKAGE = "[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+";
const MARK_LINE = new RegExp(`^\\s*${SUGGESTION_MARK}\\s*(${PACKAGE})(?:\\s+(\\d{1,10}))?\\s*$`, "im");
const HEADER = /^\s*(.{1,60}?) suggests a change to (.{1,80}?):\s*$/i;
const FOOTER = /^\s*If you made .* with AnyAppAgent\b/i;

/** At most this many characters of the suggestion itself are kept. */
export const SUGGESTION_MAX = 2000;

export interface SuggestionDraft {
  appName: string;
  packageName: string;
  /** The suggester's name as they typed it; empty is "Someone". */
  from?: string;
  text: string;
  /** The version (Android versionCode) on the suggester's phone. */
  build?: number;
}

export interface ParsedSuggestion {
  packageName: string;
  appName?: string;
  from?: string;
  text: string;
  build?: number;
}

function clean(s: string | undefined, max: number): string {
  return (s ?? "").replace(/\u2014/g, ", ").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

/** The message a suggester sends: header, their words, a line for the owner, the filing line. */
export function suggestionText(d: SuggestionDraft): string {
  const from = clean(d.from, 60) || "Someone";
  const app = clean(d.appName, 80) || "your app";
  const body = d.text.replace(/\u2014/g, ", ").trim().slice(0, SUGGESTION_MAX);
  const build = d.build && d.build > 0 ? ` ${Math.floor(d.build)}` : "";
  return [
    `${from} suggests a change to ${app}:`,
    "",
    body,
    "",
    `If you made ${app} with AnyAppAgent, share this message to AnyAppAgent or paste it there.`,
    `${SUGGESTION_MARK} ${d.packageName}${build}`,
  ].join("\n");
}

/**
 * Reads a suggestion back from a message (also after a messenger added its own lines around it,
 * or the person edited it). Null when the filing line is missing or nothing is suggested.
 */
export function parseSuggestion(message: string): ParsedSuggestion | null {
  if (!message) return null;
  const text = message.replace(/\r\n?/g, "\n");
  const mark = MARK_LINE.exec(text);
  if (!mark) return null;
  const lines = text.slice(0, mark.index).split("\n");
  let start = 0;
  let from: string | undefined;
  let appName: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const h = HEADER.exec(lines[i]!);
    if (h) {
      start = i + 1;
      from = h[1]!.trim();
      appName = h[2]!.trim();
      break;
    }
  }
  const body = lines
    .slice(start)
    .filter((l) => !FOOTER.test(l))
    .join("\n")
    .trim()
    .slice(0, SUGGESTION_MAX);
  if (!body) return null;
  const build = mark[2] ? Number(mark[2]) : undefined;
  return {
    packageName: mark[1]!.toLowerCase(),
    ...(appName ? { appName } : {}),
    ...(from && !/^someone$/i.test(from) ? { from } : {}),
    text: body,
    ...(build && Number.isFinite(build) ? { build } : {}),
  };
}

/** What "Open in chat" puts in the app's composer for the owner to send or edit. */
export function suggestionPrompt(s: { from?: string; text: string }): string {
  return `${s.from ? `${s.from} suggested` : "Someone suggested"} this change: ${s.text.trim()}`;
}

// ---------- the change link an app opens: anyappagent://change?...

export interface ChangeLink {
  packageName: string;
  appName?: string;
  owner?: string;
  /** owner/anyapp-<slug>-releases, when the app is shared on GitHub. */
  repo?: string;
  build?: number;
  version?: string;
  /** Where in the app the person tapped it ("settings"). */
  screen?: string;
}

const REPO = /^[A-Za-z0-9-]{1,39}\/anyapp-[a-z0-9-]+-releases$/;

/** Reads the link's query (expo-router's params, or a URLSearchParams). Null without a valid package. */
export function readChangeLink(params: Record<string, string | string[] | undefined>): ChangeLink | null {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const packageName = one("package");
  if (!packageName || !new RegExp(`^${PACKAGE}$`).test(packageName)) return null;
  const repo = one("repo");
  const build = Number(one("build"));
  return {
    packageName,
    ...(one("name") ? { appName: one("name")!.slice(0, 80) } : {}),
    ...(one("owner") ? { owner: one("owner")!.slice(0, 60) } : {}),
    ...(repo && REPO.test(repo) ? { repo } : {}),
    ...(Number.isInteger(build) && build > 0 ? { build } : {}),
    ...(one("version") ? { version: one("version")!.slice(0, 30) } : {}),
    ...(one("screen") ? { screen: one("screen")!.slice(0, 40) } : {}),
  };
}

/** "Prayer Times (Ahmad's)", or "My Prayer Times" without a name. */
export function ownVersionName(appName: string, yourName?: string): string {
  const who = clean(yourName, 30);
  const name = who ? `${appName} (${who}'s)` : `My ${appName}`;
  return name.slice(0, 50);
}
