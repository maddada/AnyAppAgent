// Everything the companion must remember across restarts, as JSON files under the state dir:
// apps.json (one record per app), chat/<appId>.json (its timeline), apks/<appId>/ (built APKs).
import { join } from "node:path";
import type { App, ChatItem } from "../../shared/protocol.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";
import type { ChatDraft } from "./acp/translate.ts";

export interface AppRecord {
  app: App;
  dir: string;
  sessionId?: string;
  iconStamp?: string;
  deleted?: boolean;
}

class Debounced {
  private timer: NodeJS.Timeout | undefined;
  private readonly write: () => void;
  constructor(write: () => void) {
    this.write = write;
  }
  schedule(): void {
    this.timer ??= setTimeout(() => this.flush(), 250);
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.write();
  }
}

export class ChatLog {
  readonly appId: string;
  private readonly items: ChatItem[];
  private readonly byId = new Map<string, ChatItem>();
  private nextSeq: number;
  private readonly saver: Debounced;

  constructor(appId: string, path: string) {
    this.appId = appId;
    this.items = readJson<ChatItem[]>(path, []);
    for (const item of this.items) this.byId.set(item.id, item);
    this.nextSeq = this.items.reduce((max, item) => Math.max(max, item.seq), 0) + 1;
    this.saver = new Debounced(() => writeJsonAtomic(path, this.items));
  }

  list(afterSeq = 0): ChatItem[] {
    return this.items.filter((item) => item.seq > afterSeq).sort((a, b) => a.seq - b.seq);
  }

  get(id: string): ChatItem | undefined {
    return this.byId.get(id);
  }

  all(): readonly ChatItem[] {
    return this.items;
  }

  /** Insert or update by id. A new item gets the next seq; an update keeps its seq. */
  upsert(draft: ChatDraft & Partial<Pick<ChatItem, "build">>): ChatItem {
    const now = nowIso();
    const existing = this.byId.get(draft.id);
    if (existing) {
      Object.assign(existing, draft, { updatedAt: now });
      this.saver.schedule();
      return existing;
    }
    const item: ChatItem = { ...draft, appId: this.appId, seq: this.nextSeq++, createdAt: now, updatedAt: now };
    this.items.push(item);
    this.byId.set(item.id, item);
    this.saver.schedule();
    return item;
  }

  flush(): void {
    this.saver.flush();
  }
}

export class Store {
  readonly stateDir: string;
  private readonly records: AppRecord[];
  private readonly chats = new Map<string, ChatLog>();
  private readonly saver: Debounced;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.records = readJson<AppRecord[]>(join(stateDir, "apps.json"), []);
    this.saver = new Debounced(() => writeJsonAtomic(join(stateDir, "apps.json"), this.records));
  }

  apps(): AppRecord[] {
    return this.records.filter((record) => !record.deleted);
  }

  allRecords(): readonly AppRecord[] {
    return this.records;
  }

  find(id: string): AppRecord | undefined {
    return this.records.find((record) => record.app.id === id && !record.deleted);
  }

  add(record: AppRecord): void {
    this.records.push(record);
    this.saver.flush();
  }

  save(): void {
    this.saver.schedule();
  }

  chat(appId: string): ChatLog {
    let log = this.chats.get(appId);
    if (!log) {
      log = new ChatLog(appId, join(this.stateDir, "chat", `${appId}.json`));
      this.chats.set(appId, log);
    }
    return log;
  }

  apkDir(appId: string): string {
    return join(this.stateDir, "apks", appId);
  }

  flush(): void {
    this.saver.flush();
    for (const log of this.chats.values()) log.flush();
  }
}
