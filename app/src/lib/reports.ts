// Crash reports and diaries from the apps made with AnyAppAgent (docs/VERSIONS.md). The native side
// (modules/anyapp-native, AppReports.kt) receives them from the apps, checks who sent them and keeps
// crashes until the PC is reachable; this sends them to the PC, and answers the PC's diary.request.
import type { CrashReport, DiaryEntry, ServerEvent } from "./protocol";
import { AnyAppNative } from "../../modules/anyapp-native";
import { getState } from "./store";

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

/** The PC wants an app's diary (its agent called read_diary): ask the app, then answer the PC. */
export async function answerDiaryRequest(event: Extract<ServerEvent, { type: "diary.request" }>): Promise<void> {
  const client = getState().client;
  if (!client) return;
  const answer = (body: { entries?: DiaryEntry[]; problem?: "not_installed" | "no_answer" | "not_supported" }) =>
    client.diaryAnswer(event.appId, { requestId: event.requestId, ...body }).catch(() => {});
  if (!AnyAppNative?.requestDiary) return void answer({ problem: "not_supported" });
  const got = new Promise<string | null>((resolve) => {
    diaryWaits.set(event.requestId, resolve);
    setTimeout(() => resolve(null), 8000);
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
