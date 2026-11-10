// Pure text helpers for the chat view (unit tested in test/chat-text.test.ts).

const RAW_COMMAND = /(&&|\|\||[|;<>$=]|^"|^(cd|npm|npx|node|git|mkdir|cat|ls|rm|cp|mv|echo|powershell|pwsh|cmd)\b|[A-Za-z]:[\\/])/;

/**
 * The row title: the companion's plain title ("Checked the app"). Chat history from before the
 * companion gave command rows plain titles can still carry a raw command line as the title; those
 * read "Ran a command" and keep the command for the opened row.
 */
export function plainToolTitle(tool: { title: string; kind: string; detail?: string }): string {
  const first = tool.title.split("\n")[0].trim();
  // Search rows can arrive as the raw search command ("grep waterglass").
  if (tool.kind === "search" && /^(grep|rg|find|findstr|Select-String)\b/.test(first)) return "Searched the app";
  if (tool.kind !== "execute") {
    // "Write modules\alarms\android\src\main\...\AlarmModule.kt" reads "Write AlarmModule.kt";
    // the full path shows when the row is opened.
    const m = first.match(/^(\S+)\s+(.*[\\/].+)$/);
    return m ? `${m[1]} ${m[2].split(/[\\/]/).filter(Boolean).pop()}` : first;
  }
  return first === tool.detail?.split("\n")[0].trim() || RAW_COMMAND.test(first) ? "Ran a command" : first;
}

/**
 * One line for a folded run of finished tool rows ("Edited 3 files, ran a command"). Files are
 * counted once each, however often they were edited or read.
 */
export function summarizeTools(tools: { kind: string; title: string; detail?: string }[]): string {
  const files = (kinds: string[]) => new Set(tools.filter((t) => kinds.includes(t.kind)).map((t) => t.detail || t.title)).size;
  const count = (kind: string) => tools.filter((t) => t.kind === kind).length;
  const plural = (k: number, one: string, many: string) => (k === 1 ? one : many.replace("#", String(k)));
  const parts: string[] = [];
  const edited = files(["edit", "delete", "move"]);
  const read = files(["read"]);
  if (edited) parts.push(plural(edited, "edited a file", "edited # files"));
  if (read) parts.push(plural(read, "read a file", "read # files"));
  if (count("execute")) parts.push(plural(count("execute"), "ran a command", "ran # commands"));
  if (count("search")) parts.push(plural(count("search"), "searched once", "searched # times"));
  const known = ["edit", "delete", "move", "read", "execute", "search"];
  const rest = tools.filter((t) => !known.includes(t.kind)).length;
  if (rest > 0) parts.push(plural(rest, "one more step", "# more steps"));
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
