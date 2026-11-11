// Turns ACP `session/update` notifications into AnyAppAgent ChatItems. Modelled on bb's
// packages/provider-bridge-acp/src/delta-translation.ts (MIT, see THIRD_PARTY_NOTICES.md):
// assistant and thought text stream into one item until something else happens (bb's
// closeThoughtStream/closeAssistantStream), tool_call opens an item that tool_call_update
// merges into (bb's mergeAcpToolCallEvents), a terminal status closes it, `plan` replaces the
// plan, and the end of a turn drains whatever is still open (bb's flushOpenTurnWork).
import type { ChatItem, PlanEntry, ToolCallInfo } from "../../../shared/protocol.ts";
import { isJsonObject, readString, type JsonObject } from "./acp-client.ts";

export type ChatDraft = Pick<ChatItem, "id" | "kind"> &
  Partial<Pick<ChatItem, "text" | "streaming" | "tool" | "plan" | "permission">>;

const TOOL_KINDS = new Set(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"]);
const DETAIL_MAX = 400;

interface OpenTool {
  id: string;
  event: JsonObject;
}

function contentText(content: unknown): string | undefined {
  if (!isJsonObject(content)) return undefined;
  return content["type"] === "text" && typeof content["text"] === "string" ? content["text"] : undefined;
}

export function mergeToolCallEvents(started: JsonObject | undefined, update: JsonObject): JsonObject {
  if (!started) return { ...update };
  const merged: JsonObject = { ...started };
  for (const key of ["kind", "title", "name", "status", "content", "locations", "rawInput", "rawOutput"]) {
    if (update[key] !== undefined && update[key] !== null) merged[key] = update[key];
  }
  return merged;
}

function shorten(text: string, max = DETAIL_MAX): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function relativeTo(cwd: string, path: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const base = norm(cwd).replace(/\/$/, "");
  const full = norm(path);
  return full.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? full.slice(base.length + 1) : full;
}

function toolContentText(event: JsonObject): string | undefined {
  const content = event["content"];
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const entry of content) {
    if (!isJsonObject(entry)) continue;
    if (entry["type"] === "content") {
      const text = contentText(entry["content"]);
      if (text) parts.push(text);
    } else if (entry["type"] === "diff" && typeof entry["path"] === "string") {
      parts.push(`diff ${entry["path"]}`);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

const COMMAND_TITLES: [RegExp, string][] = [
  [/npm run check\b/, "Checked the app"],
  [/npm run (typecheck|lint)\b|\btsc\b|\beslint\b/, "Checked the app"],
  [/npm run bundle\b|expo export/, "Checked that the app packs up"],
  [/npm run icon\b|make-icon/, "Made the app icon"],
  [/npx expo install\b|\bnpm (install|i)\b/, "Added a part to the app"],
  [/\bgit\b/, "Looked at the app's history"],
  [/\b(curl|wget|Invoke-WebRequest)\b/, "Downloaded something"],
  [/\b(ls|dir|cat|head|tail|grep|rg|find|Get-ChildItem|Get-Content|Select-String)\b/, "Looked at the app's files"],
  [/\bnode\b/, "Ran a small script"],
];

/**
 * A short plain title for a command row (the person on the phone is not technical); the raw
 * command line stays in the row's detail. Uses the description Claude Code gives its own
 * command when there is one.
 */
export function plainCommandTitle(command: string | undefined, description: string | undefined): string {
  const said = description?.trim();
  if (said) return shorten(said.charAt(0).toUpperCase() + said.slice(1).replace(/\.$/, ""), 80);
  if (!command) return "Running a command";
  for (const [pattern, title] of COMMAND_TITLES) if (pattern.test(command)) return title;
  return "Ran a command";
}

/** The last part of a path, whichever slash it uses. */
function fileName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** A title that still carries a path, a command or code formatting is not for the person. */
function looksTechnical(title: string): boolean {
  return /[\\/`]|^[a-z_]+$|\b(Bash|Grep|Glob|TodoWrite|mcp__)\b/.test(title);
}

/**
 * A short plain title for any tool row (the person on the phone is not technical). File rows
 * name the file only ("Changed App.tsx"); raw commands, patterns, URLs and full paths stay in
 * the row's detail.
 */
export function plainToolTitle(kind: string, event: JsonObject, input: JsonObject, path: string | undefined): string {
  const raw = (readString(event, "title") ?? readString(event, "name") ?? "").trim();
  const file = path ? fileName(path) : undefined;
  switch (kind) {
    case "execute":
      return plainCommandTitle(readString(input, "command"), readString(input, "description"));
    case "search":
      return "Searched the app";
    case "read":
      return file ? `Read ${file}` : "Read a file";
    case "edit":
      if (!file) return "Changed a file";
      return /^(Write|Create)\b/i.test(raw) && !/^Edit/i.test(raw) ? `Wrote ${file}` : `Changed ${file}`;
    case "delete":
      return file ? `Removed ${file}` : "Removed a file";
    case "move":
      return file ? `Moved ${file}` : "Moved a file";
    case "fetch":
      return "Looked something up online";
    case "think":
      return raw && !looksTechnical(raw) ? raw : "Thought it through";
    case "switch_mode":
      return "Changed how it works";
    default:
      return raw && !looksTechnical(raw) ? shorten(raw, 80) : "Used a tool";
  }
}

export function toolInfo(event: JsonObject, cwd: string): ToolCallInfo {
  const rawKind = readString(event, "kind") ?? "other";
  const kind = TOOL_KINDS.has(rawKind) ? rawKind : "other";
  const rawStatus = readString(event, "status");
  const status: ToolCallInfo["status"] =
    rawStatus === "in_progress" || rawStatus === "completed" || rawStatus === "failed" ? rawStatus : "pending";
  const input = isJsonObject(event["rawInput"]) ? event["rawInput"] : {};
  const locations = Array.isArray(event["locations"]) ? event["locations"] : [];
  const firstPath = locations.map((l) => (isJsonObject(l) ? readString(l, "path") : undefined)).find(Boolean);
  const path = firstPath ?? readString(input, "file_path") ?? readString(input, "path") ?? readString(input, "notebook_path");
  const title = plainToolTitle(kind, event, input, path);
  let detail: string | undefined;
  if (kind === "execute") {
    detail = readString(input, "command");
  } else if (kind === "fetch") {
    detail = readString(input, "url") ?? readString(input, "query");
  } else if (kind === "search") {
    const pattern = readString(input, "pattern") ?? readString(input, "query");
    detail = pattern && path ? `${pattern} in ${relativeTo(cwd, path)}` : pattern;
  } else {
    detail = path ? relativeTo(cwd, path) : undefined;
  }
  if (detail === undefined && status === "failed") detail = toolContentText(event);
  if (detail !== undefined && title.endsWith(detail)) detail = undefined;
  return { title, kind, status, ...(detail ? { detail: shorten(detail) } : {}) };
}

export class ChatTranslator {
  private readonly cwd: string;
  private readonly newId: () => string;
  private assistant: { id: string; text: string } | undefined;
  private thought: { id: string; text: string } | undefined;
  private readonly openTools = new Map<string, OpenTool>();
  private planId: string | undefined;
  private turnText = "";

  constructor(options: { cwd: string; newId: () => string }) {
    this.cwd = options.cwd;
    this.newId = options.newId;
  }

  /** Text the agent said in the current turn, for the app's lastMessagePreview. */
  get lastTurnText(): string {
    return this.turnText;
  }

  startTurn(): void {
    this.planId = undefined;
    this.turnText = "";
  }

  private closeThought(): ChatDraft[] {
    if (!this.thought) return [];
    const closed: ChatDraft = { id: this.thought.id, kind: "thought", text: this.thought.text, streaming: false };
    this.thought = undefined;
    return [closed];
  }

  private closeAssistant(): ChatDraft[] {
    if (!this.assistant) return [];
    const closed: ChatDraft = { id: this.assistant.id, kind: "assistant", text: this.assistant.text, streaming: false };
    this.assistant = undefined;
    return [closed];
  }

  /** Closes the open assistant and thought text, as a tool call does (for tool calls not shown). */
  closeStreams(): ChatDraft[] {
    return [...this.closeThought(), ...this.closeAssistant()];
  }

  translate(update: unknown): ChatDraft[] {
    if (!isJsonObject(update)) return [];
    switch (update["sessionUpdate"]) {
      case "agent_message_chunk": {
        const text = contentText(update["content"]);
        if (text === undefined) return [];
        const out = this.closeThought();
        this.assistant ??= { id: this.newId(), text: "" };
        this.assistant.text += text;
        this.turnText = this.assistant.text;
        out.push({ id: this.assistant.id, kind: "assistant", text: this.assistant.text, streaming: true });
        return out;
      }
      case "agent_thought_chunk": {
        const text = contentText(update["content"]);
        if (text === undefined) return [];
        const out = this.closeAssistant();
        this.thought ??= { id: this.newId(), text: "" };
        this.thought.text += text;
        out.push({ id: this.thought.id, kind: "thought", text: this.thought.text, streaming: true });
        return out;
      }
      case "tool_call": {
        const toolCallId = readString(update, "toolCallId");
        if (toolCallId === undefined) return [];
        const out = [...this.closeThought(), ...this.closeAssistant()];
        const existing = this.openTools.get(toolCallId);
        const event = mergeToolCallEvents(existing?.event, update);
        const id = existing?.id ?? this.newId();
        const tool = toolInfo(event, this.cwd);
        if (tool.status === "completed" || tool.status === "failed") this.openTools.delete(toolCallId);
        else this.openTools.set(toolCallId, { id, event });
        out.push({ id, kind: "tool", tool });
        return out;
      }
      case "tool_call_update": {
        const toolCallId = readString(update, "toolCallId");
        if (toolCallId === undefined) return [];
        const open = this.openTools.get(toolCallId);
        const event = mergeToolCallEvents(open?.event, update);
        const id = open?.id ?? this.newId();
        const tool = toolInfo(event, this.cwd);
        if (tool.status === "completed" || tool.status === "failed") this.openTools.delete(toolCallId);
        else this.openTools.set(toolCallId, { id, event });
        return [{ id, kind: "tool", tool }];
      }
      case "plan": {
        const entries = update["entries"];
        if (!Array.isArray(entries)) return [];
        const plan: PlanEntry[] = [];
        for (const entry of entries) {
          if (!isJsonObject(entry) || typeof entry["content"] !== "string") continue;
          const status = entry["status"];
          plan.push({
            content: entry["content"],
            status: status === "in_progress" || status === "completed" ? status : "pending",
          });
        }
        this.planId ??= this.newId();
        return [{ id: this.planId, kind: "plan", plan }];
      }
      default:
        return [];
    }
  }

  /** bb's flushOpenTurnWork: close streams and every open tool call when the turn ends. */
  finishTurn(stopReason: string): ChatDraft[] {
    const out = [...this.closeThought(), ...this.closeAssistant()];
    const status: ToolCallInfo["status"] = stopReason === "end_turn" ? "completed" : "failed";
    for (const open of this.openTools.values()) {
      out.push({ id: open.id, kind: "tool", tool: { ...toolInfo(open.event, this.cwd), status } });
    }
    this.openTools.clear();
    return out;
  }
}
