// Dev only: ANYAPP_DESKTOP_SHOTS=<folder> walks the real window through every onboarding step and
// the main window, in light and dark, and saves a PNG of each (webContents.capturePage).
// ANYAPP_DESKTOP_SHOTS_SET picks which set: "flow" (default) or "states" (the "needs you" variants,
// used together with ANYAPP_DESKTOP_SIMULATE), "real" (against the real companion) or "qr" (the
// screens with nothing secret on them, each QR popup, and a check that no pairing code is made or
// renewed while no popup is open).
import { nativeTheme, type BrowserWindow } from "electron";
import { openPageWindows } from "./page-window.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScreenshots(win: BrowserWindow, dir: string, log: (l: string) => void, hooks: { pairFakePhone?: () => Promise<void> } = {}): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const set = process.env.ANYAPP_DESKTOP_SHOTS_SET ?? "flow";
  const js = (code: string) => win.webContents.executeJavaScript(code, true);
  await new Promise<void>((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", () => r()) : r()));
  win.show();
  // Let checks and the companion settle.
  await wait(Number(process.env.ANYAPP_DESKTOP_SHOTS_SETTLE_MS ?? 9000));
  win.webContents.setBackgroundThrottling(false);
  const shot = async (name: string) => {
    await wait(700);
    // A window behind others can hand back its previous frame: repaint, drop one capture, take the next.
    win.webContents.invalidate();
    await win.webContents.capturePage();
    await wait(250);
    const image = await win.webContents.capturePage();
    writeFileSync(join(dir, `${name}.png`), image.toPNG());
    log(`[shots] ${name}`);
  };
  const steps = ["welcome", "claude", "tools", "github", "phone-get", "phone-pair", "done"];
  if (set === "qr") return qrSet(win, js, shot, log).catch((e) => log(`[shots] qr set failed: ${(e as Error).message}`));
  if (set === "pages") return pagesSet(win, js, shot, log).catch((e) => log(`[shots] pages set failed: ${(e as Error).message}`));
  if (set === "history") return historySet(js, shot, log).catch((e) => log(`[shots] history set failed: ${(e as Error).message}`));
  if (set === "real") {
    // Against the real companion: a phone pairs (an outside script plays the phone), then an app is
    // created through the companion and must show up in the main window.
    const snap = () => js(`window.anyapp.getSnapshot()`) as Promise<{ apps: { id: string; status: string }[]; checks: { phone: { pairedCount: number } } }>;
    const until = async (what: string, test: (s: Awaited<ReturnType<typeof snap>>) => boolean, ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (test(await snap())) return true;
        await wait(500);
      }
      log(`[shots] timed out waiting for ${what}`);
      return false;
    };
    nativeTheme.themeSource = "light";
    await js(`window.__app.setup("welcome")`);
    await wait(600);
    await js(`window.__onb.goto("phone-get")`);
    await shot("real-1-phone-get");
    await js(`window.__onb.goto("phone-pair")`);
    await shot("real-2-phone-pair");
    log("[shots] waiting for a phone to pair");
    if (await until("a paired phone", (s) => s.checks.phone.pairedCount > 0, 120_000)) {
      await wait(200);
      await shot("real-3-phone-connected");
    }
    await wait(3500);
    await js(`window.anyapp.setSetting("onboardingDone", true); window.__app.setup(null)`);
    log("[shots] waiting for an app");
    await until("an app", (s) => s.apps.length > 0, 120_000);
    await shot("real-4-main-app-appears");
    const id = (await snap()).apps[0]?.id;
    if (id) {
      await js(`window.__main.openApp(${JSON.stringify(id)})`);
      await wait(Number(process.env.ANYAPP_DESKTOP_SHOTS_CHAT_MS ?? 20_000));
      await shot("real-5-app-chat-progress");
      await until("the first turn and build", (s) => s.apps.some((a) => a.status === "idle" || a.status === "error"), 240_000);
      await shot("real-6-app-chat-done");
      await js(`window.__main.openApp(null)`);
      await wait(500);
      await shot("real-7-main-ready");
    }
    // Easy Connect was turned on at the phone step; its first start builds a helper (minutes).
    await js(`window.__main.connect(true)`);
    await wait(1500);
    await shot("real-8-connect-easy-connect-starting");
    const ok = await until("Easy Connect ready", (s) => (s as unknown as { pairing: { kind: string } }).pairing.kind === "easy-connect", Number(process.env.ANYAPP_DESKTOP_SHOTS_EC_MS ?? 300_000));
    await shot(ok ? "real-9-connect-easy-connect-ready" : "real-9-connect-easy-connect-timeout");
    await js(`window.__main.connect(false)`);
    return;
  }
  for (const theme of ["light", "dark"] as const) {
    nativeTheme.themeSource = theme;
    await wait(300);
    if (set === "flow") {
      await js(`window.__app.setup("welcome")`);
      await wait(600);
      for (const [i, step] of steps.entries()) {
        await js(`window.__onb.goto(${JSON.stringify(step)})`);
        await shot(`${theme}-onboarding-${i + 1}-${step}`);
      }
      await js(`window.anyapp.setSetting("onboardingDone", true); window.__app.setup(null)`);
      await wait(400);
      await shot(`${theme}-main-1-apps`);
      const firstId = await js(`(async () => { const s = await window.anyapp.getSnapshot(); const a = [...s.apps].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).find((x) => x.status === "idle") ?? s.apps[0]; return a ? a.id : null })()`);
      if (firstId) {
        await js(`window.__main.openApp(${JSON.stringify(firstId)})`);
        await shot(`${theme}-main-2-app-chat`);
        await js(`window.__main.openApp(null)`);
      }
      // Easy Connect was turned on at the phone step; show its QR once it is ready.
      for (let i = 0; i < 40; i++) {
        if ((await js(`window.anyapp.getSnapshot().then((s) => s.pairing.kind)`)) === "easy-connect") break;
        await wait(500);
      }
      await shot(`${theme}-main-1b-apps-easy-connect`);
      await js(`window.__main.connect(true)`);
      await shot(`${theme}-main-3-connect-phone`);
      await js(`window.__main.connect(false)`);
      for (const [n, page] of [[4, "phones"], [5, "setup"], [6, "settings"]] as const) {
        await js(`window.__main.page(${JSON.stringify(page)})`);
        if (page === "settings") await js(`setTimeout(() => document.querySelector("details.adv")?.setAttribute("open", ""), 50)`);
        await shot(`${theme}-main-${n}-${page}`);
      }
      await js(`window.__main.page("apps")`);
    } else {
      await js(`window.__app.setup("welcome")`);
      await wait(600);
      for (const step of ["claude", "tools", "github", "phone-get", "phone-pair"]) {
        await js(`window.__onb.goto(${JSON.stringify(step)})`);
        await shot(`${theme}-state-${step}`);
      }
      if (theme === "light" && hooks.pairFakePhone) {
        await js(`window.__onb.goto("phone-pair")`);
        await wait(500);
        await hooks.pairFakePhone();
        await wait(900);
        await shot(`${theme}-state-phone-connected`);
        await wait(3000);
      }
      await js(`window.anyapp.setSetting("onboardingDone", true); window.__app.setup(null)`);
      await wait(500);
      await shot(`${theme}-state-main-needs-attention`);
      await js(`window.__main.page("setup")`);
      await shot(`${theme}-state-main-setup`);
      await js(`window.__main.page("apps")`);
    }
  }
  nativeTheme.themeSource = "system";
}

