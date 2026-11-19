// What an app can be made from, in the words the phone's and the PC's New app sheets show under
// "Advanced" (one source, so both say exactly the same). The wire field is CreateAppRequest.preset.
// The default, "Let the agent decide" (id null), leaves preset out: the agent picks the kind from
// what the person wrote and says which in its first reply. Any other pick is sent, even React Native.
import type { AppPreset } from "./protocol.ts";

export interface PresetChoice {
  id: AppPreset | null;
  title: string;
  tag?: string;
  line: string;
}

export const DEFAULT_PRESET: AppPreset | null = null;

export const PRESET_CHOICES: readonly PresetChoice[] = [
  {
    id: null,
    title: "Let the agent decide",
    tag: "Default",
    line: "It reads what you wrote and picks: an Android app, a web page, both, or a game. It tells you which in its first reply, and you can change it by just saying so.",
  },
  {
    id: "react-native",
    title: "React Native",
    line: "Can come to iPhone later, and can get quick updates without a new install later on. Apps are bigger (about 55 MB).",
  },
  {
    id: "kotlin",
    title: "Kotlin",
    line: "Fully native Android, smaller and faster apps (a few MB). Android only.",
  },
  {
    id: "game",
    title: "Game",
    line: "A game in Kotlin, small and fast (a few MB), with touch buttons, sound and a pause menu built in. Android today, made ready for iPhone and the web later.",
  },
  {
    id: "expo-exact",
    title: "Expo Exact",
    tag: "Alpha",
    line: "One app for Android, iPhone, Mac and the web. Very new and may break. Apps are about 28 MB, and the first build takes about 7 minutes.",
  },
];
