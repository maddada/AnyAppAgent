// Dev only: ANYAPP_DESKTOP_SHOTS=<folder> walks the real window through every onboarding step and
// the main window, in light and dark, and saves a PNG of each (webContents.capturePage).
// ANYAPP_DESKTOP_SHOTS_SET picks which set: "flow" (default) or "states" (the "needs you" variants,
// used together with ANYAPP_DESKTOP_SIMULATE).
import { nativeTheme, type BrowserWindow } from "electron";
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
  const shot = async (name: string) => {
    await wait(700);
    const image = await win.webContents.capturePage();
    writeFileSync(join(dir, `${name}.png`), image.toPNG());
    log(`[shots] ${name}`);
  };
  const steps = ["welcome", "claude", "tools", "github", "phone-get", "phone-pair", "done"];
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
