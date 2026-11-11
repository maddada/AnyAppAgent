// AI (Claude or OpenRouter) through AnyAppAgent. The person adds their AI key once, in
// AnyAppAgent's Settings; every app made with AnyAppAgent can then use it. This app never sees
// the key: requests go to AnyAppAgent on the same phone, which adds the key, counts usage and
// lets the person switch AI off per app. Usage: AGENTS.md, "AI".
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { AiNative } from '../../modules/ai';

// ---------- types ----------

/** JSON Schema for a tool's input, e.g. { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }. */
export type JsonSchema = Record<string, unknown>;

export type AiPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; isError?: boolean }
  /** Provider data that must be sent back unchanged (for example the model's hidden thinking). */
  | { type: 'opaque'; provider: string; block: unknown };

export type AiMessage = { role: 'user' | 'assistant'; content: string | AiPart[] };

export type AiToolSpec = { name: string; description: string; parameters: JsonSchema };

export type AiTool<I = any> = AiToolSpec & {
  /** Runs the tool. Return anything JSON-able (or a string); throw to report an error to the AI. */
  run: (input: I) => unknown | Promise<unknown>;
};

export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiStopReason = 'end' | 'tool_calls' | 'max_tokens' | 'refusal' | 'other';

export type AiReply = {
  /** All text of the answer. */
  text: string;
  /** Tools the AI wants to run (only when stopReason is 'tool_calls'). */
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  /** The answer as a message, to append to `messages` for the next turn. */
  message: AiMessage;
  stopReason: AiStopReason;
  usage: AiUsage;
};

/**
 * Why AI is not available. Show <AiSetupNotice status={...} /> for these.
 * - not_set_up: no AI key in AnyAppAgent yet
 * - app_off: the person switched AI off for this app in AnyAppAgent
 * - no_anyappagent: AnyAppAgent is not on this phone
 * - not_reachable / not_allowed: AnyAppAgent could not be reached or refused this app
 */
export type AiNotReadyReason = 'not_set_up' | 'app_off' | 'no_anyappagent' | 'not_reachable' | 'not_allowed';

export type AiStatus = { ready: true; provider: string; model: string } | { ready: false; reason: AiNotReadyReason };

/**
 * code: one of AiNotReadyReason, or 'bad_key', 'no_credit', 'busy', 'limit' (too many calls in a
 * minute), 'network', 'bad_request', 'too_big', 'cancelled', 'disconnected', 'internal'.
 */
export class AiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AiError';
  }
  /** True when the fix is in AnyAppAgent (add a key, switch the app on): show AiSetupNotice. */
  get needsSetup(): boolean {
    return ['not_set_up', 'app_off', 'no_anyappagent', 'not_allowed', 'bad_key', 'no_credit'].includes(this.code);
  }
}

// ---------- status and setup ----------

/** Whether AI can be used right now, and if not, why. Never throws. */
export async function aiStatus(): Promise<AiStatus> {
  try {
    const s = JSON.parse(await AiNative.status());
    if (s.ready) return { ready: true, provider: String(s.provider ?? ''), model: String(s.model ?? '') };
    return { ready: false, reason: (s.reason ?? 'not_reachable') as AiNotReadyReason };
  } catch {
    return { ready: false, reason: 'not_reachable' };
  }
}

