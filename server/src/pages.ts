// Pages in the chat, copied from Ghostex pages (C:\dev\Ghostex server/src/visual_pages): an app's
// agent (or a helper) writes one self-contained HTML file and publishes it with the show_page tool;
// the companion keeps it under <state>/pages/<appId>/ and the app's main chat shows a card. The
// phone and the PC ask for a signed ticket (POST /api/apps/:id/pages/:pageId/open) and load the page
// from /page/<pageId>/<ticket>, sandboxed. The page kit Ghostex injects (theme, page API, question
// kit, fit rules: src/pages/kit/, ported by scripts/port-page-kit.mjs) is put into the page when it
// is served, so stored pages always get today's kit. Answers come back through the page's own
// /answers route and reach the agent as one message (shared/chat/pages.ts pageAnswersMessage).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { PageInfo, PageOpenResponse } from "../../shared/protocol.ts";
import { helperPageNote, pageAnswersMessage } from "../../shared/chat/pages.ts";
import { REPO_DIR, SERVER_DIR } from "./config.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";

export const PAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const ANSWERS_MAX_BYTES = 64 * 1024;
const TICKET_DAYS = 1;
const STATE_MARKER = "<!--gx-page-state-->";
/** The MCP server name the page tools live under (tools show as mcp__pages__*). */
export const PAGE_TOOLS_SERVER = "pages";

const KIT_DIR = join(SERVER_DIR, "src", "pages", "kit");
const FONTS_DIR = join(REPO_DIR, "shared", "theme", "fonts");

let builtinBlock: string | undefined;
/** The block Ghostex puts at the start of every page's <head>, with Kiwimake's theme. */
function builtin(): string {
  if (builtinBlock) return builtinBlock;
  const read = (name: string) => readFileSync(join(KIT_DIR, name), "utf8").trim();
  builtinBlock = [
    "<!--anyapp-builtin-->",
    read("theme.html"),
    read("page-api.html"),
    STATE_MARKER,
    read("kit-style.html"),
    read("kit-script.html"),
    read("fit-style.html"),
    read("fit-script.html"),
    read("workbench.html"),
    "<!--/anyapp-builtin-->",
  ].join("");
  return builtinBlock;
}

interface PageRecord extends PageInfo {
  /** The chat item the card is (upserted when it is answered). */
  itemId: string;
  answers?: unknown;
  draft?: unknown;
  draftEditedAt?: number;
  /** Where it was published from, for the agent's own reference. */
  sourcePath?: string;
}

export class PageError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- reading a page the way the kit does

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : undefined;
}

/** The page's own <title>. */
export function pageTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  return title || undefined;
}

/** The titles of the page's <gx-question> elements, in order (empty for a page that asks nothing). */
export function pageQuestions(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<gx-question\b[^>]*>/gi)) {
    const tag = m[0];
    out.push(attr(tag, "title") ?? attr(tag, "name") ?? attr(tag, "tag") ?? `Question ${out.length + 1}`);
  }
  return out;
}

