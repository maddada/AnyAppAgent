// Web apps go online in the person's own GitHub Pages (docs/WEB-APPS.md, decisions of 18 Nov
// 2026): after every successful build the PC pushes ONLY the built files to a public repo
// <login>/anyapp-<slug>-web, which GitHub Pages serves at https://<login>.github.io/anyapp-<slug>-web/.
// The app's code stays in its private repo. Nothing is pushed before the secrets scan passes, and
// a build never carries source maps (the builder drops them; this checks again).
//
// Hosts:
//   github (default when GitHub is on): the `gh` CLI the setup signed in. Creates only repos named
//     anyapp-<slug>-web, turns Pages on for them, pushes with a token that reaches git only through
//     the environment of one child process (git.ts gitWithToken), and deletes only them.
//   local (tests and the proof run): ANYAPP_WEB_HOST=local, ANYAPP_WEB_LOCAL_DIR (bare repos are
//     made there as <login>/anyapp-<slug>-web.git), ANYAPP_WEB_LOCAL_URL (where a stand-in for
//     GitHub Pages serves them, server/scripts/fake-pages.mjs), ANYAPP_WEB_LOCAL_LOGIN (default "you").
//   off: ANYAPP_WEB_HOST=off, or GitHub off: web apps build and open only from the PC.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { gitWithToken, run, type RunResult } from "./git.ts";
import { describeSecrets, findSecrets, type SecretHit } from "./secrets.ts";

export const WEB_REPO_PATTERN = /^anyapp-[a-z0-9-]+-web$/;

export interface WebSiteTarget {
  repo: string; // <login>/anyapp-<slug>-web
  repoUrl: string;
  address: string; // ends with "/"
}

export interface WebHost {
  kind: "github" | "local";
  /** The site for an app's slug: makes the repo when it does not exist yet. */
  ensure(slug: string): Promise<WebSiteTarget>;
  /** Pushes the work folder's HEAD to the site's main branch (and turns Pages on after the first push). */
  push(workDir: string, site: WebSiteTarget): Promise<void>;
  /** Deletes the site's repo (an app deleted for good). */
  remove(site: Pick<WebSiteTarget, "repo">): Promise<void>;
}

export class WebPublishRefused extends Error {}

function lastLine(result: RunResult | { err: string; code: number }): string {
  const text = ("err" in result ? result.err : result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean);
  return text.at(-1) ?? `exit code ${result.code}`;
}

function siteName(slug: string): string {
  const name = `anyapp-${slug}-web`;
  if (!WEB_REPO_PATTERN.test(name)) throw new Error(`Refusing to touch the repository ${name}`);
  return name;
}

function checkRepo(full: string): void {
  const [, name] = full.split("/");
  if (!name || !WEB_REPO_PATTERN.test(name)) throw new Error(`Refusing to touch the repository ${full}`);
}

// ---------- GitHub Pages

export function githubHost(gh: (args: string[], timeoutMs?: number) => Promise<RunResult> = (args, timeoutMs = 60_000) => run("gh", args, tmpdir(), timeoutMs)): WebHost {
  let login: string | undefined;
  const whoAmI = async (): Promise<string> => {
    if (login) return login;
    const result = await gh(["api", "user", "-q", ".login"]);
    const found = result.stdout.trim();
    if (result.code !== 0 || !found) throw new Error("GitHub is not signed in on this PC. Sign in again in the setup steps.");
    login = found;
    return found;
  };
  return {
    kind: "github",
    async ensure(slug) {
      const owner = await whoAmI();
      const repo = `${owner}/${siteName(slug)}`;
      const view = await gh(["repo", "view", repo, "--json", "visibility", "-q", ".visibility"]);
      if (view.code !== 0) {
        if (!/Could not resolve|not found|404/i.test(view.stderr)) throw new Error(lastLine(view));
        const created = await gh(["repo", "create", repo, "--public", "--description", "A web app made with Kiwimake: only its built files (the code is private)."]);
        if (created.code !== 0) throw new Error(lastLine(created));
      } else if (view.stdout.trim() !== "PUBLIC") {
        throw new Error(`The repository ${repo} is not public, so GitHub Pages cannot serve it for free.`);
      }
      return { repo, repoUrl: `https://github.com/${repo}`, address: `https://${owner.toLowerCase()}.github.io/${siteName(slug)}/` };
    },
    async push(workDir, site) {
      checkRepo(site.repo);
      const token = (await gh(["auth", "token"])).stdout.trim();
      if (!token) throw new Error("GitHub is not signed in on this PC. Sign in again in the setup steps.");
      const pushed = await gitWithToken(["push", "-q", "--force", `https://github.com/${site.repo}.git`, "HEAD:main"], workDir, token);
      if (pushed.code !== 0) throw new Error(lastLine(pushed));
      // Pages from main, the root. 409: it is on already.
      const pages = await gh(["api", "-X", "POST", `repos/${site.repo}/pages`, "-f", "source[branch]=main", "-f", "source[path]=/"]);
      if (pages.code !== 0 && !/409|already/i.test(`${pages.stderr}${pages.stdout}`)) throw new Error(`GitHub Pages could not be turned on: ${lastLine(pages)}`);
    },
    async remove(site) {
      checkRepo(site.repo);
      const result = await gh(["repo", "delete", site.repo, "--yes"]);
      if (result.code === 0) return;
      const text = `${result.stderr}\n${result.stdout}`;
      if (/delete_repo/i.test(text)) throw new Error("GitHub needs one more permission to delete repositories (run: gh auth refresh -s delete_repo)");
      if (/not found|Could not resolve|404/i.test(text)) return;
      throw new Error(lastLine(result));
    },
  };
}

