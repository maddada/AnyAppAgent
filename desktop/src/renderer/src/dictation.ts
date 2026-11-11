// Dictation into the chat box with Hex (like Ghostex's Dictate): the microphone is recorded here,
// turned into a 16 kHz mono WAV, and the main process asks Hex on this PC to transcribe it
// (src/main/hex.ts). Nothing leaves the PC.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";



export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

/** The hotkey, as Ghostex has it: Ctrl+Alt+Space. Tap to start and tap to stop, or hold and let go. */
export const DICTATE_HOTKEY = "Ctrl+Alt+Space";
/** A press held at least this long stops when the keys come up (Ghostex's Auto mode). */
export const HOLD_MS = 300;

export const isDictateHotkey = (e: KeyboardEvent | ReactKeyboardEvent) => e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === "Space";

/** 16-bit PCM WAV of mono samples. */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
}

/** The recorded audio (webm/opus) decoded and resampled to 16 kHz mono, as WAV. */
async function toWav(blob: Blob): Promise<ArrayBuffer> {
  const rate = 16_000;
  const ctx = new OfflineAudioContext(1, 1, rate);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
  }
  return encodeWav(mono, rate);
}

/** Puts `text` in `value` at the caret, with a space where the neighbours need one. */
export function insertAt(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^[\s.,!?;:]/.test(after) ? " " : "";
  const piece = `${lead}${text}${trail}`;
  return { value: before + piece + after, caret: before.length + lead.length + text.length };
}

export function useDictation({ onText }: { onText: (text: string) => void }) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; chunks: Blob[]; cancelled: boolean; timer: number; raf: number } | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  const release = () => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => undefined);
    rec.current = null;
    setLevel(0);
  };

  const start = useCallback(async () => {
    if (rec.current) return;
    setError(null);
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setPhase("idle");
      const name = (e as Error).name;
      setError(
        name === "NotAllowedError"
          ? "Windows blocked the microphone. In Windows Settings, Privacy & security, Microphone, turn on \"Let desktop apps access your microphone\", then try again."
          : name === "NotFoundError"
            ? "No microphone found. Plug one in, then try again."
            : "The microphone couldn't start. Try again.",
      );
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const r = { recorder, stream, ctx, chunks: [] as Blob[], cancelled: false, timer: 0, raf: 0 };
    rec.current = r;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const s of samples) peak = Math.max(peak, Math.abs(s - 128));
      setLevel(Math.min(1, peak / 64));
      r.raf = requestAnimationFrame(tick);
    };
    tick();
    const t0 = Date.now();
    setSeconds(0);
    r.timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
    recorder.ondataavailable = (ev) => ev.data.size && r.chunks.push(ev.data);
    recorder.onstop = async () => {
      const cancelled = r.cancelled;
      const blob = new Blob(r.chunks, { type: "audio/webm" });
      release();
      if (cancelled) {
        setPhase("idle");
        return;
      }
      setPhase("transcribing");
      try {
        const wav = await toWav(blob);
        // Under half a second of audio is a slip of the keys, not a dictation.
        if (wav.byteLength < 44 + 16_000) {
          setPhase("idle");
          return;
        }
        const res = await window.anyapp.hexTranscribe(wav);
        if (res.ok) {
          if (res.text) textRef.current(res.text);
          else setError("Hex heard nothing. Speak a little closer to the microphone, then try again.");
        } else setError(res.error ?? "Hex couldn't transcribe this. Try again.");
      } catch {
        setError("The recording couldn't be read. Try again.");
      }
      setPhase("idle");
    };
    recorder.start(250);
    setPhase("recording");
  }, []);

  const stop = useCallback(() => {
    const r = rec.current;
    if (r && r.recorder.state === "recording") r.recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    r.cancelled = true;
    if (r.recorder.state === "recording") r.recorder.stop();
    else release();
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  return { phase, error, setError, level, seconds, start, stop, cancel };
}
