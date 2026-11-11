// The desktop's helper cache (docs/APP-COORDINATOR.md): each app's helpers and each helper's own
// chat, merged with the shared core (shared/chat/helpers.ts, items.ts). Live updates arrive over the
// main process's companion socket; lists and histories over HTTP.
import { useEffect, useSyncExternalStore } from "react";
import type { ChatItem, WorkerInfo } from "../../shared/types.ts";
import { mergeHelpers, mergeItems, replaceHistory } from "../../../../shared/chat/index.ts";

interface HelperChat {
  items: ChatItem[];
  loaded: boolean;
  error?: string;
}

const NO_HELPERS: WorkerInfo[] = [];
const NO_CHAT: HelperChat = { items: [], loaded: false };
const helpers = new Map<string, WorkerInfo[]>();
const chats = new Map<string, HelperChat>();
const listeners = new Set<() => void>();
let wired = false;

function changed() {
  for (const l of listeners) l();
}

function wire() {
  if (wired) return;
  wired = true;
  window.anyapp.onHelper((worker) => {
    helpers.set(worker.appId, mergeHelpers(helpers.get(worker.appId) ?? [], [worker]));
    changed();
  });
  window.anyapp.onHelperItem((item) => {
    if (!item.workerId) return;
    const c = chats.get(item.workerId) ?? NO_CHAT;
    chats.set(item.workerId, { ...c, items: mergeItems(c.items, [item]) });
    changed();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** An app's helpers, loaded once when its chat opens and kept current by the socket. */
export function useHelpers(appId: string, online: boolean): WorkerInfo[] {
  wire();
  const list = useSyncExternalStore(subscribe, () => helpers.get(appId) ?? NO_HELPERS);
  useEffect(() => {
    if (!online) return;
    void window.anyapp.getHelpers(appId).then((fresh) => {
      helpers.set(appId, mergeHelpers(helpers.get(appId) ?? [], fresh ?? []));
      changed();
    });
  }, [appId, online]);
  return list;
}

/** A helper's own chat (read only), retrying by itself until its history arrives. */
export function useHelperChat(appId: string, workerId: string, online: boolean): HelperChat {
  wire();
  const chat = useSyncExternalStore(subscribe, () => chats.get(workerId) ?? NO_CHAT);
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      window.anyapp
        .getHelperMessages(appId, workerId)
        .then((history) => {
          const c = chats.get(workerId) ?? NO_CHAT;
          chats.set(workerId, { items: replaceHistory(c.items, history ?? []), loaded: true });
          changed();
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const c = chats.get(workerId) ?? NO_CHAT;
          chats.set(workerId, { ...c, error: String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
          changed();
          timer = setTimeout(() => attempt(n + 1), [2000, 4000, 8000][n] ?? 15000);
        });
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [appId, workerId, online]);
  return chat;
}