// ---------- the local stand-in (tests, the proof run)

export function localHost(dir: string, baseUrl: string, login = "you"): WebHost {
  const base = baseUrl.replace(/\/+$/, "");
  const bare = (repo: string) => join(dir, `${repo}.git`);
  return {
    kind: "local",
    async ensure(slug) {
      const repo = `${login}/${siteName(slug)}`;
      if (!existsSync(bare(repo))) {
        mkdirSync(bare(repo), { recursive: true });
        const made = await run("git", ["init", "-q", "--bare", "-b", "main", bare(repo)], dir);
        if (made.code !== 0) throw new Error(lastLine(made));
      }
      return { repo, repoUrl: `file://${bare(repo)}`, address: `${base}/${siteName(slug)}/` };
    },
    async push(workDir, site) {
      checkRepo(site.repo);
      const pushed = await run("git", ["push", "-q", "--force", bare(site.repo), "HEAD:main"], workDir);
      if (pushed.code !== 0) throw new Error(lastLine(pushed));
    },
    async remove(site) {
      checkRepo(site.repo);
      rmSync(bare(site.repo), { recursive: true, force: true });
    },
  };
}

/** The host this PC uses, from the environment; null: web apps are not put online. */
export function webHostFromEnv(env: NodeJS.ProcessEnv, githubOn: boolean): WebHost | null {
  const choice = (env.ANYAPP_WEB_HOST ?? "github").toLowerCase();
  if (choice === "local") {
    const dir = env.ANYAPP_WEB_LOCAL_DIR;
    const url = env.ANYAPP_WEB_LOCAL_URL;
    if (!dir || !url) throw new Error("ANYAPP_WEB_HOST=local needs ANYAPP_WEB_LOCAL_DIR and ANYAPP_WEB_LOCAL_URL");
    return localHost(dir, url, env.ANYAPP_WEB_LOCAL_LOGIN || "you");
  }
  if (choice === "github" && githubOn) return githubHost();
  return null;
}

// ---------- the built files

export interface WebFile {
  path: string; // "/" separators, relative to the site's root
  size: number;
}