type Js = (code: string) => Promise<unknown>;

/**
 * Pages in the chat, light and dark: the chat with a page card and an answers card, the page's own
 * window, and the New app sheet with "Ask me more" on. Needs an app whose chat has a page (the fake
 * companion's FAKE_SEED=1 idle apps, or a real one).
 */
async function pagesSet(win: BrowserWindow, js: (code: string) => Promise<unknown>, shot: (name: string) => Promise<void>, log: (l: string) => void): Promise<void> {
  await js(`window.anyapp.setSetting("onboardingDone", true); window.__app.setup(null)`);
  await wait(600);
  const appId = (await js(`(async () => { const s = await window.anyapp.getSnapshot(); for (const a of s.apps) { const m = await window.anyapp.getMessages(a.id); if (m.some((i) => i.kind === "page")) return a.id; } return null })()`)) as string | null;
  if (!appId) return log("[shots] no app has a page in its chat");
  for (const theme of ["light", "dark"] as const) {
    nativeTheme.themeSource = theme;
    await wait(400);
    await js(`window.__main.openApp(${JSON.stringify(appId)})`);
    await wait(1200);
    await shot(`${theme}-pages-1-chat`);
    await js(`document.querySelector('[data-testid^="page-open-"]')?.click()`);
    let page: BrowserWindow | undefined;
    for (let i = 0; i < 40 && !page; i++) {
      await wait(250);
      page = openPageWindows()[0];
    }
    if (page) {
      await new Promise<void>((r) => (page!.webContents.isLoading() ? page!.webContents.once("did-finish-load", () => r()) : r()));
      await wait(1500);
      page.webContents.invalidate();
      await page.webContents.capturePage();
      await wait(250);
      const image = await page.webContents.capturePage();
      writeFileSync(join(process.env.ANYAPP_DESKTOP_SHOTS!, `${theme}-pages-2-window.png`), image.toPNG());
      log(`[shots] ${theme}-pages-2-window (${page.getTitle()}, ${page.webContents.getURL().replace(/\/page\/[^/]+\/[^/#]+/, "/page/<id>/<ticket>")})`);
      page.close();
      await wait(400);
    } else log("[shots] the page window did not open");
    await js(`window.__main.openApp(null); window.__main.newApp(true)`);
    await wait(600);
    await js(`document.querySelector('[data-testid="new-app-ask-more"] [role="switch"]')?.click()`);
    await shot(`${theme}-pages-3-new-app-ask-more`);
    await js(`window.__main.newApp(false)`);
    await wait(300);
  }
}

