// Crash reports and diaries from the apps made with Kiwimake (docs/VERSIONS.md). The native side
// (modules/anyapp-native, AppReports.kt) receives them from the apps, checks who sent them and keeps
// crashes until the PC is reachable; this sends them to the PC, and answers the PC's diary.request.
import type { CrashReport, DiaryAnswer, DiaryEntry, ServerEvent } from "./protocol";
import { AnyAppNative } from "../../modules/anyapp-native";
import { clientFor, getState, useStore, type InstallProgress } from "./store";

/** Crashes taken from the native queue that could not be sent yet (sent on the next connect). */
let unsent: { packageName: string; report: CrashReport }[] = [];
let sending = false;
const diaryWaits = new Map<string, (diary: string) => void>();

export function startReports(): void {
  if (!AnyAppNative) return;
  AnyAppNative.addListener("onAppCrash", () => void sendCrashes());
  AnyAppNative.addListener("onAppDiary", (e) => diaryWaits.get(e.requestId)?.(e.diary));
}

/** Sends every waiting crash to the PC (each lands as a "crash" card in its app's chat). */
export async function sendCrashes(): Promise<void> {
  const { client, connection, apps } = getState();
  if (!client || connection !== "online" || sending || !AnyAppNative?.takeWaitingCrashes) return;
  sending = true;
  try {
    try {
      const fresh = JSON.parse(AnyAppNative.takeWaitingCrashes() || "[]") as { packageName: string; report: CrashReport }[];
      unsent = [...unsent, ...fresh].slice(-20);
    } catch {
      // a broken queue is dropped
    }
    const left: typeof unsent = [];
    for (const crash of unsent) {
      const app = Object.values(apps).find((a) => a.packageName === crash.packageName);
      if (!app) continue; // an app this PC does not know (made with another PC)
      try {
        await client.reportCrash(app.id, crash.report);
      } catch {
        left.push(crash);
      }
    }
    unsent = left;
  } finally {
    sending = false;
  }
}

/**
 * An install of the app that is running when its diary is asked for is waited for, up to this. The
 * PC waits 56 s in all (the agent's tool call gives up at about 60 s).
 */
export const DIARY_INSTALL_WAIT_MS = 42_000;
/** How long the app has to answer once it is asked (a just installed app starts cold). */
const DIARY_ANSWER_MS = 10_000;
/** After an install that was waited for, before the app is asked. */
const INSTALL_SETTLE_MS = 2_000;

/** A timer that keeps running while Android's install prompt covers Kiwimake (JS timers pause then). */
function after(ms: number): Promise<void> {
  if (AnyAppNative?.delay) return AnyAppNative.delay(ms).catch(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const INSTALLING: ReadonlySet<InstallProgress["phase"]> = new Set(["waiting", "downloading", "checking", "installing", "confirm"]);

/**
 * Resolves true when no install of this app is running, or false when one still runs after
 * `limitMs`. While Android replaces an app it cannot answer, so a diary asked for then used to come
 * back as "did not answer".
 */
export function waitForInstall(appId: string, limitMs = DIARY_INSTALL_WAIT_MS): Promise<boolean> {
  // Only the install's own result counts: Android lists the new version a little before it lets the
  // app start ("frozen"), and asking it then gets it force-stopped.
  const running = () => {
    const phase = getState().installs[appId]?.phase;
    return !!phase && INSTALLING.has(phase);
  };
  if (!running()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const done = (finished: boolean) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(finished);
    };
    unsubscribe = useStore.subscribe(() => {
      if (!running()) done(true);
    });
    void after(limitMs).then(() => done(!running()));
  });
}

/** The PC wants an app's diary (its agent called read_diary): ask the app, then answer the PC. */
export async function answerDiaryRequest(event: Extract<ServerEvent, { type: "diary.request" }>): Promise<void> {
  const client = clientFor(event.appId);
  if (!client) return;
  const answer = (body: { entries?: DiaryEntry[]; problem?: DiaryAnswer["problem"] }) =>
    client.diaryAnswer(event.appId, { requestId: event.requestId, ...body }).catch(() => {});
  if (!AnyAppNative?.requestDiary) return void answer({ problem: "not_supported" });
  const started = Date.now();
  const installed = await waitForInstall(event.appId);
  const waited = Date.now() - started;
  if (waited > 500) console.log(`diary: waited ${Math.round(waited / 1000)} s for the install of ${event.packageName}${installed ? "" : ", still installing"}`);
  if (!installed) return void answer({ problem: "installing" });
  // Just installed: give Android a moment to finish with the app before it is started for the diary.
  if (waited > 500) await after(INSTALL_SETTLE_MS);
  const got = new Promise<string | null>((resolve) => {
    diaryWaits.set(event.requestId, resolve);
    void after(DIARY_ANSWER_MS).then(() => resolve(null));
  });
  if (!AnyAppNative.requestDiary(event.packageName, event.requestId)) {
    diaryWaits.delete(event.requestId);
    return void answer({ problem: "not_installed" });
  }
  const diary = await got;
  diaryWaits.delete(event.requestId);
  if (diary == null) return void answer({ problem: "no_answer" });
  let entries: DiaryEntry[] = [];
  try {
    entries = (JSON.parse(diary) as DiaryEntry[]).slice(-300);
  } catch {
    // unreadable: empty
  }
  await answer({ entries });
}
