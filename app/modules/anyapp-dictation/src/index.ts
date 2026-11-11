import { NativeModule, requireOptionalNativeModule } from "expo";

/** What went wrong, folded from Android's SpeechRecognizer error codes. */
export type DictationErrorCode =
  | "unavailable"
  | "permission"
  | "silence"
  | "audio"
  | "busy"
  | "network"
  | "language"
  | "downloading" // no language pack yet: the phone was asked to download it (Android 13+)
  | "client"
  | "server";

export type DictationEvent =
  | { type: "start"; session: number; onDevice: boolean; offline: boolean; language: string }
  | { type: "level"; session: number; level: number }
  | { type: "partial"; session: number; text: string }
  | { type: "final"; session: number; text: string }
  | { type: "error"; session: number; code: DictationErrorCode; message: string }
  | { type: "end"; session: number };

type Events = {
  onDictation: (event: DictationEvent) => void;
};

declare class AnyAppDictationModule extends NativeModule<Events> {
  /** Whether this phone has speech recognition, and on the phone itself (Android 12+). */
  availability(): { available: boolean; onDevice: boolean; language: string };
  /** Starts listening in the phone's language (or `language`, a BCP 47 tag). */
  start(language: string | null): boolean;
  /** Stops listening; what was heard arrives as "final". */
  stop(): boolean;
  /** Drops the session without a "final". */
  cancel(): boolean;
}

/** Null when the native side is missing (web, Expo Go, or a build before dictation). */
export const AnyAppDictation = requireOptionalNativeModule<AnyAppDictationModule>("AnyAppDictation");