/**
 * The "history" set (docs/VERSIONS.md): the chat with What changed, a crash card and the diary line,
 * then the Versions panel and its Go back question. Against the fake companion with FAKE_HISTORY=1
 * or a real companion with an app that has versions.
 */
async function historySet(js: (code: string) => Promise<unknown>, shot: (name: string) => Promise<void>, log: (l: string) => void): Promise<void> {
  await js(`window.anyapp.setSetting("onboardingDone", true); window.__app.setup(null)`);
  await wait(600);
  const wanted = process.env.ANYAPP_DESKTOP_SHOTS_APP ?? "Tea Timer";
  const appId = (await js(`window.anyapp.getSnapshot().then((s) => s.apps.find((a) => a.name === ${JSON.stringify(wanted)})?.id ?? null)`)) as string | null;
  if (!appId) return log(`[shots] no app named ${wanted}`);
  const click = (sel: string) => js(`document.querySelector(${JSON.stringify(sel)})?.click()`);
  for (const theme of ["light", "dark"] as const) {
    nativeTheme.themeSource = theme;
    await wait(400);
    await js(`window.__main.openApp(${JSON.stringify(appId)})`);
    await wait(1500);
    await js(`(() => { const el = document.querySelector('[data-testid="chat-scroll"]'); if (el) el.scrollTop = el.scrollHeight; })()`);
    await shot(`${theme}-history-1-chat`);
    await js(`document.querySelector('[data-testid="build-ready"]')?.scrollIntoView({ block: "center" })`);
    await shot(`${theme}-history-2-what-changed`);
    // The newest crash card and diary line, when the chat has them (the real proof does).
    for (const [testid, name] of [["crash-card", "crash"], ["diary-row", "diary"]] as const) {
      const found = await js(`(() => { const all = document.querySelectorAll('[data-testid="${testid}"]'); const el = all[all.length - 1]; if (!el) return false; el.scrollIntoView({ block: "center" }); return true; })()`);
      if (found) await shot(`${theme}-history-2-${name}`);
    }
    await click('[data-testid="versions-toggle"]');
    await wait(1200);
    await shot(`${theme}-history-3-versions`);
    await click('[data-testid="versions-restore"]');
    await wait(400);
    await shot(`${theme}-history-4-go-back-question`);
    await click('[data-testid="versions-close"]');
    await wait(300);
  }
  // Proof only (ANYAPP_DESKTOP_SHOTS_FIX=1): tap "Fix it" on the newest crash card, then stay open
  // until the fixed version is built, and take the chat again.
  if (process.env.ANYAPP_DESKTOP_SHOTS_FIX === "1") {
    nativeTheme.themeSource = "light";
    const newest = () => js(`window.anyapp.getSnapshot().then((s) => s.apps.find((a) => a.id === ${JSON.stringify(appId)})?.latestApk?.number ?? 0)`) as Promise<number>;
    const before = await newest();
    await js(`window.__main.openApp(${JSON.stringify(appId)})`);
    await wait(1500);
    // ANYAPP_DESKTOP_SHOTS_SAY: a follow-up typed into the composer and sent with Enter, instead of Fix it.
    const say = process.env.ANYAPP_DESKTOP_SHOTS_SAY;
    const found = say
      ? await js(`(() => {
          const box = document.querySelector('[data-testid="composer-input"]');
          if (!box) return false;
          const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          box.focus(); set.call(box, ${JSON.stringify(say)}); box.dispatchEvent(new Event("input", { bubbles: true }));
          box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          return true;
        })()`)
      : await js(`(() => { const all = document.querySelectorAll('[data-testid="crash-fix"]'); const el = all[all.length - 1]; if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; })()`);
    log(`[shots] crash fix ${found ? "tapped" : "not found"}`);
    await wait(4000);
    await shot("light-history-5-fix-sent");
    const end = Date.now() + 30 * 60_000;
    // ANYAPP_DESKTOP_SHOTS_UNTIL=diary: wait for the agent's reply after it read the app's diary, not a new version.
    if (process.env.ANYAPP_DESKTOP_SHOTS_UNTIL === "diary") {
      const state = () =>
        js(`window.anyapp.getSnapshot().then((s) => { const a = s.apps.find((x) => x.id === ${JSON.stringify(appId)}); return { replying: !!a?.replying, diary: document.querySelectorAll('[data-testid="diary-row"]').length }; })`) as Promise<{ replying: boolean; diary: number }>;
      const diaryBefore = (await state()).diary;
      while (found && Date.now() < end) {
        const s = await state();
        if (s.diary > diaryBefore && !s.replying) break;
        await wait(3000);
      }
    } else {
      while (found && Date.now() < end && (await newest()) <= before) await wait(5000);
    }
    await wait(3000);
    for (const theme of ["light", "dark"] as const) {
      nativeTheme.themeSource = theme;
      await wait(600);
      await js(`(() => { const el = document.querySelector('[data-testid="chat-scroll"]'); if (el) el.scrollTop = el.scrollHeight; })()`);
      await shot(`${theme}-history-6-fixed`);
      await js(`(() => { const all = document.querySelectorAll('[data-testid="build-ready"]'); const el = all[all.length - 1]; el?.scrollIntoView({ block: "center" }); })()`);
      await shot(`${theme}-history-7-fixed-what-changed`);
    }
  }
}

