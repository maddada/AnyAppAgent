// The voice input every long text box on the desktop shares (the chat box, Make a kiwi, and the
// rest): the mic button, Ctrl+Alt+Space, the line that says what is wrong, and where the words go.
// The recording is transcribed by Hex, or on Linux by Superwhisper (dictation.ts and the main
// process pick it); the words go in where the caret was when the recording started, or over the
// selected text (shared/chat/dictation.ts), so text already in the box and earlier dictations stay.
import { useEffect, useId, useRef, useSyncExternalStore, type RefObject } from "react";
import { Mic, Square, X } from "lucide-react";
import type { HexCheck } from "../../shared/types.ts";
import { DictationText } from "../../../../shared/chat/dictation.ts";
import { DICTATE_HOTKEY, HOLD_MS, isDictateHotkey, useDictation } from "./dictation.ts";
import { engineName } from "./Hex.tsx";
import { Icon, Spinner } from "./ui.tsx";

type Box = HTMLTextAreaElement | HTMLInputElement;

/**
 * The boxes with voice that are on screen, newest last. Ctrl+Alt+Space goes to the focused one,
 * else the newest (a dialog's box over the chat's).
 */
const boxes: { id: string; el: () => Box | null }[] = [];
function hotkeyOwner(): string | undefined {
  const active = document.activeElement;
  return (boxes.find((b) => b.el() === active) ?? boxes[boxes.length - 1])?.id;
}

/**
 * Where dictation stands on this PC and how to set it up, given once by the main window
 * (useVoiceSetupFrom), so every box with voice knows it without passing it down.
 */
let current: HexCheck | undefined;
let setupNow: (() => void) | undefined;
const listeners = new Set<() => void>();
export function useVoiceSetupFrom(hex: HexCheck | undefined, onSetup: () => void): void {
  setupNow = onSetup;
  useEffect(() => {
    if (current === hex) return;
    current = hex;
    listeners.forEach((l) => l());
  }, [hex]);
}
function useHexCheck(): HexCheck | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Why dictation can't start, in plain words. */
export function dictationProblem(hex?: HexCheck): string {
  if (!hex || hex.state === "checking") return "Looking for the dictation app on this PC...";
  if (hex.state === "notInstalled") {
    return hex.platform === "linux"
      ? "Dictation uses Superwhisper or Hex, apps that turn your voice into text on this PC. Neither is installed yet."
      : "Dictation uses Hex, a free app that turns your voice into text on this PC. It isn't installed yet.";
  }
  if (hex.state === "notRunning") return "Dictation needs Hex open. Open Hex, then try again.";
  if (hex.state === "noModels") return "Hex has no speech model yet. Open Hex and download one in its settings.";
  return hex.summary;
}

export interface Voice {
  phase: ReturnType<typeof useDictation>["phase"];
  level: number;
  seconds: number;
  error: string | null;
  dismiss: () => void;
  /** Start, or stop and write it down. */
  toggle: () => void;
  ready: boolean;
  /** "Hex" or "Superwhisper". */
  engine: string;
  hex?: HexCheck;
}

/**
 * Voice for one box. `box` is the text box; `value` and `setValue` its text. The words go in at
 * the caret the box had when the recording started, and the caret ends after them.
 */
