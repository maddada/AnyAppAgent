// Dictation into a prompt box with Android's own speech recognition (modules/anyapp-dictation):
// tap the mic, the words appear in the box as they are heard, tap again (or stop talking) to
// stop. The text stays in the box to edit; nothing is ever sent by dictation.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, Keyboard, Linking, PermissionsAndroid, Platform } from "react-native";
import { AnyAppDictation, type DictationErrorCode, type DictationEvent } from "anyapp-dictation";

export type DictationPhase = "idle" | "asking" | "starting" | "listening";

export interface Dictation {
  /** False when this build or this phone has no speech recognition: the mic is not shown. */
  available: boolean;
  phase: DictationPhase;
  /** The voice level, 0..1, while listening. */
  level: number;
  /** A plain sentence, or null. */
  error: string | null;
  /** The problem can be fixed in the app's Android settings (the microphone was refused for good). */
  needsSettings: boolean;
  toggle: () => void;
  cancel: () => void;
  dismiss: () => void;
  openSettings: () => void;
}

const MIC = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;

/** The one-line reason shown while Android asks for the microphone. */
export const MIC_REASON = "AnyAppAgent listens only while the mic is on, to write what you say.";

const MESSAGES: Record<DictationErrorCode, string> = {
  unavailable: "This phone has no speech recognition to dictate with.",
  permission: "Allow the microphone to dictate.",
  silence: "No speech heard.",
  audio: "The microphone could not be opened. Try again.",
  busy: "The microphone is busy. Try again.",
  network: "The phone's speech service could not be reached. Try again.",
  language: "This phone cannot dictate in its language yet. Add the language in the phone's speech settings.",
  downloading: "The phone is getting its speech pack for your language. Try again in a minute.",
  client: "Dictation stopped. Try again.",
  server: "Dictation stopped. Try again.",
};

/** Whether the native side is in this build and the phone has a recognizer (asked once). */
let availableCache: boolean | null = null;
function isAvailable(): boolean {
  if (availableCache === null) {
    try {
      availableCache = Platform.OS === "android" && !!AnyAppDictation?.availability().available;
    } catch {
      availableCache = false;
    }
  }
  return availableCache;
}

/** `before` and the dictated words, with a space between them where needed. */
export function joinDictation(before: string, words: string): string {
  if (!words) return before;
  if (!before) return words;
  return /\s$/.test(before) ? before + words : `${before} ${words}`;
}

/** Only one box listens at a time: starting in another box drops the one before. */
let owner: { token: object; drop: () => void } | null = null;

export function useDictation({ value, onChange }: { value: string; onChange: (text: string) => void }): Dictation {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsSettings, setNeedsSettings] = useState(false);
  const [token] = useState(() => ({}));
  const live = useRef({ value, onChange, phase, base: "", heard: false });
  useLayoutEffect(() => {
    live.current.value = value;
    live.current.onChange = onChange;
    live.current.phase = phase;
  });

  const fail = useCallback((message: string, settings = false) => {
    setError(message);
    setNeedsSettings(settings);
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setLevel(0);
  }, []);

  // A plain note goes away by itself after a while; the settings one stays until dismissed.
  useEffect(() => {
    if (!error || needsSettings) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error, needsSettings]);

  useEffect(() => {
    if (!AnyAppDictation) return;
    const sub = AnyAppDictation.addListener("onDictation", (e: DictationEvent) => {
      if (owner?.token !== token) return;
      const l = live.current;
      switch (e.type) {
        case "start":
          setPhase("listening");
          break;
        case "level":
          setLevel(e.level);
          break;
        case "partial":
          if (e.text) l.heard = true;
          l.onChange(joinDictation(l.base, e.text));
          break;
        case "final":
          if (e.text) {
            l.heard = true;
            l.onChange(joinDictation(l.base, e.text));
          } else if (!l.heard) {
            fail(MESSAGES.silence);
          }
          break;
        case "error":
          // Words already in the box stay; "nothing heard" after words is just the end.
          if (!(l.heard && e.code === "silence")) fail(MESSAGES[e.code] ?? MESSAGES.server, e.code === "permission");
          break;
        case "end":
          owner = null;
          reset();
          break;
      }
    });
    return () => sub.remove();
  }, [token, fail, reset]);

  const cancel = useCallback(() => {
    if (owner?.token !== token) return;
    owner = null;
    AnyAppDictation?.cancel();
    reset();
  }, [token, reset]);

  // Leaving the screen or the app ends the listening.
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") cancel();
    });
    return () => sub.remove();
  }, [cancel]);

  const start = useCallback(async () => {
    if (!AnyAppDictation) return;
    setError(null);
    setNeedsSettings(false);
    if (!(await PermissionsAndroid.check(MIC))) {
      setPhase("asking");
      const answer = await PermissionsAndroid.request(MIC, { title: "Microphone", message: MIC_REASON, buttonPositive: "OK" });
      if (answer !== PermissionsAndroid.RESULTS.GRANTED) {
        reset();
        return fail(MESSAGES.permission, answer === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
      }
    }
    owner?.drop();
    owner = { token, drop: reset };
    const l = live.current;
    l.base = l.value;
    l.heard = false;
    setLevel(0);
    setPhase("starting");
    Keyboard.dismiss();
    AnyAppDictation.start(null);
  }, [token, fail, reset]);

  const toggle = useCallback(() => {
    const p = live.current.phase;
    if (p === "asking") return;
    if (p === "idle") return void start();
    // Starting or listening: stop, and what was heard lands in the box.
    if (owner?.token === token) AnyAppDictation?.stop();
  }, [start, token]);

  return {
    available: isAvailable(),
    phase,
    level,
    error,
    needsSettings,
    toggle,
    cancel,
    dismiss: () => setError(null),
    openSettings: () => {
      setError(null);
      void Linking.openSettings();
    },
  };
}
