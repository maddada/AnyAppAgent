// The PC link (docs/CLOUD.md section 3, "The PC link", cloud milestone 7): this PC acting for its
// owner's Kiwimake account in Convex, and nothing else. The companion keeps the link's token in
// its state folder (cloud-link.json) and never puts it in an agent's environment or a log. Made
// two ways: a signed-in phone hands it over through pairing (POST /api/account/link), or the
// desktop signs in through a browser page (a device code: start, the page, poll). A PC that
// signed in itself can hand its sign-in to its paired phone (a one-time code). Milestone 8 adds
// moves on top (call()).
import { join } from "node:path";
import type { AccountHandoff, AccountLinkInfo, AccountLinkRequest, PcLinkScope } from "../../shared/protocol.ts";
import { HttpError } from "./http-error.ts";
import { readJson, writeJsonAtomic } from "./fs-util.ts";
import { rmSync } from "node:fs";

type Saved = {
  token: string;
  site: string;
  deviceName: string;
  linkedFrom: "phone" | "pc";
  linkedFromName: string | null;
  account: { email: string | null; name: string | null; anonymous?: boolean };
  scopes: PcLinkScope[];
  linkedAt: string;
};

type Hello = {
  linkId: string;
  scopes: PcLinkScope[];
  deviceName: string;
  linkedFrom: "phone" | "pc";
  linkedFromName: string | null;
  account: { email: string | null; name: string | null; anonymous: boolean };
};

/** How often the link is checked while the companion runs (a link revoked on the phone goes). */
const CHECK_EVERY_MS = 30 * 60_000;
const POLL_EVERY_MS = 2_000;

/** A Convex site the phone may hand over: the configured one, or any https *.convex.site. */
export function allowedSite(site: string, configured?: string): boolean {
  if (configured && site.replace(/\/+$/, "") === configured.replace(/\/+$/, "")) return true;
  try {
    const u = new URL(site);
    return u.protocol === "https:" && /^[a-z0-9-]+\.convex\.site$/.test(u.hostname) && (u.pathname === "/" || u.pathname === "");
  } catch {
    return false;
  }
}

export class CloudLink {
  private readonly file: string;
  private saved: Saved | null;
  private signIn: { url: string; code: string; poll: string; expiresAt: number; site: string; timer?: NodeJS.Timeout } | null = null;
  private error: string | undefined;
  private checkTimer: NodeJS.Timeout | undefined;
  onChange: (info: AccountLinkInfo) => void = () => {};

  private readonly site: string | undefined;
  private readonly deviceName: () => string;
  private readonly log: (...parts: unknown[]) => void;
  private readonly fetch: typeof fetch;
  private readonly pollEveryMs: number;

  constructor(opts: { stateDir: string; site?: string; deviceName: () => string; log: (...parts: unknown[]) => void; fetch?: typeof fetch; pollEveryMs?: number }) {
    this.file = join(opts.stateDir, "cloud-link.json");
    this.site = opts.site?.replace(/\/+$/, "") || undefined;
    this.deviceName = opts.deviceName;
    this.log = opts.log;
    this.fetch = opts.fetch ?? fetch;
    this.pollEveryMs = opts.pollEveryMs ?? POLL_EVERY_MS;
    this.saved = readJson<Saved | null>(this.file, null);
    if (this.saved && (typeof this.saved.token !== "string" || !this.saved.token.startsWith("kpc_"))) this.saved = null;
  }