export function useVoice({ box, value, setValue, hex: given }: { box: RefObject<Box | null>; value: string; setValue: (text: string) => void; hex?: HexCheck }): Voice {
  const id = useId();
  const known = useHexCheck();
  const hex = given ?? known;
  const now = useRef({ value, setValue });
  now.current = { value, setValue };
  const spot = useRef<DictationText | null>(null);
  const engine = engineName(hex);
  const ready = hex?.state === "ready";
  const dictation = useDictation({
    engine,
    platform: hex?.platform,
    onText: (said) => {
      const d = spot.current ?? new DictationText(now.current.value);
      spot.current = null;
      // The person may have typed while it was written down: that stays.
      d.sync(now.current.value);
      const out = d.final(said);
      now.current.value = out.value;
      now.current.setValue(out.value);
      const el = box.current;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(out.caret, out.caret);
      });
    },
  });
  const toggle = () => {
    if (dictation.phase === "recording") return dictation.stop();
    if (dictation.phase !== "idle") return;
    if (!ready) return dictation.setError(dictationProblem(hex));
    // A box keeps its caret when it loses focus (to the mic button, say): the words go there.
    const el = box.current;
    const text = now.current.value;
    spot.current = el && el.value === text ? new DictationText(text, el.selectionStart ?? text.length, el.selectionEnd ?? text.length) : new DictationText(text);
    void dictation.start();
  };

  // Ctrl+Alt+Space: tap to start and tap to stop, or hold and let go. Escape cancels a recording.
  const toggleNow = useRef(toggle);
  toggleNow.current = toggle;
  const phaseNow = useRef(dictation.phase);
  phaseNow.current = dictation.phase;
  const { cancel, stop } = dictation;
  useEffect(() => {
    const entry = { id, el: () => box.current };
    boxes.push(entry);
    const press: { current: { at: number; started: boolean } | null } = { current: null };
    const down = (e: KeyboardEvent) => {
      if (hotkeyOwner() !== id) return;
      if (e.key === "Escape" && (phaseNow.current === "recording" || phaseNow.current === "starting")) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (!isDictateHotkey(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      press.current = { at: Date.now(), started: phaseNow.current === "idle" };
      toggleNow.current();
    };
    const up = (e: KeyboardEvent) => {
      if (!press.current || (e.code !== "Space" && e.key !== "Control" && e.key !== "Alt")) return;
      const p = press.current;
      press.current = null;
      if (p.started && Date.now() - p.at >= HOLD_MS) stop();
    };
    // Capture: a dialog's own Escape must not close it while the recording is cancelled.
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      boxes.splice(boxes.indexOf(entry), 1);
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [id, box, cancel, stop]);

  return { phase: dictation.phase, level: dictation.level, seconds: dictation.seconds, error: dictation.error, dismiss: () => dictation.setError(null), toggle, ready, engine, hex };
}

/** The placeholder while it records or writes it down, else `idle`. */
export function voicePlaceholder(v: Voice, idle: string): string {
  return v.phase === "recording" ? "Listening. Stop when you're done." : v.phase === "transcribing" ? `${v.engine} is writing it down...` : idle;
}

/** The mic button (and the time while it records), for inside or beside the box. */
export function VoiceMic({ voice: v, testId }: { voice: Voice; testId: string }) {
  const hexState = v.hex?.state ?? "checking";
  return (
    <>
      {v.phase === "recording" && (
        <span className="dictate-meter mono" aria-hidden>
          <span className="dictate-dot" style={{ transform: `scale(${1 + v.level * 0.9})` }} />
          {`${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, "0")}`}
        </span>
      )}
      <button
        type="button"
        className={`mic${v.phase === "recording" ? " is-recording" : ""}${!v.ready && hexState !== "checking" ? " is-off" : ""}`}
        data-testid={testId}
        onClick={v.toggle}
        disabled={v.phase === "starting" || v.phase === "transcribing"}
        aria-label={v.phase === "recording" ? "Stop and write it down" : `Dictate with ${v.engine}`}
        title={v.phase === "recording" ? `Stop (${DICTATE_HOTKEY}). Esc cancels.` : v.ready ? `Dictate with ${v.engine} (${DICTATE_HOTKEY}). Tap to start and tap to stop, or hold and let go.` : dictationProblem(v.hex)}
      >
        {v.phase === "transcribing" || v.phase === "starting" ? <Spinner /> : <Icon of={v.phase === "recording" ? Square : Mic} size="md" />}
      </button>
    </>
  );
}

/** What went wrong, full width, with its buttons below it on the right. */
export function VoiceNote({ voice: v, onSetup = setupNow }: { voice: Voice; onSetup?: () => void }) {
  if (!v.error) return null;
  return (
    <div className="label composer-note dictate-note" data-testid="dictate-note">
      <span>{v.error}</span>
      <span className="dictate-note-actions">
        {!v.ready && onSetup && (
          <button type="button" className="btn btn-text label" onClick={onSetup}>
            Set up dictation
          </button>
        )}
        <button type="button" className="btn btn-icon" aria-label="Dismiss" title="Dismiss" onClick={v.dismiss}>
          <Icon of={X} size="sm" />
        </button>
      </span>
    </div>
  );
}

/**
 * A long text box with voice: the textarea with the mic at its bottom right and the note under it.
 * For the boxes that are only a box (Make a kiwi, and the like); the chat box draws its own row.
 */
export function VoiceTextarea({
  box,
  value,
  setValue,
  hex,
  onSetup,
  testId,
  placeholder,
  ...rest
}: { box: RefObject<HTMLTextAreaElement | null>; value: string; setValue: (text: string) => void; hex?: HexCheck; onSetup?: () => void; testId: string; placeholder?: string } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "placeholder">) {
  const voice = useVoice({ box, value, setValue, hex });
  return (
    <>
      <span className={`voice-box${voice.phase === "recording" ? " is-recording" : ""}`}>
        <textarea {...rest} ref={box} data-testid={testId} value={value} placeholder={voicePlaceholder(voice, placeholder ?? "")} onChange={(e) => setValue(e.target.value)} />
        <span className="voice-box-mic">
          <VoiceMic voice={voice} testId={`${testId}-mic`} />
        </span>
      </span>
      <VoiceNote voice={voice} onSetup={onSetup} />
    </>
  );
}

/**
 * Dictation in a page window (an agent's plan or questions): Ctrl+Alt+Space there comes here, the
 * recording and transcribing happen here as in a chat, and the finished words go into the page's
 * text box (main/page-window.ts). Mounted once, in the main window.
 */
export function PageVoice() {
  const hex = useHexCheck();
  const target = useRef<string | null>(null);
  const dictation = useDictation({
    engine: engineName(hex),
    platform: hex?.platform,
    onText: (said) => {
      if (target.current) void window.anyapp.pageInsert(target.current, said);
    },
  });
  const now = useRef({ dictation, ready: hex?.state === "ready" });
  now.current = { dictation, ready: hex?.state === "ready" };
  const { phase } = dictation;
  useEffect(() => {
    if (target.current) void window.anyapp.pageVoiceState(target.current, phase === "starting" ? "recording" : phase);
  }, [phase]);
  useEffect(() => {
    let press: { at: number; started: boolean } | null = null;
    return window.anyapp.onPageVoiceKey((page, key) => {
      const { dictation: d, ready } = now.current;
      if (key === "escape") return d.cancel();
      if (key === "up") {
        const p = press;
        press = null;
        if (p?.started && Date.now() - p.at >= HOLD_MS) d.stop();
        return;
      }
      if (d.phase === "recording") return d.stop();
      if (d.phase !== "idle" || !ready) return;
      target.current = page;
      press = { at: Date.now(), started: true };
      void d.start();
    });
  }, []);
  return null;
}
