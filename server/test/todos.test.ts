import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanTodoText, TodoLists } from "../src/todos.ts";

describe("TodoLists", () => {
  it("adds, ticks, removes and keeps each app's list in its own file", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-todos-"));
    const lists = new TodoLists(dir);
    const a = lists.add("app1", "Make the button green")!;
    lists.add("app1", "Bigger clock");
    lists.add("app2", "Other app");
    expect(lists.openCount("app1")).toBe(2);
    lists.update("app1", a.id, { done: true });
    expect(lists.openCount("app1")).toBe(1);
    expect(lists.remove("app1", a.id)).toBe(true);
    expect(lists.remove("app1", a.id)).toBe(false);
    const again = new TodoLists(dir);
    expect(again.list("app1").map((t) => t.text)).toEqual(["Bigger clock"]);
    expect(again.list("app2")).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, "todos", "app2.json"), "utf8"))[0].text).toBe("Other app");
  });

  it("keeps one trimmed line", () => {
    expect(cleanTodoText("  two\nlines  ")).toBe("two lines");
    expect(cleanTodoText("   ")).toBe("");
  });
});
