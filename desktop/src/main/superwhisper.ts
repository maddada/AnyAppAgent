// Superwhisper, the dictation app Omarchy ships on Linux. Kiwimake records the microphone itself and
// hands the recording to Superwhisper's command line to transcribe, the way Ghostex does
// (Ghostex: server/src/voice_agent/speech/superwhisper.rs).
//
// - `superwhisper transcribe FILE` takes the recording and answers `{"ok": true, "session_id": N}`
//   at once (`{"error": "…"}` with a non-zero exit when it can't read the file). Without `--insert`
//   Superwhisper neither pastes the text nor touches the clipboard.
// - The text arrives a moment later in `superwhisper read`, the last dictation ({session_id,
//   createdAt, text, warning, error}). Session ids start again at 1 when its service restarts, so a
//   result is ours when its id matches and it isn't the dictation `read` showed before the request.
// - Superwhisper is ready as soon as it is installed: the command starts its service when needed.
//   Looking for it never runs it, so checking never starts the service.
// - It transcribes with its own processing mode, language, tone and vocabulary; Kiwimake changes
//   none of Superwhisper's settings.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export const SUPERWHISPER_SITE = "https://superwhisper.com/";
const COMMAND_MS = 30_000;
const POLL_MS = 200;

type Env = Record<string, string | undefined>;

export class SuperwhisperFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The `superwhisper` command on Linux: on PATH, else where its packages put it. */
export function superwhisperBinary(env: Env, home: string, platform: string = process.platform): string | undefined {
  if (platform !== "linux") return undefined;
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  dirs.push(join(home, ".local", "bin"), "/usr/local/bin", "/usr/bin");
  return dirs.map((d) => join(d, "superwhisper")).find(isFile);
}

interface Answer {
  ok?: boolean;
  session_id?: number;
  text?: string;
  warning?: string;
  error?: string;
}

/** Runs one `superwhisper` command and reads its JSON answer. Rejects with the detail to log. */
export function runSuperwhisper(binary: string, args: string[], ms = COMMAND_MS): Promise<Answer> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: ms, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      let answer: Answer = {};
      try {
        answer = JSON.parse(String(stdout).trim()) as Answer;
      } catch {
        // not JSON
      }
      // `read` exits non-zero when the last dictation failed, and still answers that dictation.
      if (error && answer.session_id === undefined) {
        const timedOut = (error as Error & { killed?: boolean }).killed;
        reject(new Error(timedOut ? `superwhisper ${args[0]} didn't answer within ${Math.round(ms / 1000)} seconds.` : (answer.error ?? error.message)));
        return;
      }
      resolve(answer);
    });
  });
}

/** Transcribes a WAV recording with Superwhisper. Throws a SuperwhisperFailure with plain words. */
export async function superwhisperTranscribe(opts: { env: Env; home: string; wav: Uint8Array; run?: typeof runSuperwhisper }): Promise<string> {
  const binary = superwhisperBinary(opts.env, opts.home);
  if (!binary) throw new SuperwhisperFailure("notInstalled", "Superwhisper isn't installed on this PC anymore. Set up dictation in Settings, then try again.");
  const run = opts.run ?? runSuperwhisper;
  const scratch = mkdtempSync(join(tmpdir(), "anyapp-superwhisper-"));
  const file = join(scratch, "dictation.wav");
  writeFileSync(file, opts.wav);
  try {
    // Also starts the service when it isn't running, so the ids below come from one run of it.
    const before = await run(binary, ["read"]).catch(() => undefined);
    let accepted: Answer;
    try {
      accepted = await run(binary, ["transcribe", file]);
    } catch (error) {
      const detail = (error as Error).message;
      if (detail.includes("decode")) throw new SuperwhisperFailure("badAudio", "Superwhisper couldn't read the recording. Try again.");
      throw new SuperwhisperFailure("unavailable", "Superwhisper didn't take the recording. Check that dictating in Superwhisper itself works, then try again.");
    }
    const session = accepted.session_id;
    if (typeof session !== "number") throw new SuperwhisperFailure("failed", "Superwhisper's answer couldn't be read. Update Superwhisper, then try again.");
    // Superwhisper takes a few seconds for a long recording (1 s per 2 s of audio, at least 60 s).
    const seconds = opts.wav.byteLength / 32_000;
    const deadline = Date.now() + Math.max(60_000, seconds * 500 + 30_000);
    const same = (a: Answer, b?: Answer) => !!b && JSON.stringify(a) === JSON.stringify(b);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      // A failed `read` (the service restarting) is asked again until the deadline.
      const last = await run(binary, ["read"]).catch(() => undefined);
      if (!last || last.session_id !== session || same(last, before)) continue;
      const text = (last.text ?? "").trim();
      const warning = last.warning ?? "";
      // "No speech detected" is an empty dictation.
      const silent = !warning || warning === "No speech detected";
      if (text || (!last.error && silent)) return text;
      throw new SuperwhisperFailure("failed", "Superwhisper couldn't transcribe this. Try again.");
    }
    throw new SuperwhisperFailure("timeout", "Superwhisper didn't finish in time. Check that dictating in Superwhisper itself works, then try again.");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