/** A page that asks nothing and has no answer of its own ends with "Mark as seen" (Ghostex's awaitsSeen). */
export function pageAwaitsSeen(html: string): boolean {
  return !/<gx-questions\b/i.test(html) && !/\b(?:ghostex|anyapp)\.submit\s*\(/.test(html);
}

// ---------- local images become data URIs (Ghostex prepare.rs, simplified)

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

function sniffImage(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (bytes.subarray(0, 2).toString("latin1") === "BM") return "image/bmp";
  const head = bytes.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return undefined;
}

function isLocalReference(ref: string): boolean {
  if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(ref) && !/^[a-z]:[\\/]/i.test(ref) && !/^file:/i.test(ref)) return false; // http:, data:, ...
  if (ref.startsWith("#") || ref.startsWith("//") || ref === "") return false;
  return Boolean(IMAGE_MIME[extname(ref.split(/[?#]/)[0]).toLowerCase()]);
}

function localPath(ref: string, baseDir: string | undefined): string | undefined {
  let path = ref.split(/[?#]/)[0];
  if (/^file:/i.test(path)) path = decodeURIComponent(path.replace(/^file:\/*/i, process.platform === "win32" ? "" : "/"));
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep as written */
  }
  if (isAbsolute(path) || /^[a-z]:[\\/]/i.test(path)) return path;
  return baseDir ? resolve(baseDir, path) : undefined;
}

/** Inlines every local image the page points at; names the ones that are missing or not images. */
export function inlineLocalImages(html: string, baseDir: string | undefined): { html: string; problems: string[] } {
  const problems: string[] = [];
  const cache = new Map<string, string | null>();
  const dataUri = (ref: string): string | null => {
    if (cache.has(ref)) return cache.get(ref)!;
    let out: string | null = null;
    const path = localPath(ref, baseDir);
    try {
      if (!path) throw new Error("a relative path, but the page has no folder");
      const size = statSync(path).size;
      if (size > IMAGE_MAX_BYTES) throw new Error("larger than 10 MB");
      const bytes = readFileSync(path);
      const mime = sniffImage(bytes);
      if (!mime) throw new Error("not an image");
      out = `data:${mime};base64,${bytes.toString("base64")}`;
    } catch (error) {
      problems.push(`${ref}: ${(error as NodeJS.ErrnoException).code === "ENOENT" ? "not found" : (error as Error).message}`);
    }
    cache.set(ref, out);
    return out;
  };
  // src="...", poster="...", href="..." on <link rel=icon> and <image>, srcset="a.png 1x, b.png 2x"
  let out = html.replace(/(\s(?:src|poster|href|xlink:href)\s*=\s*)(["'])([^"']+)\2/gi, (whole, before: string, q: string, ref: string) => {
    if (!isLocalReference(ref)) return whole;
    const uri = dataUri(ref);
    return uri ? `${before}${q}${uri}${q}` : whole;
  });
  out = out.replace(/(\ssrcset\s*=\s*)(["'])([^"']+)\2/gi, (whole, before: string, q: string, list: string) => {
    const parts = list.split(",").map((part) => {
      const [ref, ...rest] = part.trim().split(/\s+/);
      if (!ref || !isLocalReference(ref)) return part.trim();
      const uri = dataUri(ref);
      return uri ? [uri, ...rest].join(" ") : part.trim();
    });
    return `${before}${q}${parts.join(", ")}${q}`;
  });
  out = out.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, q: string, ref: string) => {
    if (!isLocalReference(ref.trim())) return whole;
    const uri = dataUri(ref.trim());
    return uri ? `url(${q}${uri}${q})` : whole;
  });
  return { html: out, problems };
}

/** The page with the kit at the start of its <head> (after the doctype, never before it). */
export function withKit(html: string, state: unknown): string {
  const stateScript = `<script>window.ghostex&&ghostex.__state(${JSON.stringify(state).replace(/</g, "\\u003c")});</script>`;
  const block = builtin().replace(STATE_MARKER, stateScript);
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + block + html.slice(head.index + head[0].length);
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + `<head>${block}</head>` + html.slice(htmlTag.index + htmlTag[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return `${html.slice(0, at)}<head>${block}</head>${html.slice(at)}`;
}

/** The page's content policy, as Ghostex serves it, naming this page's own routes on this host. */
export function pagePolicy(host: string | undefined, base: string): string {
  const safeHost = host && /^[a-zA-Z0-9.\-:[\]]+$/.test(host) ? host : undefined;
  const own = safeHost ? ` http://${safeHost}${base}/` : "";
  const kit = safeHost ? ` http://${safeHost}/page-kit/` : "";
  return [
    "sandbox allow-scripts allow-forms allow-popups",
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'unsafe-inline' https:",
    `img-src data: blob: https:${own}`,
    `font-src data: https:${kit}`,
    `connect-src https:${own}`,
    "media-src data: blob: https:",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

// ---------- the store

export interface PagesHost {
  stateDir: string;
  log(...parts: unknown[]): void;
  /** Shows or updates the page's card in the app's main chat. */
  showCard(appId: string, itemId: string, page: PageInfo): void;
  /** Sends the page's answers to the app's main chat as the person's message. */
  deliver(appId: string, text: string): void;
  appExists(appId: string): boolean;
}

export class Pages {
  /** The bearer secret of the page tool endpoint (a new one each run; only Claude Code gets it). */
  readonly toolsToken = randomBytes(24).toString("hex");
  private readonly host: PagesHost;
  private readonly dir: string;
  private readonly secret: Buffer;
  /** pageId -> appId, for /page/<id>/... */
  private readonly owners = new Map<string, string>();

  constructor(host: PagesHost) {
    this.host = host;
    this.dir = join(host.stateDir, "pages");
    mkdirSync(this.dir, { recursive: true });
    const secretPath = join(this.dir, "ticket-secret");
    if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString("hex"), { mode: 0o600 });
    this.secret = Buffer.from(readFileSync(secretPath, "utf8").trim(), "hex");
    for (const appId of readdirSync(this.dir)) {
      const appDir = join(this.dir, appId);
      if (!statSync(appDir).isDirectory()) continue;
      for (const file of readdirSync(appDir)) if (/^[0-9a-f]{32}\.json$/.test(file)) this.owners.set(file.slice(0, 32), appId);
    }
  }

  private recordPath(appId: string, id: string): string {
    return join(this.dir, appId, `${id}.json`);
  }

  private htmlPath(appId: string, id: string): string {
    return join(this.dir, appId, `${id}.html`);
  }

  /** Where an app's agents write their page files (outside the app's repository). */
  draftsDir(appId: string): string {
    // The cloud: the agent is another Unix user and cannot write in our state folder, so its page
    // files go in a folder it shares with us (ANYAPP_PAGE_DRAFTS_DIR, set by the cloud runner).
    const root = process.env.ANYAPP_PAGE_DRAFTS_DIR;
    const dir = root ? join(root, appId) : join(this.dir, appId, "files");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private read(appId: string, id: string): PageRecord | undefined {
    if (!/^[0-9a-f]{32}$/.test(id)) return undefined;
    return readJson<PageRecord | undefined>(this.recordPath(appId, id), undefined);
  }

  private write(record: PageRecord): void {
    writeJsonAtomic(this.recordPath(record.appId, record.id), record);
  }

  private info(record: PageRecord): PageInfo {
    const { itemId: _i, answers: _a, draft: _d, draftEditedAt: _e, sourcePath: _s, ...info } = record;
    return info;
  }

  list(appId: string): PageInfo[] {
    const dir = join(this.dir, appId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /^[0-9a-f]{32}\.json$/.test(f))
      .map((f) => this.read(appId, f.slice(0, 32)))
      .filter((r): r is PageRecord => Boolean(r))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => this.info(r));
  }

  /** Publishes a page into the app's main chat. `path` is an HTML file; `html` the page itself. */
  publish(args: { appId: string; path?: string; html?: string; title?: string; from?: { workerId: string; title: string } }): { page: PageInfo; notes: string[] } {
    let source = args.html;
    let baseDir: string | undefined;
    if (args.path) {
      const path = resolve(args.path);
      if (!existsSync(path)) throw new PageError(400, `There is no file at ${path}.`);
      if (statSync(path).size > PAGE_MAX_BYTES) throw new PageError(400, "The page is larger than 8 MB.");
      source = readFileSync(path, "utf8");
      baseDir = dirname(path);
    }
    if (!source || source.trim() === "") throw new PageError(400, "Give the page: a path to an HTML file (preferred) or its html.");
    if (source.includes("\u2014")) {
      throw new PageError(400, "The page has an em dash (U+2014). The person never wants one: use a comma, a colon, a full stop or brackets, then publish again.");
    }
    const title = (args.title?.trim() || pageTitle(source) || "").slice(0, 200);
    if (!title) throw new PageError(400, "Give the page a short, specific <title> (what it shows or asks), then publish again.");
    if (title.includes("\u2014")) throw new PageError(400, "The title has an em dash (U+2014): use a comma or a colon.");
    const { html, problems } = inlineLocalImages(source, baseDir);
    if (problems.length > 0) throw new PageError(400, `Some pictures the page points at could not be used: ${problems.join("; ")}. Fix those paths (absolute, or relative to the HTML file), then publish again.`);
    if (Buffer.byteLength(html) > PAGE_MAX_BYTES) throw new PageError(400, "The page with its pictures is larger than 8 MB. Use smaller pictures.");
    const id = randomBytes(16).toString("hex");
    const questions = pageQuestions(html);
    const record: PageRecord = {
      id,
      appId: args.appId,
      title,
      ...(questions.length > 0 ? { questions } : {}),
      ...(questions.length === 0 && pageAwaitsSeen(html) ? { awaitsSeen: true } : {}),
      ...(args.from ? { from: args.from } : {}),
      createdAt: nowIso(),
      itemId: `page-${id}`,
      ...(args.path ? { sourcePath: resolve(args.path) } : {}),
    };
    mkdirSync(join(this.dir, args.appId), { recursive: true });
    writeFileSync(this.htmlPath(args.appId, id), html);
    this.write(record);
    this.owners.set(id, args.appId);
    const page = this.info(record);
    this.host.showCard(args.appId, record.itemId, page);
    this.host.log(`page ${id} "${title}" published${args.from ? ` by helper ${args.from.workerId}` : ""} (${questions.length} questions)`);
    const notes: string[] = [];
    if (/<gx-questions\b/i.test(html) && questions.length === 0) notes.push("The page has <gx-questions> but no <gx-question> inside it, so it asks nothing.");
    if (!/name=["']viewport["']/i.test(html)) notes.push("The page has no viewport meta tag; it may read badly on the phone.");
    return { page, notes };
  }

  /**
   * The cloud: the page as the phone gets it (the kit added, its state left for Convex to fill in:
   * `ghostex.__state(null)`), to upload when it is published. Null when it is gone.
   */
  servedHtml(appId: string, pageId: string): { html: string; page: PageInfo } | null {
    const record = this.read(appId, pageId);
    if (!record || !existsSync(this.htmlPath(appId, pageId))) return null;
    return { html: withKit(readFileSync(this.htmlPath(appId, pageId), "utf8"), null), page: this.info(record) };
  }

  /** The cloud: answers given on the page as Convex served it, applied as if posted here. */
  answerFromCloud(appId: string, pageId: string, answers: unknown): { ok: boolean; error?: string } {
    const record = this.read(appId, pageId);
    if (!record) return { ok: false, error: "No such page." };
    if (record.answeredAt) return { ok: false, error: "These answers were already sent." };
    record.answers = answers;
    record.answeredAt = nowIso();
    if (answers && typeof answers === "object" && (answers as { seen?: unknown }).seen === true) record.seen = true;
    delete record.draft;
    delete record.draftEditedAt;
    this.write(record);
    this.host.showCard(record.appId, record.itemId, this.info(record));
    let text = pageAnswersMessage(record.id, record.title, answers);
    if (record.from) text += `\n\n${helperPageNote(record.from)}`;
    this.host.deliver(record.appId, text);
    this.host.log(`page ${record.id} "${record.title}" answered (cloud)`);
    return { ok: true };
  }

  /** A signed ticket that opens the page for a day. */
  open(appId: string, pageId: string): PageOpenResponse {
    if (!this.read(appId, pageId)) throw new PageError(404, "That page is not on this PC any more.");
    const expires = Math.floor(Date.now() / 1000) + TICKET_DAYS * 86400;
    return { path: `/page/${pageId}/${expires.toString(36)}.${this.sign(pageId, expires)}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  private sign(pageId: string, expires: number): string {
    return createHmac("sha256", this.secret).update(`${pageId}.${expires}`).digest("base64url").slice(0, 32);
  }

  private checkTicket(pageId: string, ticket: string): boolean {
    const m = /^([0-9a-z]+)\.([A-Za-z0-9_-]{32})$/.exec(ticket);
    if (!m) return false;
    const expires = parseInt(m[1], 36);
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    const want = Buffer.from(this.sign(pageId, expires));
    const got = Buffer.from(m[2]);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  // ---------- the page's own routes (no Bearer token: the ticket is the grant)

  /** Handles /page/<id>/<ticket>[/answers|/draft|/image|/notice|/scroll] and /page-kit/fonts/*. False when not ours. */
  async route(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
    const method = req.method ?? "GET";
    const font = /^\/page-kit\/fonts\/([A-Za-z0-9-]+\.ttf)$/.exec(path);
    if (font && (method === "GET" || method === "HEAD")) {
      const file = join(FONTS_DIR, font[1]);
      if (!existsSync(file)) return send(res, 404, { ok: false, error: "No such font." }), true;
      const data = readFileSync(file);
      res.writeHead(200, { "Content-Type": "font/ttf", "Content-Length": data.length, "Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*" });
      res.end(method === "HEAD" ? undefined : data);
      return true;
    }
    const m = /^\/page\/([0-9a-f]{32})\/([^/]+)(?:\/(answers|draft|image|notice|scroll))?$/.exec(path);
    if (!m) return false;
    const [, id, ticket, action] = m;
    const appId = this.owners.get(id);
    const record = appId ? this.read(appId, id) : undefined;
    if (!appId || !record || !this.host.appExists(appId) || !this.checkTicket(id, ticket)) {
      if (!action) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><p style='font:16px system-ui;padding:24px'>This page is not here any more, or its link is too old. Open it again from the chat.</p>");
      } else send(res, 404, { ok: false, error: "No such page." });
      return true;
    }
    const base = `/page/${id}/${ticket}`;
    if (!action && (method === "GET" || method === "HEAD")) {
      const stored = readFileSync(this.htmlPath(appId, id), "utf8");
      const state = record.answeredAt
        ? { answered: true, answeredAt: record.answeredAt, answers: record.answers ?? null, ...(record.awaitsSeen ? { awaitsSeen: true } : {}) }
        : { answered: false, draft: record.draft ?? null, draftEditedAt: record.draftEditedAt ?? null, ...(record.awaitsSeen ? { awaitsSeen: true } : {}) };
      const body = Buffer.from(withKit(stored, state));
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
        "Content-Security-Policy": pagePolicy(req.headers.host, base),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      });
      res.end(method === "HEAD" ? undefined : body);
      return true;
    }
    if (action === "answers" && method === "POST") return this.answers(req, res, record), true;
    if (action === "draft" && method === "GET") {
      return send(res, 200, record.answeredAt ? { ok: true, answered: true, draft: null, editedAt: null } : { ok: true, answered: false, draft: record.draft ?? null, editedAt: record.draftEditedAt ?? null }), true;
    }
    if (action === "draft" && method === "POST") {
      const body = await readJsonBody(req, ANSWERS_MAX_BYTES);
      if (!body || typeof body !== "object" || !("draft" in body)) return send(res, 400, { ok: false, error: 'Send {"draft": ...} as JSON.' }), true;
      if (record.answeredAt) return send(res, 409, { ok: false, error: "These answers were already sent.", answeredAt: record.answeredAt }), true;
      const sent = (body as { editedAt?: unknown }).editedAt;
      const editedAt = typeof sent === "number" ? sent : Date.now();
      const kept = !(record.draftEditedAt && record.draftEditedAt > editedAt);
      if (kept) {
        record.draft = (body as { draft: unknown }).draft;
        record.draftEditedAt = editedAt;
        this.write(record);
      }
      return send(res, 200, { ok: true, kept }), true;
    }
    if (action === "image" && method === "POST") return this.saveImage(req, res, record), true;
    if (action === "image" && method === "GET") {
      const wanted = url.searchParams.get("path") ?? "";
      const dir = this.imagesDir(record);
      const file = normalize(resolve(wanted));
      if (!file.startsWith(dir + sep) || !existsSync(file)) return send(res, 404, { ok: false, error: "No such image on this page." }), true;
      const data = readFileSync(file);
      res.writeHead(200, { "Content-Type": sniffImage(data) ?? "application/octet-stream", "Content-Length": data.length, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
      res.end(data);
      return true;
    }
    if ((action === "notice" || action === "scroll") && method === "POST") {
      for await (const _ of req) void _;
      return send(res, 200, { ok: true }), true;
    }
    send(res, 405, { ok: false, error: "Method not allowed." });
    return true;
  }

  private imagesDir(record: PageRecord): string {
    return resolve(join(this.dir, record.appId, `${record.id}-images`));
  }

  private async saveImage(req: IncomingMessage, res: ServerResponse, record: PageRecord): Promise<void> {
    if (record.answeredAt) return send(res, 409, { ok: false, error: "These answers were already sent." });
    let bytes: Buffer;
    try {
      bytes = await readRaw(req, IMAGE_MAX_BYTES);
    } catch {
      return send(res, 413, { ok: false, error: "The image is larger than 10 MB. Try a smaller one." });
    }
    const mime = sniffImage(bytes);
    if (!mime || mime === "image/svg+xml") return send(res, 400, { ok: false, error: "Only PNG, JPEG, GIF, WebP and BMP images can be pasted here." });
    const dir = this.imagesDir(record);
    mkdirSync(dir, { recursive: true });
    const ext = Object.entries(IMAGE_MIME).find(([, m]) => m === mime)?.[0] ?? ".png";
    const file = join(dir, `${Date.now()}-${randomBytes(3).toString("hex")}${ext}`);
    writeFileSync(file, bytes);
    send(res, 200, { ok: true, path: file });
  }

  private async answers(req: IncomingMessage, res: ServerResponse, record: PageRecord): Promise<void> {
    let body: unknown;
    try {
      body = await readJsonBody(req, ANSWERS_MAX_BYTES);
    } catch (error) {
      return send(res, (error as PageError).status ?? 400, { ok: false, error: (error as Error).message });
    }
    if (!body || typeof body !== "object" || !("answers" in body)) return send(res, 400, { ok: false, error: 'Send {"answers": ...} as JSON.' });
    if (record.answeredAt) return send(res, 409, { ok: false, error: "These answers were already sent.", answeredAt: record.answeredAt });
    if (!this.host.appExists(record.appId)) return send(res, 404, { ok: false, error: "No such page." });
    const answers = (body as { answers: unknown }).answers;
    record.answers = answers;
    record.answeredAt = nowIso();
    if (answers && typeof answers === "object" && (answers as { seen?: unknown }).seen === true) record.seen = true;
    delete record.draft;
    delete record.draftEditedAt;
    this.write(record);
    this.host.showCard(record.appId, record.itemId, this.info(record));
    let text = pageAnswersMessage(record.id, record.title, answers);
    if (record.from) {
      text += `\n\n${helperPageNote(record.from)}`;
    }
    try {
      this.host.deliver(record.appId, text);
    } catch (error) {
      this.host.log(`page ${record.id}: answers saved but not delivered: ${(error as Error).message}`);
      return send(res, 200, { ok: true, answeredAt: record.answeredAt, delivered: false, error: `Saved, but the agent was not told: ${(error as Error).message}` });
    }
    this.host.log(`page ${record.id} "${record.title}" answered`);
    send(res, 200, { ok: true, answeredAt: record.answeredAt, delivered: true });
  }

  // ---------- the agent's tool: an MCP server at /mcp/pages/<appId>[/<workerId>]

  mcpServer(port: number, appId: string, from?: { workerId: string; title: string }): unknown {
    const query = from ? `?worker=${encodeURIComponent(from.workerId)}&title=${encodeURIComponent(from.title)}` : "";
    return {
      type: "http",
      name: PAGE_TOOLS_SERVER,
      url: `http://127.0.0.1:${port}/mcp/pages/${encodeURIComponent(appId)}${query}`,
      headers: [{ name: "Authorization", value: `Bearer ${this.toolsToken}` }],
    };
  }

  private tools(appId: string): object[] {
    return [
      {
        name: "show_page",
        description: `Publish a page into this app's chat: one self-contained HTML file (an explainer of a plan, a mockup, questions that need a picture). The person sees a card in the chat and opens it on the phone or the PC; answers given on the page come back to you as the person's next message, starting with <page-answers. Write the file in ${this.draftsDir(appId)} (outside the app, so it is never part of the app) from the page skeleton in your instructions, then call this. After it returns, end your turn: do not wait for the answers.`,
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path of the HTML file. Local pictures it points at (absolute, or relative to the file) are put into the page." },
            title: { type: "string", description: "Optional: overrides the page's <title>. A short, specific name, never generic." },
          },
          required: ["path"],
        },
      },
      {
        name: "list_pages",
        description: "The pages in this app's chat: id, title, and whether the person answered (with their answers).",
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }

  private callTool(appId: string, name: string, args: Record<string, unknown>, from?: { workerId: string; title: string }): string {
    if (name === "show_page") {
      const path = typeof args["path"] === "string" ? args["path"] : undefined;
      const html = typeof args["html"] === "string" ? args["html"] : undefined;
      const title = typeof args["title"] === "string" ? args["title"] : undefined;
      const { page, notes } = this.publish({ appId, ...(path ? { path } : {}), ...(html ? { html } : {}), ...(title ? { title } : {}), ...(from ? { from } : {}) });
      const asks = page.questions?.length
        ? `It asks ${page.questions.length} question(s): ${page.questions.map((q) => `"${q}"`).join(", ")}. The answers arrive as the person's next message.`
        : page.awaitsSeen
          ? "It asks nothing, so it ends with a reply box and Mark as seen; you get {\"seen\": true} (and their reply) when they press it."
          : "It sends its own answers (anyapp.submit).";
      return [`Page ${page.id} "${page.title}" is in the chat now. ${asks}`, ...notes.map((n) => `Note: ${n}`), "Now end your turn with one short line about the page; do not paste the HTML or a link."].join("\n");
    }
    if (name === "list_pages") {
      const list = this.list(appId);
      if (list.length === 0) return "There are no pages in this chat yet.";
      return list
        .map((p) => {
          const r = this.read(appId, p.id);
          return `${p.id} "${p.title}": ${p.answeredAt ? `answered ${p.answeredAt}: ${JSON.stringify(r?.answers ?? null)}` : (p.questions?.length ?? 0) > 0 ? "waiting for answers" : "not seen yet"}`;
        })
        .join("\n");
    }
    throw new Error(`Unknown tool ${name}`);
  }

  async mcpRoute(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
    const m = /^\/mcp\/pages\/([^/]+)$/.exec(path);
    if (!m) return false;
    const appId = decodeURIComponent(m[1]);
    const address = req.socket.remoteAddress ?? "";
    const loopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
    if (!loopback || req.headers.authorization !== `Bearer ${this.toolsToken}` || !this.host.appExists(appId)) return send(res, 401, { error: "Not allowed." }), true;
    if (req.method === "DELETE") return res.writeHead(204).end(), true;
    if (req.method !== "POST") return send(res, 405, { error: "This server sends no events." }), true;
    const workerId = url.searchParams.get("worker");
    const from = workerId ? { workerId, title: url.searchParams.get("title") ?? "Helper" } : undefined;
    const body = (await readJsonBody(req, 1024 * 1024)) as Rpc | Rpc[];
    const replies = (Array.isArray(body) ? body : [body]).map((message) => this.answerRpc(appId, message, from)).filter((r): r is object => r !== null);
    if (replies.length === 0) return res.writeHead(202).end(), true;
    send(res, 200, Array.isArray(body) ? replies : replies[0]);
    return true;
  }

  private answerRpc(appId: string, message: Rpc, from?: { workerId: string; title: string }): object | null {
    const { id, method } = message;
    if (id === undefined || id === null) return null;
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize": {
        const requested = typeof message.params?.["protocolVersion"] === "string" ? message.params["protocolVersion"] : "2025-06-18";
        return ok({ protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: { name: `anyappagent-${PAGE_TOOLS_SERVER}`, version: "1" } });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: this.tools(appId) });
      case "tools/call": {
        const name = String(message.params?.["name"] ?? "");
        const args = (message.params?.["arguments"] ?? {}) as Record<string, unknown>;
        try {
          return ok({ content: [{ type: "text", text: this.callTool(appId, name, args, from) }] });
        } catch (error) {
          return ok({ content: [{ type: "text", text: (error as Error).message }], isError: true });
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** True for an ACP tool call of the page tools: the page's card stands for it in the chat. */
export function isPageToolCall(update: Record<string, unknown>): boolean {
  const text = JSON.stringify([update["title"], update["name"], update["_meta"]]);
  return text.includes(`mcp__${PAGE_TOOLS_SERVER}__`);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  // The page has an opaque origin: it posts plain text (no preflight) and reads the reply through "*".
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
  res.end(data);
}

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new PageError(413, "The request is too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const raw = await readRaw(req, limit);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new PageError(400, "The request body is not valid JSON.");
  }
}
