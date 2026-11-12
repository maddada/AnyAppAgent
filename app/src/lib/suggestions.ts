// "From others" (docs/CHANGE-THIS-APP.md): suggestions people sent the owner as text. A message
// shared into Kiwimake or pasted is recognised by its last line and filed under its app by the PC.
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { parseSuggestion, suggestionPrompt } from "@shared/chat/index";
import type { Suggestion } from "./protocol";
import { drafts, getState, setSuggestions, upsertApp } from "./store";

/** True when the text is a suggestion message (so a share-in screen can hand it here). */
export function isSuggestionText(text: string | null | undefined): boolean {
  return Boolean(text && parseSuggestion(text));
}

/**
 * Files a suggestion message with the PC, then opens that app's inbox. Throws a plain sentence when
 * it is not one, the app is not this PC's, or the PC is not reachable.
 */
export async function fileSuggestionText(text: string): Promise<{ appId: string; suggestion: Suggestion }> {
  const client = getState().client;
  if (!client) throw new Error("Connect your PC first: suggestions are kept there.");
  const r = await client.fileSuggestion(text);
  upsertApp(r.app);
  const list = await client.suggestions(r.app.id).catch(() => null);
  if (list) setSuggestions(r.app.id, list);
  console.log(`suggestions: filed one for ${r.app.packageName}`);
  return { appId: r.app.id, suggestion: r.suggestion };
}

/** "Paste a suggestion": reads the clipboard and files it. */
export async function pasteSuggestion(): Promise<{ appId: string; suggestion: Suggestion }> {
  const text = await Clipboard.getStringAsync();
  if (!parseSuggestion(text)) throw new Error("The clipboard has no suggestion in it. Copy the whole message, with its last line.");
  return fileSuggestionText(text);
}

/** Shared into Kiwimake: file it and show that app's inbox. False when the text is not a suggestion. */
export async function takeSharedSuggestion(text: string): Promise<boolean> {
  if (!isSuggestionText(text)) return false;
  try {
    const { appId } = await fileSuggestionText(text);
    router.push(`/suggestions/${appId}`);
  } catch (e) {
    console.log(`suggestions: could not file the shared one (${e instanceof Error ? e.message : String(e)})`);
    router.push({ pathname: "/suggestions/[id]", params: { id: "none", problem: e instanceof Error ? e.message : "It could not be filed." } });
  }
  return true;
}

/** "Open in chat": the suggestion's words go into the app's composer, to send or edit. */
export async function openSuggestionInChat(appId: string, s: Suggestion): Promise<void> {
  drafts.set(appId, suggestionPrompt(s));
  const client = getState().client;
  if (client && !s.opened) void client.openSuggestion(appId, s.id).catch(() => undefined);
  router.push(`/chat/${appId}`);
}