/** Every file under dir (relative, "/" separators), sorted. */
export function listFiles(dir: string): WebFile[] {
  const out: WebFile[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push({ path: relative(dir, full).split(sep).join("/"), size: statSync(full).size });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** What must never go online: secrets in any file, and source maps (a second line of defence). */
export function checkSite(dir: string): { hits: SecretHit[]; maps: string[] } {
  const hits: SecretHit[] = [];
  const maps: string[] = [];
  for (const file of listFiles(dir)) {
    if (file.path.endsWith(".map")) maps.push(file.path);
    const text = readFileSync(join(dir, file.path)).toString("latin1");
    if (/\/[/*][#@] sourceMappingURL=/.test(text) && /\.(m?js|css)$/.test(file.path)) maps.push(file.path);
    hits.push(...findSecrets(text, file.path));
    if (hits.length >= 20) break;
  }
  return { hits, maps };
}

// ---------- publishing

export interface PublishArgs {
  appId: string;
  slug: string;
  distDir: string;
  build: number;
  changed?: string; // the version's What changed line, for the app's "Version N is ready" notice
  site?: WebSiteTarget; // the app's site when it has one (a renamed app keeps its address)
}

export class WebPublisher {
  private readonly stateDir: string;
  readonly host: WebHost | null;
  private readonly fetchImpl: typeof fetch;
  private readonly secret: Buffer;

  constructor(opts: { stateDir: string; host: WebHost | null; fetch?: typeof fetch }) {
    this.stateDir = opts.stateDir;
    this.host = opts.host;
    this.fetchImpl = opts.fetch ?? fetch;
    const secretPath = join(this.stateDir, "web", "ticket-secret");
    if (!existsSync(secretPath)) {
      mkdirSync(join(this.stateDir, "web"), { recursive: true });
      writeFileSync(secretPath, randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    this.secret = Buffer.from(readFileSync(secretPath, "utf8").trim(), "hex");
  }

  /** The folder the site's repo is kept in on this PC (its history is the versions that went online). */
  private workDir(appId: string): string {
    return join(this.stateDir, "web", appId, "site");
  }

  /**
   * Puts one build online: checks it, makes the site the first time, replaces the site's files with
   * the build's, commits ("Version N") and pushes. Throws WebPublishRefused (a plain sentence) when
   * a file holds what looks like a secret or a source map.
   */
  async publish(args: PublishArgs): Promise<WebSiteTarget> {
    if (!this.host) throw new Error("This PC does not put web apps online.");
    const { hits, maps } = checkSite(args.distDir);
    if (hits.length > 0) throw new WebPublishRefused(describeSecrets(hits, "published"));
    if (maps.length > 0) throw new WebPublishRefused(`Not published: the build still has source maps (${maps.slice(0, 3).join(", ")}). Build it again.`);
    const site = args.site ?? (await this.host.ensure(args.slug));
    const work = this.workDir(args.appId);
    if (!existsSync(join(work, ".git"))) {
      mkdirSync(work, { recursive: true });
      const made = await run("git", ["init", "-q", "-b", "main"], work);
      if (made.code !== 0) throw new Error(lastLine(made));
    }
    for (const entry of readdirSync(work)) if (entry !== ".git") rmSync(join(work, entry), { recursive: true, force: true });
    cpSync(args.distDir, work, { recursive: true });
    writeFileSync(join(work, "version.json"), `${JSON.stringify({ build: args.build, ...(args.changed ? { changed: args.changed } : {}) })}\n`);
    writeFileSync(join(work, ".nojekyll"), "");
    const who = ["-c", "user.name=Kiwimake", "-c", "user.email=anyappagent@localhost", "-c", "commit.gpgsign=false"];
    const added = await run("git", ["add", "-A"], work);
    if (added.code !== 0) throw new Error(lastLine(added));
    const committed = await run("git", [...who, "commit", "-q", "--allow-empty", "-m", `Version ${args.build}`], work);
    if (committed.code !== 0) throw new Error(lastLine(committed));
    await this.host.push(work, site);
    return site;
  }

  /** Waits until the site serves this build (GitHub Pages takes about a minute). */
  async waitLive(address: string, build: number, opts: { timeoutMs?: number; everyMs?: number; cancelled?: () => boolean } = {}): Promise<boolean> {
    const until = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
    while (Date.now() < until && !opts.cancelled?.()) {
      try {
        const res = await this.fetchImpl(`${address}version.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          const body = (await res.json()) as { build?: unknown };
          if (typeof body.build === "number" && body.build >= build) return true;
        }
      } catch {
        // not there yet
      }
      await new Promise((resolve) => setTimeout(resolve, opts.everyMs ?? 5_000));
    }
    return false;
  }

  /** Forgets the site's local copy (the app was deleted for good). */
  forget(appId: string): void {
    rmSync(join(this.stateDir, "web", appId), { recursive: true, force: true });
  }

  // ---------- opening the newest build from this PC (POST /api/apps/:id/web/open)

  ticket(appId: string, ttlMs = 24 * 60 * 60_000): { ticket: string; expiresAt: string } {
    const expires = Math.floor((Date.now() + ttlMs) / 1000).toString(36);
    return { ticket: `${expires}.${this.sign(appId, expires)}`, expiresAt: new Date(parseInt(expires, 36) * 1000).toISOString() };
  }

  checkTicket(appId: string, ticket: string): boolean {
    const m = /^([0-9a-z]+)\.([A-Za-z0-9_-]{32})$/.exec(ticket);
    if (!m) return false;
    if (parseInt(m[1]!, 36) * 1000 < Date.now()) return false;
    const want = Buffer.from(this.sign(appId, m[1]!));
    const got = Buffer.from(m[2]!);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private sign(appId: string, expires: string): string {
    return createHmac("sha256", this.secret).update(`web.${appId}.${expires}`).digest("base64url").slice(0, 32);
  }
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
};

export function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
}
