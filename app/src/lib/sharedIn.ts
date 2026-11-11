// "Like this, but mine" (C:\aa\ideas\ideas.html, Q15): a screenshot, a picture or a link shared
// into AnyAppAgent from another app's share sheet. The native side copies the pictures into the
// cache (modules/anyapp-native, ShareFiles.kt); this keeps the newest share until it is sent or
// dropped, and opens the screen for it (src/app/like-this.tsx).
import { router } from "expo-router";
import { create } from "zustand";
import { AnyAppNative, type SharedItem } from "anyapp-native";
import { takeSharedSuggestion } from "./suggestions";

export const useSharedIn = create<{ item: SharedItem | null }>(() => ({ item: null }));

let listening = false;

/** Reads a share AnyAppAgent was opened with or received while running, and opens its screen. */
export async function takeShare(): Promise<void> {
  if (!AnyAppNative?.takeSharedItem) return;
  if (!listening) {
    listening = true;
    AnyAppNative.addListener("onShareIn", () => void takeShare());
  }
  let item: SharedItem | null = null;
  try {
    item = await AnyAppNative.takeSharedItem();
  } catch (e) {
    console.log(`share in: could not read it (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!item) return;
  console.log(`share in: ${item.pictures.length} picture(s), ${item.text ? "text" : "no text"}, ${item.skipped} skipped`);
  // A suggestion someone sent about one of this person's apps ("Change this app",
  // docs/CHANGE-THIS-APP.md): filed in that app's From others, not "Like this, but mine".
  if (item.pictures.length === 0 && item.text && (await takeSharedSuggestion(item.text))) return;
  useSharedIn.setState({ item });
  router.push("/like-this");
}

export function dropShare(): void {
  useSharedIn.setState({ item: null });
}

/** The first web link in the shared text, without trailing punctuation. */
export function sharedLink(item: SharedItem | null): string | null {
  const match = item?.text?.match(/https?:\/\/[^\s<>"]+/i);
  return match ? match[0].replace(/[).,;:!?\]]+$/, "") : null;
}

/** The message the agent and the chat get: the person's words, then the link (or the shared text). */
export function shareMessage(item: SharedItem, words: string, newApp: boolean): string {
  const link = sharedLink(item);
  const said = words.trim() || (newApp ? "Make me an app like this one." : "Make it more like this.");
  const parts = [said];
  if (link) parts.push(`Link: ${link}`);
  else if (item.text) parts.push(`Shared text: ${item.text.slice(0, 2000)}`);
  return parts.join("\n\n");
}
