// Native side of src/lib/diary.ts and src/lib/crash.ts. Use those, not this file.
import { requireOptionalNativeModule } from 'expo';

type AnyappDiaryNative = {
  note(text: string): void;
  /** JSON array of { at, text }, oldest first. */
  read(max: number): string;
  /** JSON { kind, message, stack?, screen? }; false when nobody can receive it (not installed by Kiwimake). */
  report(json: string, fatal: boolean): boolean;
};

export const DiaryNative = requireOptionalNativeModule<AnyappDiaryNative>('AnyappDiary');
