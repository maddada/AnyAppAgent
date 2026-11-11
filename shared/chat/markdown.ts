// A small, safe markdown parser for the agent's messages. It returns blocks and inline spans for
// each app to draw with its own views; it never produces HTML, and HTML in the text stays text.
// Covers what the agent writes in a chat: paragraphs, headings, bullet, numbered and task lists
// (nested by indentation), fenced code, quotes, rules, tables, **strong**, *em*, ~~del~~,
// `code`, [links](https://...) and bare https:// links. A single newline is a line break (as in
// bb, which uses remark-breaks). Unfinished text (still streaming) parses without errors.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "del"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "br" };

export interface ListItem {
  task?: boolean; // a "- [ ]" or "- [x]" item
  checked?: boolean;
  blocks: Block[];
}

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "paragraph"; inline: Inline[] }
  | { type: "heading"; level: number; inline: Inline[] }
  | { type: "list"; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { type: "code"; lang?: string; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "rule" }
  | { type: "table"; align: Align[]; header: Inline[][]; rows: Inline[][][] };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])([ \t]+(.*))?$/;
const TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Links only to these; anything else (javascript:, file:, intent:) stays plain text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return parseBlocks(lines);
}

const blank = (l: string) => l.trim() === "";

function startsBlock(line: string, next: string | undefined): boolean {
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  const m = ITEM.exec(line);
  // A numbered item interrupts a paragraph only when it starts at 1, as in CommonMark.
  if (m && m[4] !== undefined && m[4].trim() !== "" && (!/^\d/.test(m[2]) || /^1[.)]$/.test(m[2]))) return true;
  return isTableStart(line, next);
}

function isTableStart(line: string, next: string | undefined): boolean {
  return line.includes("|") && next !== undefined && next.includes("-") && TABLE_SEP.test(next) && splitRow(line).length === splitRow(next).length;
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const indent = line.length - line.trimStart().length;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i].slice(Math.min(indent, lines[i].length - lines[i].trimStart().length)));
        i++;
      }
      i++; // the closing fence (or the end while streaming)
      out.push({ type: "code", lang: fence[2] || undefined, text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ type: "heading", level: heading[1].length, inline: parseInline(heading[2] ?? "") });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ type: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i])) {
        const q = QUOTE.exec(lines[i]);
        body.push(q ? q[1] : lines[i]);
        i++;
      }
      out.push({ type: "quote", blocks: parseBlocks(body) });
      continue;
    }
    if (isTableStart(line, lines[i + 1])) {
      const align = splitRow(lines[i + 1]).map((c): Align => {
        const t = c.trim();
        return t.startsWith(":") && t.endsWith(":") ? "center" : t.endsWith(":") ? "right" : t.startsWith(":") ? "left" : null;
      });
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        rows.push(align.map((_, c) => parseInline(cells[c] ?? "")));
        i++;
      }
      out.push({ type: "table", align, header, rows });
      continue;
    }
    const item = ITEM.exec(line);
    if (item && item[4] !== undefined && item[4].trim() !== "") {
      i = parseList(lines, i, out);
      continue;
    }
    // A paragraph: until a blank line or the start of another block.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push({ type: "paragraph", inline: parseInline(para.join("\n")) });
  }
  return out;
}

