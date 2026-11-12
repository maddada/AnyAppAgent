# modules/ai: AI through Kiwimake

Apps never hold an AI key. The person adds one key (Claude or OpenRouter) in Kiwimake's
Settings. Kiwimake (`com.anyappagent`) runs a local, bound Android service; this module binds
to it, sends chat requests and gets the answer streamed back. The JavaScript API for app code is
`src/lib/ai.ts` (documented in `AGENTS.md`, "AI"); this file is the contract under it.

## Who may use the service

Kiwimake's `AiProxyService` (in `app/modules/anyapp-ai` of the Kiwimake repository) checks
every message by the sender's UID, which Android attaches to each Binder call and the sender
cannot fake. It answers only apps signed with the same certificate as an app Kiwimake installed
itself, which is the PC's signing key (`builder/lib/keystore.mjs`), so every app made with
Kiwimake and nothing else. Per app it also enforces an on/off switch the person controls,
3 requests at once, about 30 a minute, and a cap on `maxTokens` (32000), and counts calls and
tokens for the usage view.

## Transport (Messenger)

Bind: `Intent("com.anyappagent.action.AI").setPackage("com.anyappagent")`. The manifest declares a
`<queries>` entry for that package (Android 11 package visibility).

| what | direction | data |
| ---: | --- | --- |
| 1 `STATUS` | app to Kiwimake | none; reply 101 |
| 2 `CHAT` | app to Kiwimake | `id`, `chunk` (part of the request JSON, up to 200 000 chars), `last` |
| 3 `CANCEL` | app to Kiwimake | `id` |
| 101 `STATUS_REPLY` | Kiwimake to app | `json`: `{ ready, reason?, provider?, model? }` |
| 102 `EVENT` | Kiwimake to app | `id`, `json`: one event |

`reason`: `not_set_up`, `app_off`, `not_allowed`. The module adds `no_anyappagent` and
`not_reachable` when it cannot bind.

## Wire format (neutral, the same for both providers)

Request:

```json
{
  "system": "optional system prompt",
  "messages": [{ "role": "user" | "assistant", "content": "text" | [Part] }],
  "tools": [{ "name": "...", "description": "...", "parameters": { "type": "object" } }],
  "maxTokens": 8192
}
```

Part: `{type:"text",text}`, `{type:"image",mediaType,data}` (base64),
`{type:"tool_call",id,name,input}` (assistant), `{type:"tool_result",id,content,isError?}` (user),
`{type:"opaque",provider,block}` (assistant; provider data such as Claude's thinking blocks, sent
back unchanged on the next turn and dropped for the other provider).

Events, in order: any number of `{type:"text",text}` (pieces of the answer as they arrive) and
`{type:"part",part}` (each finished part of the answer, in order: append them all as the assistant
message), then exactly one of `{type:"done",stopReason,usage:{inputTokens,outputTokens}}`
(`stopReason`: `end`, `tool_calls`, `max_tokens`, `refusal`, `other`) or
`{type:"error",code,message}`.

The model is chosen by the person in Kiwimake (defaults: `claude-opus-5-5` for Claude,
`anthropic/claude-opus-5.5` for OpenRouter); the app cannot pick it.