/** The status, refreshed whenever the app comes back to the front (after the person added a key). */
export function useAiStatus(): { status: AiStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const refresh = useCallback(() => {
    aiStatus().then(setStatus, () => setStatus({ ready: false, reason: 'not_reachable' }));
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  return { status, refresh };
}

/** Opens AnyAppAgent's settings, where the AI key is added and each app is switched on or off. */
export function openAiSetup(): boolean {
  return AiNative.openSetup();
}

/** Plain words for a person, for any AiError code or AiNotReadyReason. */
export function aiProblemText(code: string): string {
  switch (code) {
    case 'not_set_up':
      return 'AI is not set up: open AnyAppAgent to add a key.';
    case 'app_off':
      return 'AI is switched off for this app in AnyAppAgent.';
    case 'no_anyappagent':
      return 'AI needs the AnyAppAgent app on this phone.';
    case 'not_allowed':
      return 'AnyAppAgent did not let this app use AI.';
    case 'bad_key':
      return 'The AI key was not accepted. Check it in AnyAppAgent.';
    case 'no_credit':
      return 'The AI account is out of credit.';
    case 'busy':
      return 'The AI is busy right now. Try again in a moment.';
    case 'limit':
      return 'Too many AI requests in a short time. Wait a moment.';
    case 'network':
      return 'No connection to the AI. Check the internet.';
    default:
      return 'The AI could not answer. Try again.';
  }
}

// ---------- one turn ----------

let counter = 0;
type Handler = (ev: any) => void;
const handlers = new Map<string, Handler>();
let subscribed = false;

function listen() {
  if (subscribed) return;
  subscribed = true;
  AiNative.addListener('onEvent', ({ id, json }) => {
    const h = handlers.get(id);
    if (!h) return;
    try {
      h(JSON.parse(json));
    } catch {
      // ignore a malformed event
    }
  });
}

/**
 * One AI turn, streamed. Resolves when the answer is complete; `onText` gets the text as it
 * arrives. Throws AiError (check `err.needsSetup`). To continue the conversation, append
 * `reply.message` to your messages, then the next user message (or tool results).
 */
export function chat(opts: {
  messages: AiMessage[];
  system?: string;
  tools?: AiToolSpec[];
  /** Default 8192, at most 32000. */
  maxTokens?: number;
  onText?: (piece: string) => void;
  signal?: AbortSignal;
}): Promise<AiReply> {
  listen();
  const id = `${Date.now().toString(36)}-${++counter}`;
  const request = JSON.stringify({
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })),
    maxTokens: opts.maxTokens,
  });
  return new Promise<AiReply>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new AiError('cancelled', 'Stopped.'));
    const parts: AiPart[] = [];
    let text = '';
    const finish = () => {
      handlers.delete(id);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => AiNative.cancel(id);
    opts.signal?.addEventListener('abort', onAbort);
    handlers.set(id, (ev) => {
      if (ev.type === 'text') {
        text += ev.text;
        opts.onText?.(ev.text);
      } else if (ev.type === 'part') {
        parts.push(ev.part as AiPart);
      } else if (ev.type === 'done') {
        finish();
        const toolCalls = parts.flatMap((p) => (p.type === 'tool_call' ? [{ id: p.id, name: p.name, input: p.input ?? {} }] : []));
        resolve({
          text,
          toolCalls,
          message: { role: 'assistant', content: parts },
          stopReason: ev.stopReason ?? 'other',
          usage: { inputTokens: ev.usage?.inputTokens ?? 0, outputTokens: ev.usage?.outputTokens ?? 0 },
        });
      } else if (ev.type === 'error') {
        finish();
        reject(new AiError(String(ev.code ?? 'internal'), String(ev.message ?? 'The AI could not answer.')));
      }
    });
    AiNative.start(id, request).catch(() => {
      finish();
      reject(new AiError('not_reachable', 'Could not reach AnyAppAgent.'));
    });
  });
}

/** Asks one question, returns the answer text. */
export async function ask(prompt: string, opts: { system?: string; onText?: (piece: string) => void; signal?: AbortSignal } = {}): Promise<string> {
  const reply = await chat({ ...opts, messages: [{ role: 'user', content: prompt }] });
  return reply.text;
}

/** An image for a user message, from base64 data (no "data:" prefix). Keep it under ~4 MB. */
export function imagePart(data: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg'): AiPart {
  return { type: 'image', mediaType, data };
}

// ---------- agent loop ----------

/**
 * Runs an agent: the AI answers, calls your tools when it needs them, gets their results, and
 * continues until it is done (or `maxSteps` AI turns). Returns the final text and the whole
 * conversation (keep `messages` to continue later).
 */
export async function runAgent(opts: {
  /** The conversation so far, or just a prompt. */
  messages?: AiMessage[];
  prompt?: string;
  system?: string;
  tools: AiTool[];
  /** AI turns before stopping. Default 8. */
  maxSteps?: number;
  maxTokens?: number;
  onText?: (piece: string) => void;
  /** Called before each tool runs (to show "Looking up the weather..."). */
  onToolCall?: (call: { name: string; input: Record<string, unknown> }) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; messages: AiMessage[]; steps: number; usage: AiUsage; stopReason: AiStopReason }> {
  const messages: AiMessage[] = [...(opts.messages ?? [])];
  if (opts.prompt) messages.push({ role: 'user', content: opts.prompt });
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
  const maxSteps = opts.maxSteps ?? 8;
  let last: AiReply | null = null;
  let steps = 0;
  while (steps < maxSteps) {
    steps++;
    last = await chat({
      messages,
      system: opts.system,
      tools: opts.tools,
      maxTokens: opts.maxTokens,
      onText: opts.onText,
      signal: opts.signal,
    });
    usage.inputTokens += last.usage.inputTokens;
    usage.outputTokens += last.usage.outputTokens;
    messages.push(last.message);
    if (last.stopReason !== 'tool_calls' || last.toolCalls.length === 0) break;
    const results: AiPart[] = [];
    for (const call of last.toolCalls) {
      opts.onToolCall?.(call);
      const tool = byName.get(call.name);
      if (!tool) {
        results.push({ type: 'tool_result', id: call.id, content: `No tool named ${call.name}.`, isError: true });
        continue;
      }
      try {
        const out = await tool.run(call.input);
        results.push({ type: 'tool_result', id: call.id, content: typeof out === 'string' ? out : JSON.stringify(out ?? null) });
      } catch (e) {
        results.push({ type: 'tool_result', id: call.id, content: e instanceof Error ? e.message : String(e), isError: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: last?.text ?? '', messages, steps, usage, stopReason: last?.stopReason ?? 'other' };
}