function parseList(lines: string[], start: number, out: Block[]): number {
  const first = ITEM.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const delimiter = first[2].slice(-1);
  const items: ListItem[] = [];
  let tight = true;
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== indent || /^\d/.test(m[2]) !== ordered || m[2].slice(-1) !== delimiter) break;
    // Content lines belong to this item while they are indented past the marker.
    const contentIndent = indent + m[2].length + 1;
    const body: string[] = [m[4] ?? ""];
    i++;
    let sawBlank = false;
    while (i < lines.length) {
      const l = lines[i];
      if (blank(l)) {
        sawBlank = true;
        body.push("");
        i++;
        continue;
      }
      const lead = l.length - l.trimStart().length;
      if (lead >= contentIndent || (lead > indent && ITEM.test(l))) {
        if (sawBlank && body.some((b) => b.trim() !== "")) tight = false;
        body.push(l.slice(Math.min(lead, contentIndent)));
        sawBlank = false;
        i++;
        continue;
      }
      // A lazy continuation line of the item's paragraph.
      if (!sawBlank && !ITEM.test(l) && !startsBlock(l, lines[i + 1])) {
        body.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    while (body.length && blank(body[body.length - 1])) body.pop();
    // A blank line before the next item of the same list makes the list loose.
    if (sawBlank && i < lines.length && ITEM.test(lines[i])) {
      const next = ITEM.exec(lines[i])!;
      if (next[1].length === indent) tight = false;
    }
    let task: boolean | undefined;
    let checked: boolean | undefined;
    const box = /^\[([ xX])\][ \t]+/.exec(body[0]);
    if (box) {
      task = true;
      checked = box[1] !== " ";
      body[0] = body[0].slice(box[0].length);
    }
    items.push({ ...(task ? { task, checked } : {}), blocks: parseBlocks(body) });
    // Stop at a blank line that is followed by something that is not the next item.
    if (i < lines.length && blank(lines[i - 1] ?? "") && !ITEM.test(lines[i])) break;
  }
  out.push({ type: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, tight, items });
  return i;
}

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === "\\" && l[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "`") {
      inCode = !inCode;
      cell += ch;
    } else if (ch === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

// ---------- inline

const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>";

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const push = (node: Inline) => {
    if (buf) out.push({ type: "text", text: buf });
    buf = "";
    out.push(node);
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);
    if (ch === "\\" && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\\" && text[i + 1] === "\n") {
      push({ type: "br" });
      i += 2;
      continue;
    }
    if (ch === "\n") {
      buf = buf.replace(/ +$/, "");
      push({ type: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(rest)![0];
      const close = text.indexOf(run, i + run.length);
      if (close > 0) {
        let code = text.slice(i + run.length, close).replace(/\n/g, " ");
        if (/^ .* $/.test(code) && code.trim() !== "") code = code.slice(1, -1);
        push({ type: "code", text: code });
        i = close + run.length;
        continue;
      }
      buf += run;
      i += run.length;
      continue;
    }
    if (ch === "[") {
      const link = /^\[((?:[^\[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*<?([^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (link) {
        const href = safeHref(link[2]);
        const children = parseInline(link[1]);
        if (href) push({ type: "link", href, children });
        else {
          if (buf) out.push({ type: "text", text: buf });
          buf = "";
          out.push(...children);
        }
        i += link[0].length;
        continue;
      }
    }
    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) {
        push({ type: "link", href: auto[1], children: [{ type: "text", text: auto[1].replace(/^mailto:/i, "") }] });
        i += auto[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && /[\s(]$|^$/.test(text.slice(Math.max(0, i - 1), i))) {
      const bare = /^https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/i.exec(rest);
      if (bare) {
        push({ type: "link", href: bare[0], children: [{ type: "text", text: bare[0] }] });
        i += bare[0].length;
        continue;
      }
    }
    if (ch === "~" && rest.startsWith("~~")) {
      const close = findClose(text, i + 2, "~~");
      if (close > 0) {
        push({ type: "del", children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const double = text[i + 1] === ch;
      const marker = double ? ch + ch : ch;
      const opens = /\S/.test(text[i + marker.length] ?? "") && (ch === "*" || !/\w/.test(text[i - 1] ?? ""));
      if (opens) {
        const close = findClose(text, i + marker.length, marker, ch === "_");
        if (close > 0) {
          const inner = parseInline(text.slice(i + marker.length, close));
          push(double ? { type: "strong", children: inner } : { type: "em", children: inner });
          i = close + marker.length;
          continue;
        }
      }
      // A literal run of stars or underscores.
      const run = new RegExp(`^\\${ch}+`).exec(rest)![0];
      buf += run;
      i += run.length;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf) out.push({ type: "text", text: buf });
  return decodeEntities(out);
}

/** Where `marker` closes an emphasis that started before `from`, or -1. Skips code spans. */
function findClose(text: string, from: number, marker: string, wordBound = false): number {
  let i = from;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      const end = text.indexOf(run, i + run.length);
      i = end > 0 ? end + run.length : i + run.length;
      continue;
    }
    if (text.startsWith(marker, i) && i > from && /\S/.test(text[i - 1])) {
      const after = text[i + marker.length] ?? "";
      // A single marker is not the end of a double one ("**a* b**").
      if (marker.length === 1 && after === marker) {
        i += 2;
        continue;
      }
      if (!wordBound || !/\w/.test(after)) return i;
    }
    i++;
  }
  return -1;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function decodeEntities(nodes: Inline[]): Inline[] {
  for (const n of nodes) if (n.type === "text") n.text = n.text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
  return nodes;
}

/** The plain text of inline spans (for a screen reader, or a notification). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : n.type === "br" ? "\n" : inlineText(n.children))).join("");
}
