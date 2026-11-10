// Turns thousands of lines of build output into the few an agent needs to fix the problem.

const MAX_LINES = 60;
const MAX_CHARS = 6000;

export function cap(lines, maxLines = MAX_LINES) {
  let out = lines.slice(0, maxLines);
  if (lines.length > maxLines) out.push(`… (${lines.length - maxLines} more lines)`);
  let text = out.join('\n');
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n…';
  return text;
}

function dedupe(lines) {
  const seen = new Set();
  return lines.filter((l) => {
    const k = l.trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** `tsc --noEmit` output: each "file(line,col): error TSxxxx" with its continuation lines. */
export function extractTsc(lines) {
  const out = [];
  let count = 0;
  for (const l of lines) {
    if (/error TS\d+:/.test(l)) {
      count++;
      out.push(l.trim());
    } else if (out.length && /^\s{2,}\S/.test(l)) {
      out.push(l);
    }
  }
  if (!out.length) return null;
  return `TypeScript errors (${count}):\n${cap(out, 40)}`;
}

/** Metro / Babel errors from the JS bundling step (inside Gradle or `expo export:embed`). */
export function extractMetro(lines) {
  const start = lines.findIndex(
    (l) =>
      /Bundling failed|Unable to resolve module|SyntaxError|TransformError|Error: .*\.(t|j)sx?\b|error: .*\.(t|j)sx?:/i.test(l) &&
      !/^\s*at /.test(l),
  );
  if (start < 0) return null;
  const out = [];
  for (let i = start; i < lines.length && out.length < 40; i++) {
    const l = lines[i];
    if (i > start && (/^> Task /.test(l) || /^FAILURE:/.test(l) || /^\* What went wrong/.test(l))) break;
    // Metro prints the same error a second time as "Error: …" with the code frame again.
    if (i > start + 1 && /^Error: /.test(l) && out.some((o) => / \| /.test(o))) break;
    if (/^\s+at .*\(.*node_modules/.test(l)) continue; // Metro's own stack frames
    if (/^(Starting Metro|Android Bundl|Writing bundle|Done writing|\s*$)/.test(l) && i > start) continue;
    out.push(l);
  }
  return out.length ? `JavaScript bundling failed (Metro):\n${cap(out, 40)}` : null;
}

/** Kotlin / Java compiler errors and Gradle's "What went wrong" block. */
export function extractGradle(lines) {
  const compiler = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^e: (file:\/\/\/)?\S+\.kts?:\d+/.test(l) || /^e: /.test(l)) compiler.push(l);
    else if (/\.java:\d+: error:/.test(l)) compiler.push(l, ...lines.slice(i + 1, i + 3));
    else if (/^(ERROR|error):\s/.test(l) && !/^error: (unknown|Unable)/i.test(l)) compiler.push(l);
    else if (/AAPT: error:|Android resource linking failed/.test(l)) compiler.push(l);
    else if (/^\[CXX\d+\]|: error: /.test(l) && /\.(c|cc|cpp|h):\d+/.test(l)) compiler.push(l);
  }
  const wrong = [];
  const at = lines.findIndex((l) => /^\* What went wrong:/.test(l));
  if (at >= 0) {
    for (let i = at + 1; i < lines.length; i++) {
      if (/^\* (Try|Exception is|Get more help):/.test(lines[i])) break;
      if (lines[i].trim()) wrong.push(lines[i]);
      if (wrong.length > 25) break;
    }
  }
  const parts = [];
  if (compiler.length) parts.push(`Compiler errors:\n${cap(dedupe(compiler), 30)}`);
  if (wrong.length) parts.push(`Gradle: ${cap(wrong, 25)}`);
  return parts.length ? parts.join('\n\n') : null;
}

/** `npm install` problems (ERESOLVE, missing versions, …). */
export function extractNpm(lines) {
  const out = lines.filter((l) => /npm (error|ERR!)/.test(l) && !/A complete log of this run/.test(l));
  return out.length ? `npm install failed:\n${cap(dedupe(out), 30)}` : null;
}

/** `expo prebuild` problems (config plugin errors, invalid app.json). */
export function extractPrebuild(lines) {
  const idx = lines.findIndex((l) => /Error|error|✖|Failed|failed/.test(l));
  const from = idx >= 0 ? idx : Math.max(0, lines.length - 30);
  const out = lines.slice(from).filter((l) => l.trim() && !/^\s+at /.test(l));
  return `expo prebuild failed (check app.json and config plugins):\n${cap(out, 30)}`;
}

export function tail(lines, n = 40) {
  return cap(lines.filter((l) => l.trim()).slice(-n), n);
}