/** The "qr" set. Logs every pairing-code check as "[shots] code check: ...". */
async function qrSet(win: BrowserWindow, js: Js, shot: (name: string) => Promise<void>, log: (l: string) => void): Promise<void> {
  type Seen = { ec: string; ecCode: boolean; expiresAt?: string; sixDigit: string; logLines: number };
  const seen = async (): Promise<Seen> =>
    (await js(`window.anyapp.getSnapshot().then((s) => ({ ec: s.admin?.easyConnect.state ?? "none", ecCode: !!s.admin?.easyConnect.code, expiresAt: s.admin?.easyConnect.expiresAt, sixDigit: s.admin?.pairing.code ?? "", logLines: s.advanced.logTail.length }))`)) as Seen;
  const logTail = async () => (await js(`window.anyapp.getSnapshot().then((s) => s.advanced.logTail)`)) as string[];
  const secretVisible = () => js(`!!document.querySelector(".qr-plate, .typed") || document.body.innerText.includes("ANYAPP-EC1")`) as Promise<boolean>;
  const report = async (where: string) => {
    const s = await seen();
    log(`[shots] code check (${where}): easyConnect=${s.ec}, live Easy Connect code: ${s.ecCode ? `yes, until ${s.expiresAt}` : "none"}, secret on screen: ${(await secretVisible()) ? "YES" : "no"}`);
    return s;
  };
  const press = (testid: string) => js(`document.querySelector('[data-testid="${testid}"]')?.click()`);
  const closeDialog = () => js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  const waitFor = async (what: string, code: string, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(code)) return true;
      await wait(500);
    }
    log(`[shots] timed out waiting for ${what}`);
    return false;
  };
  // Easy Connect comes back on at start without a code; wait for it, then watch with nothing open.
  await waitFor("Easy Connect ready", `window.anyapp.getSnapshot().then((s) => s.admin?.easyConnect.state === "ready")`, 120_000);
  await js(`window.__main.page("apps")`);
  const startSix = (await report("start, Apps page, no popup")).sixDigit;
  const quietMs = Number(process.env.ANYAPP_DESKTOP_SHOTS_QUIET_MS ?? 30_000);
  await wait(quietMs / 2);
  await report(`Apps page after ${quietMs / 2000}s, no popup`);
  await js(`window.__main.page("phones")`);
  await wait(quietMs / 2);
  const before = await report(`Phones page after ${quietMs / 2000}s more, no popup`);
  log(`[shots] 6-digit code unchanged with no popup open: ${before.sixDigit === startSix ? "yes" : "NO"}`);
  for (const theme of ["light", "dark"] as const) {
    nativeTheme.themeSource = theme;
    await wait(400);
    await js(`window.__main.page("apps")`);
    await shot(`${theme}-1-apps-nothing-secret`);
    await press("show-download-code");
    await shot(`${theme}-2-apps-download-popup`);
    await closeDialog();
    await press("show-pairing-code");
    await waitFor("the pairing QR", `!!document.querySelector(".dialog .qr-plate")`, 20_000);
    await report(`${theme}: pairing popup open`);
    await shot(`${theme}-3-apps-pairing-popup`);
    await js(`[...document.querySelectorAll(".dialog button")].find((b) => b.textContent.includes("Use a code instead"))?.click()`);
    await shot(`${theme}-4-apps-pairing-popup-code`);
    await closeDialog();
    await wait(300);
    await report(`${theme}: pairing popup closed`);
    await js(`window.__main.page("phones")`);
    await shot(`${theme}-5-phones-nothing-secret`);
    await press("show-pairing-code");
    await waitFor("the pairing QR", `!!document.querySelector(".dialog .qr-plate")`, 20_000);
    await shot(`${theme}-6-phones-pairing-popup`);
    await closeDialog();
    await js(`window.__app.setup("phone-get")`);
    await wait(600);
    await shot(`${theme}-7-setup-phone-get-nothing-secret`);
    await js(`window.__onb.goto("phone-pair")`);
    await shot(`${theme}-8-setup-phone-pair-nothing-secret`);
    await press("show-pairing-code");
    await waitFor("the pairing QR", `!!document.querySelector(".dialog .qr-plate")`, 20_000);
    await shot(`${theme}-9-setup-phone-pair-popup`);
    await closeDialog();
    await js(`window.__app.setup(null)`);
    await wait(400);
  }
  // The window's minimum size, with the pairing popup open.
  nativeTheme.themeSource = "light";
  const [w, h] = win.getSize();
  win.setSize(960, 640);
  await js(`window.__main.page("apps")`);
  await shot("light-10-min-size-apps");
  await press("show-pairing-code");
  await waitFor("the pairing QR", `!!document.querySelector(".dialog .qr-plate")`, 20_000);
  await shot("light-11-min-size-pairing-popup");
  await closeDialog();
  win.setSize(w, h);
  nativeTheme.themeSource = "system";
  // The last code runs out after 5 minutes with every popup closed: nothing may make a new one.
  await js(`window.__main.page("apps")`);
  if (process.env.ANYAPP_DESKTOP_SHOTS_EXPIRY === "0") return;
  const asked = (await logTail()).filter((l) => l.includes("new pairing code asked for")).length;
  log(`[shots] popups opened a code ${asked} time(s); now waiting for the last code to run out with no popup open`);
  await waitFor("the code to run out", `window.anyapp.getSnapshot().then((s) => !s.admin?.easyConnect.code)`, 6 * 60_000);
  await report("after the code ran out, Apps page, no popup");
  await wait(Number(process.env.ANYAPP_DESKTOP_SHOTS_AFTER_MS ?? 60_000));
  await report("a minute later, Apps page, no popup");
  const tail = await logTail();
  const since = tail.map((l) => l.includes("Easy Connect code expired")).lastIndexOf(true);
  const renewed = tail.slice(since + 1).filter((l) => /new pairing code asked for|allowListLiftedForPairing/.test(l));
  log(`[shots] last code ran out: ${since >= 0 ? "yes (logged)" : "not in the log tail"}; codes made or renewed since then with no popup open: ${renewed.length}${renewed.length ? ` (${renewed.join(" | ")})` : ""}`);
}
