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
