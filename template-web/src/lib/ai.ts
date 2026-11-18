// AI (Claude or OpenRouter) through Kiwimake. The person adds their AI key once, in Kiwimake's
// Settings. Inside Kiwimake on the phone this app asks Kiwimake, which adds the key, counts usage
// and lets the person switch AI off per app; this app never sees the key. In a plain browser there
// is no AI: show <AiSetupNotice> ("Open this in Kiwimake to use AI"). Usage: AGENTS.md, "AI".
import { useCallback, useEffect, useState } from 'react';

import { kiwimake } from './kiwimake';

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
 * - no_kiwimake: opened in a plain browser, not inside Kiwimake
 * - not_set_up: no AI key in Kiwimake yet
 * - app_off: the person switched AI off for this app in Kiwimake
 * - not_reachable: Kiwimake did not answer
 */
export type AiNotReadyReason = 'no_kiwimake' | 'not_set_up' | 'app_off' | 'not_reachable';

export type AiStatus = { ready: true; provider: string; model: string } | { ready: false; reason: AiNotReadyReason };

/**
 * code: one of AiNotReadyReason, or 'bad_key', 'no_credit', 'busy', 'limit' (too many calls in a
 * minute), 'network', 'bad_request', 'too_big', 'cancelled', 'internal'.
 */
export class AiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AiError';
  }
  /** True when the fix is in Kiwimake (open the app there, add a key, switch it on): show AiSetupNotice. */
  get needsSetup(): boolean {
    return ['no_kiwimake', 'not_set_up', 'app_off', 'bad_key', 'no_credit'].includes(this.code);
  }
}

// ---------- status and setup ----------

/** Whether AI can be used right now, and if not, why. Never throws. */
export async function aiStatus(): Promise<AiStatus> {
  const k = kiwimake();
  if (!k) return { ready: false, reason: 'no_kiwimake' };
  try {
    const s = await k.ai.status();
    if (s?.ready) return { ready: true, provider: String(s.provider ?? ''), model: String(s.model ?? '') };
    const reason = s?.reason === 'not_set_up' || s?.reason === 'app_off' ? s.reason : 'not_reachable';
    return { ready: false, reason };
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
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);
  return { status, refresh };
}

/** Plain words for a person, for any AiError code or AiNotReadyReason. */
export function aiProblemText(code: string): string {
  switch (code) {
    case 'no_kiwimake':
      return 'Open this in Kiwimake to use AI.';
    case 'not_set_up':
      return 'AI is not set up yet: add a key in Kiwimake, under Settings.';
    case 'app_off':
      return 'AI is switched off for this app in Kiwimake.';
    case 'not_reachable':
      return 'Kiwimake did not answer. Try again in a moment.';
    case 'bad_key':
      return 'The AI key was not accepted. Check it in Kiwimake.';
    case 'no_credit':
      return 'The AI account is out of credit.';
    case 'busy':
      return 'The AI is busy right now. Try again in a moment.';
    case 'limit':
      return 'Too many AI requests in a short time. Wait a moment.';
    case 'network':
      return 'No connection to the AI. Check the internet.';
    case 'cancelled':
      return 'Stopped.';
    default:
      return 'The AI could not answer. Try again.';
  }
}

// ---------- one turn ----------

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
  const k = kiwimake();
  if (!k) return Promise.reject(new AiError('no_kiwimake', aiProblemText('no_kiwimake')));
  const request = {
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })),
    maxTokens: opts.maxTokens,
  };
  return new Promise<AiReply>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new AiError('cancelled', 'Stopped.'));
    const parts: AiPart[] = [];
    let text = '';
    let done = false;
    let handle: { cancel(): void } | null = null;
    const finish = () => {
      done = true;
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (done) return;
      finish();
      handle?.cancel();
      reject(new AiError('cancelled', 'Stopped.'));
    };
    opts.signal?.addEventListener('abort', onAbort);
    const onEvent = (raw: object) => {
      if (done) return;
      const ev = raw as { type?: string; [k: string]: any };
      if (ev.type === 'text') {
        text += String(ev.text ?? '');
        opts.onText?.(String(ev.text ?? ''));
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
    };
    try {
      handle = k.ai.chat(request, onEvent);
    } catch {
      finish();
      reject(new AiError('not_reachable', aiProblemText('not_reachable')));
    }
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

/** Reads a picked file (an <input type="file"> or a camera photo) as an image part. */
export async function imagePartFromFile(file: Blob): Promise<AiPart> {
  const url: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the picture.'));
    r.readAsDataURL(file);
  });
  const [head, data] = url.split(',', 2);
  const type = /image\/(jpeg|png|webp|gif)/.exec(head)?.[0] ?? 'image/jpeg';
  return imagePart(data ?? '', type as 'image/jpeg');
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
