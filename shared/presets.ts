// What an app can be made from, in the words the phone's and the PC's New app sheets show under
// "Advanced" (one source, so both say exactly the same). The wire field is CreateAppRequest.preset.
import type { AppPreset } from "./protocol.ts";

export interface PresetChoice {
  id: AppPreset;
  title: string;
  tag?: string;
  line: string;
}

export const DEFAULT_PRESET: AppPreset = "react-native";

export const PRESET_CHOICES: readonly PresetChoice[] = [
  {
    id: "react-native",
    title: "React Native",
    tag: "Default",
    line: "Can come to iPhone later, and can get quick updates without a new install later on. Apps are bigger (about 55 MB).",
  },
  {
    id: "kotlin",
    title: "Kotlin",
    line: "Fully native Android, smaller and faster apps (a few MB). Android only.",
  },
];
