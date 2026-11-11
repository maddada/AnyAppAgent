// "Point at it" feedback, built into every app: shaking the phone opens a screen over a
// screenshot where the person drags numbered arrows (#1, #2, ...) and writes notes; Save copies
// the picture and keeps it in the gallery's "Feedback" album. It works with no code at all.
// This only adds a way to open it from a button as well, for example in a settings screen.
import { requireOptionalNativeModule } from 'expo';

const native = requireOptionalNativeModule<{ open(): boolean }>('AnyappFeedback');

/** Opens the feedback screen over the current screen, as a shake does. */
export function openFeedback(): boolean {
  return native?.open() ?? false;
}