  /** Checks the saved link now and every half hour. */
  start(): void {
    void this.check();
    this.checkTimer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    this.checkTimer.unref?.();
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.signIn?.timer) clearTimeout(this.signIn.timer);
  }

  linked(): boolean {
    return this.saved !== null;
  }

  /** Where this PC can sign in in the browser: the configured site, else the one its phone uses. */
  signInSite(): string | undefined {
    return this.site ?? this.saved?.site;
  }

  info(): AccountLinkInfo {
    if (this.saved) {
      const s = this.saved;
      return {
        state: "linked",
        account: { email: s.account.email, name: s.account.name, ...(s.account.anonymous ? { test: true } : {}) },
        linkedFrom: s.linkedFrom,
        linkedFromName: s.linkedFromName,
        linkedAt: s.linkedAt,
        scopes: s.scopes,
        canHandOff: s.linkedFrom === "pc",
        ...(this.error ? { error: this.error } : {}),
      };
    }
    if (this.signIn) return { state: "signingIn", signIn: { url: this.signIn.url, code: this.signIn.code, expiresAt: new Date(this.signIn.expiresAt).toISOString() } };
    return { state: "none", ...(this.error ? { error: this.error } : {}) };
  }

  private changed(): void {
    this.onChange(this.info());
  }

  private async post<T>(site: string, path: string, body: unknown, token?: string): Promise<{ status: number; body: T }> {
    const res = await this.fetch(`${site}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
    const parsed = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body: parsed };
  }

  /** A call to Convex as this PC (milestone 8 on: moves). 401 means the link is gone. */
  async call<T>(path: string, body?: unknown): Promise<T> {
    const s = this.saved;
    if (!s) throw new HttpError(409, "This PC is not linked to a Kiwimake account.");
    const r = await this.post<T & { error?: string }>(s.site, path, body, s.token);
    if (r.status === 401) {
      this.forget("the link was removed");
      throw new HttpError(409, "This PC is not linked to a Kiwimake account any more.");
    }
    if (r.status >= 400) throw new HttpError(r.status === 403 || r.status === 409 ? r.status : 502, r.body.error ?? `The cloud said ${r.status}.`);
    return r.body;
  }

  private async hello(site: string, token: string): Promise<Hello | null> {
    const r = await this.post<Hello>(site, "/pc/hello", {}, token);
    if (r.status === 401) return null;
    if (r.status !== 200) throw new Error(`The cloud said ${r.status}.`);
    return r.body;
  }

  private save(site: string, token: string, h: Hello): void {
    this.saved = {
      token,
      site,
      deviceName: h.deviceName,
      linkedFrom: h.linkedFrom,
      linkedFromName: h.linkedFromName,
      account: h.account,
      scopes: h.scopes,
      linkedAt: new Date().toISOString(),
    };
    writeJsonAtomic(this.file, this.saved);
    this.error = undefined;
  }

  private forget(why: string): void {
    if (!this.saved) return;
    this.saved = null;
    rmSync(this.file, { force: true });
    this.log(`the PC link is gone (${why})`);
    this.changed();
  }

  /** Is the saved link still alive? Refreshes who it acts for; forgets it when Convex says no. */
  async check(): Promise<void> {
    const s = this.saved;
    if (!s) return;
    try {
      const h = await this.hello(s.site, s.token);
      if (!h) return this.forget("unlinked on the account");
      if (this.saved?.token !== s.token) return;
      this.saved = { ...s, deviceName: h.deviceName, linkedFromName: h.linkedFromName, account: h.account, scopes: h.scopes };
      writeJsonAtomic(this.file, this.saved);
      this.changed();
    } catch (error) {
      // Offline or the cloud is down: keep the link, try again later.
      this.log("could not check the PC link:", (error as Error).message);
    }
  }

  /** The phone hands this PC a link it made (accounts.createPcLink) through pairing. */
  async link(req: Partial<AccountLinkRequest>): Promise<AccountLinkInfo> {
    if (typeof req.token !== "string" || !req.token.startsWith("kpc_")) throw new HttpError(400, '"token" must be a PC link.');
    const site = typeof req.site === "string" ? req.site.replace(/\/+$/, "") : "";
    if (!allowedSite(site, this.site)) throw new HttpError(400, "That is not a Kiwimake cloud address.");
    const h = await this.hello(site, req.token).catch((error: Error) => {
      throw new HttpError(502, `Could not reach the cloud: ${error.message}`);
    });
    if (!h) throw new HttpError(400, "That link does not work. Try again from your phone.");
    const old = this.saved;
    this.cancel(false);
    this.save(site, req.token, h);
    // The phone's link replaces one this PC had (Convex already revoked a same-named twin).
    if (old && old.token !== req.token) void this.post(old.site, "/pc/unlink", {}, old.token).catch(() => {});
    this.log(`this PC is linked to a Kiwimake account (from ${h.linkedFromName ?? "a phone"})`);
    this.changed();
    return this.info();
  }

  /** The desktop's "Sign in in the browser": a device code, polled until the page approves it. */
  async startSignIn(): Promise<AccountLinkInfo> {
    const site = this.signInSite();
    if (!site) throw new HttpError(409, "This Kiwimake has no cloud address yet. Link it from your phone instead.");
    this.cancel(false);
    const r = await this.post<{ code: string; shown: string; poll: string; url: string; expiresInMs: number }>(site, "/pc/link/start", { deviceName: this.deviceName() }).catch((error: Error) => {
      throw new HttpError(502, `Could not reach the cloud: ${error.message}`);
    });
    if (r.status !== 200) throw new HttpError(502, `The cloud said ${r.status}.`);
    this.error = undefined;
    this.signIn = { url: r.body.url, code: r.body.shown, poll: r.body.poll, expiresAt: Date.now() + r.body.expiresInMs, site };
    const raw = r.body.code;
    const tick = async () => {
      const current = this.signIn;
      if (!current || current.poll !== r.body.poll) return;
      if (Date.now() > current.expiresAt) {
        this.signIn = null;
        this.error = "The sign-in ran out. Start it again.";
        return this.changed();
      }
      try {
        const p = await this.post<{ state: string; token?: string }>(site, "/pc/link/poll", { code: raw, poll: current.poll });
        if (this.signIn !== current) return;
        if (p.body.state === "linked" && p.body.token) {
          const h = await this.hello(site, p.body.token);
          if (!h) throw new Error("The new link did not work.");
          const old = this.saved;
          this.signIn = null;
          this.save(site, p.body.token, h);
          if (old && old.token !== p.body.token) void this.post(old.site, "/pc/unlink", {}, old.token).catch(() => {});
          this.log("this PC is linked to a Kiwimake account (signed in in the browser)");
          return this.changed();
        }
        if (p.status === 410) {
          this.signIn = null;
          this.error = "The sign-in ran out. Start it again.";
          return this.changed();
        }
      } catch (error) {
        this.log("PC link sign-in poll:", (error as Error).message);
      }
      current.timer = setTimeout(() => void tick(), this.pollEveryMs);
      current.timer.unref?.();
    };
    this.signIn.timer = setTimeout(() => void tick(), this.pollEveryMs);
    this.signIn.timer.unref?.();
    this.changed();
    return this.info();
  }

  cancel(notify = true): AccountLinkInfo {
    if (this.signIn?.timer) clearTimeout(this.signIn.timer);
    this.signIn = null;
    if (notify) this.changed();
    return this.info();
  }

  /** The PC hands its sign-in to its paired phone: a one-time code for the "pc-handoff" sign-in. */
  async handoff(): Promise<AccountHandoff> {
    const { code } = await this.call<{ code: string }>("/pc/handoff");
    return { code, site: this.saved!.site };
  }

  /** Unlink from the PC (or from the phone through pairing): revoked in Convex, then forgotten. */
  async unlink(): Promise<AccountLinkInfo> {
    const s = this.saved;
    this.cancel(false);
    if (s) {
      await this.post(s.site, "/pc/unlink", {}, s.token).catch((error: Error) => this.log("could not tell the cloud about the unlink:", error.message));
      this.forget("unlinked on this PC");
    } else this.changed();
    return this.info();
  }
}
