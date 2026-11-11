// The person's own to-do list per app (shared/protocol.ts "To-do"): todos/<appId>.json under the
// state dir. It lives only here, so the app's agent never sees it (not in its prompt, repo or tools).
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { TodoItem } from "../../shared/protocol.ts";
import { nowIso, readJson, writeJsonAtomic } from "./fs-util.ts";

export const MAX_TODO_LENGTH = 500;
export const MAX_TODOS = 300;

/** One line, trimmed and capped; "" when nothing is left. */
export function cleanTodoText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TODO_LENGTH);
}

export class TodoLists {
  private readonly dir: string;
  private readonly lists = new Map<string, TodoItem[]>();

  constructor(stateDir: string) {
    this.dir = join(stateDir, "todos");
  }

  private path(appId: string): string {
    return join(this.dir, `${appId}.json`);
  }

  list(appId: string): TodoItem[] {
    let items = this.lists.get(appId);
    if (!items) {
      items = readJson<TodoItem[]>(this.path(appId), []);
      this.lists.set(appId, items);
    }
    return items;
  }

  openCount(appId: string): number {
    return this.list(appId).filter((item) => !item.done).length;
  }

  find(appId: string, todoId: string): TodoItem | undefined {
    return this.list(appId).find((item) => item.id === todoId);
  }

  /** Returns null when the list is full. */
  add(appId: string, text: string): TodoItem | null {
    const items = this.list(appId);
    if (items.length >= MAX_TODOS) return null;
    const now = nowIso();
    const item: TodoItem = { id: randomUUID(), text, done: false, createdAt: now, updatedAt: now };
    items.push(item);
    this.save(appId);
    return item;
  }

  update(appId: string, todoId: string, change: { done?: boolean; text?: string; sentAt?: string }): TodoItem | undefined {
    const item = this.find(appId, todoId);
    if (!item) return undefined;
    if (change.done !== undefined) item.done = change.done;
    if (change.text !== undefined) item.text = change.text;
    if (change.sentAt !== undefined) item.sentAt = change.sentAt;
    item.updatedAt = nowIso();
    this.save(appId);
    return item;
  }

  remove(appId: string, todoId: string): boolean {
    const items = this.list(appId);
    const index = items.findIndex((item) => item.id === todoId);
    if (index < 0) return false;
    items.splice(index, 1);
    this.save(appId);
    return true;
  }

  private save(appId: string): void {
    writeJsonAtomic(this.path(appId), this.list(appId));
  }
}
