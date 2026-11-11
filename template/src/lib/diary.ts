// The app's diary: a small private log on the phone of what the app did ("Asr alarm set for 15:42",
// "Reminders loaded: 3"), so when something does not work the agent can read what really happened.
// It stays on the phone and the person's own PC (AnyAppAgent sends it only when the agent asks).
//
//   import { diary } from '@/lib/diary';
//   diary('Fajr alarm set for 05:12');
//
// Write what the app did and why, never personal content: no names, messages, places, health data,
// or anything the person typed. One short line (at most 200 characters). Never throws.
import { DiaryNative } from '../../modules/diary';

export type DiaryNote = { at: string; text: string };

export function diary(text: string): void {
  try {
    DiaryNative?.note(String(text));
  } catch {
    // the diary must never break the app
  }
}

/** The newest notes, oldest first (for a "what happened" screen, if the app wants one). */
export function readDiary(max = 100): DiaryNote[] {
  try {
    return JSON.parse(DiaryNative?.read(max) ?? '[]') as DiaryNote[];
  } catch {
    return [];
  }
}
