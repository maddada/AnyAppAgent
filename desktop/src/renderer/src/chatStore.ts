// The desktop's chat cache: each app's timeline (merged with the shared core, shared/chat/items.ts)
// and its unsent draft, kept while the user moves between apps. Live items arrive over the main
// process's companion socket (window.anyapp.onChatItem), the history over HTTP.
import { useEffect, useSyncExternalStore } from "react";
import type { ChatItem } from "../../shared/types.ts";
import { Drafts, mergeItems, replaceHistory } from "../../../../shared/chat/index.ts";
import type { Attachment } from "./pictures.ts";

interface Entry {
  items: ChatItem[];
  loaded: boolean;
  error?: string;
}

const EMPTY: Entry = { items: [], loaded: false };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();
let wired = false;

export const drafts = new Drafts<Attachment>();
/** Fires "set" (detail: appId) when a draft is set from outside the composer (Open in chat). */
export const draftSet = new EventTarget();

function set(appId: string, entry: Entry) {
  entries.set(appId, entry);
  for (const l of listeners) l();
}

function wire() {
  if (wired) return;
  wired = true;
  window.anyapp.onChatItem((item) => {
    const e = entries.get(item.appId) ?? EMPTY;
    set(item.appId, { ...e, items: mergeItems(e.items, [item]) });
  });
}

/** Loads (or reloads) an app's history; the newer live items that arrived meanwhile are kept. */
export function loadChat(appId: string): Promise<void> {
  wire();
  const running = loading.get(appId);
  if (running) return running;
  const p = window.anyapp
    .getMessages(appId)
    .then((history) => {
      const e = entries.get(appId) ?? EMPTY;
      set(appId, { items: replaceHistory(e.items, history ?? []), loaded: true });
    })
    .catch((error: unknown) => {
      const e = entries.get(appId) ?? EMPTY;
      const message = String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      set(appId, { ...e, error: /fetch failed|ECONNREFUSED|aborted|timeout/i.test(message) ? "Can't reach the companion on this PC right now. Trying again." : message });
      throw error;
    })
    .finally(() => loading.delete(appId));
  loading.set(appId, p);
  return p;
}

/** One app's timeline, loading it (and retrying by itself: 2, 4, 8, then every 15 s) until it arrives. */
export function useChat(appId: string, online: boolean): Entry {
  wire();
  const entry = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => entries.get(appId) ?? EMPTY,
  );
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      loadChat(appId).catch(() => {
        if (!cancelled) timer = setTimeout(() => attempt(n + 1), [2000, 4000, 8000][n] ?? 15000);
      });
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [appId, online]);
  return entry;
}
