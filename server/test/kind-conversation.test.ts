// Picking the kind in the conversation (docs/SPEC.md): the first message's note, the playbook's
// rules, and the ask_choice tool that shows a question with answers to tap.
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatItem } from "../../shared/protocol.ts";
import { AppManager } from "../src/apps.ts";
import type { Builder } from "../src/builder.ts";
import type { Config } from "../src/config.ts";
import { choiceFrom, isAskChoiceCall } from "../src/history.ts";
import { appKindSection, firstPrompt, kindNote } from "../src/playbook.ts";
import { coordinatorPlaybook } from "../src/coordinator-playbook.ts";
import { Store } from "../src/store.ts";

const EM_DASH = String.fromCharCode(0x2014);

describe("picking the kind in the conversation", () => {
  it("tells the agent whether the person picked a kind under Advanced", () => {
    const left = firstPrompt("A little space shooter", { askMore: false, planFirst: true });
    expect(left).toMatch(/^A little space shooter\n\n\(From the PC: this is a new app\. The person left the kind of app to you/);
    expect(left).toContain("one friendly sentence");
    expect(left).toContain("call set_app_kind now");
    expect(left).toContain("ask_choice");
    expect(left).toContain("Plan first");

    const picked = firstPrompt("A little space shooter", { askMore: false, planFirst: true, picked: "kotlin" });
    expect(picked).toContain('picked "Kotlin (an Android app)" under Advanced');
    expect(picked).not.toContain("ask_choice");

    // Ask me more: an unclear kind is a question on the question page, not a second question.
    expect(kindNote(undefined, true)).toContain("first question on your question page");
    // No plan first: the note still comes.
    expect(firstPrompt("A water reminder", { askMore: false, planFirst: false })).toContain("left the kind of app to you");
    for (const text of [left, picked, appKindSection()]) expect(text).not.toContain(EM_DASH);
  });

  it("the playbooks say the plan page no longer asks the kind, and never to ask a technical question", () => {
    const section = appKindSection();
    expect(section).toContain("The plan page never asks the kind again");
    expect(section).toContain("Never technical words");
    expect(section).not.toContain('switch "Web, Android or Both"');
    const coordinator = coordinatorPlaybook({ name: "Tea", packageName: "com.anyapp.tea", dir: "/x", preset: "react-native" });
    expect(coordinator).toContain("You call set_app_kind and ask_choice yourself");
  });

  it("cleans ask_choice's arguments", () => {
    expect(choiceFrom({ question: "  Is it to play,\n or to use? ", choices: ["A game", "a game", "An app on her phone", "", 3, "A page", "One more", "Too many"] })).toEqual({
      question: "Is it to play, or to use?",
      choices: ["A game", "An app on her phone", "A page", "One more"],
    });
    expect(() => choiceFrom({ question: "Which?", choices: ["Only one"] })).toThrow(/2 to 4/);
    expect(() => choiceFrom({ choices: ["A", "B"] })).toThrow(/question/);
    expect(isAskChoiceCall({ title: "mcp__app__ask_choice" })).toBe(true);
    expect(isAskChoiceCall({ title: "mcp__app__set_app_kind" })).toBe(false);
  });

  it("ask_choice shows the question with its answers in the main chat; a helper cannot use it", async () => {
    const state = mkdtempSync(join(tmpdir(), "anyapp-kind-"));
    const items: ChatItem[] = [];
    const builder: Builder = {
      kind: "fake",
      createApp: async () => {
        throw new Error("stop here");
      },
      buildApk: async () => {
        throw new Error("not used");
      },
      getIconPath: () => null,
    };
    const config = { stateDir: state, appsDir: join(state, "apps"), github: false, maxBuildFixes: 3, port: 0 } as Config;
    const apps = new AppManager({
      store: new Store(state),
      builder,
      config,
      broadcast: (event) => {
        if (event.type === "chat.item") items.push(event.item);
      },
      log: () => {},
    });
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      void apps.history.mcpRoute(req, res, url.pathname, url);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const app = apps.create("For Mom", "something for my mom");
      const port = (server.address() as { port: number }).port;
      const call = async (args: unknown, worker?: string) => {
        const res = await fetch(`http://127.0.0.1:${port}/mcp/app/${app.id}${worker ? `?worker=${worker}` : ""}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apps.history.toolsToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask_choice", arguments: args } }),
        });
        return ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
      };
      const ok = await call({ question: "What should it be?", choices: ["A game to play", "An app on her phone", "A page she opens from a link"] });
      expect(ok.isError).toBeFalsy();
      expect(ok.content[0]!.text).toMatch(/End your turn with at most one short, friendly line/);
      const shown = items.filter((i) => i.choices);
      expect(shown).toHaveLength(1);
      expect(shown[0]!.kind).toBe("assistant");
      expect(shown[0]!.choices).toEqual(["A game to play", "An app on her phone", "A page she opens from a link"]);
      // Older phones and desktops read the answers in the text.
      expect(shown[0]!.text).toBe("What should it be?\n\n- A game to play\n- An app on her phone\n- A page she opens from a link");
      // During the agent's turn it waits for the turn's end, so it comes under the agent's last words.
      const rt = (apps as unknown as { runtime(id: string): { turnActive: boolean; pendingChoice?: unknown } }).runtime(app.id);
      rt.turnActive = true;
      await call({ question: "Which one?", choices: ["This", "That"] });
      expect(items.filter((i) => i.choices)).toHaveLength(1);
      expect(rt.pendingChoice).toEqual({ question: "Which one?", choices: ["This", "That"] });
      rt.turnActive = false;
      delete rt.pendingChoice;
      const fromHelper = await call({ question: "Which?", choices: ["A", "B"] }, "w1");
      expect(fromHelper.isError).toBe(true);
      expect(items.filter((i) => i.choices)).toHaveLength(1);
    } finally {
      server.close();
      rmSync(state, { recursive: true, force: true });
    }
  });
});
