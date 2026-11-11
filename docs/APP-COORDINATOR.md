# Each app's chat is a coordinator, with helpers

The user's words: "make the app's chat adhere to ghostex-orchestrator skill and spin up sub threads
for all the work so i can keep talking to the main chat i have in front of me".

## The idea

Every app has one main chat, as before: the same Claude Code session over ACP, in the app's folder.
It is now a **coordinator**, modelled on the Ghostex coordinator playbook and cut down for one
person who is not technical: it answers at once, never edits the app itself, and hands every real
piece of work (a change, a fix, looking into a problem) to a **helper**. A helper is another Claude
Code session over ACP for the same app, started and briefed by the coordinator. The coordinator
follows its helpers, gets their reports, and tells the person plainly what finished. The person can
always keep talking to the main chat.

Words: everything the person sees says **helper**, never worker, thread or agent. The code and the
protocol say worker (`WorkerInfo`, `start_worker`); the coordinator's playbook tells it to say
"helper" to the person.

Turn it off with `ANYAPP_COORDINATOR=off` (the old one-session flow, used by `scripts/e2e.mjs`).

## How the coordinator controls helpers

The companion serves an MCP server on its own port, `POST /mcp/workers/<appId>` (Streamable HTTP,
plain JSON answers, loopback only, a new random Bearer secret every run), and hands it to the
coordinator's ACP session in `session/new` and `session/resume` (`mcpServers`, type `http`). The
Claude ACP adapter supports HTTP MCP servers directly; bb hands its sessions a stdio MCP relay to a
loopback bridge instead, which we do not need. The tools:

| Tool | What it does |
| --- | --- |
| `start_worker(title, brief, changes_app)` | Starts a helper; returns at once. |
| `message_worker(worker_id, message)` | A follow-up: a busy helper gets it after its current step, a finished one resumes its session. |
| `stop_worker(worker_id)` | Cancels its turn and drops what it had queued. |
| `list_workers()` | Every helper: id, task, state, latest line. |
| `read_worker(worker_id)` | One helper's recent messages and steps, for progress questions. |

The coordinator's own calls to these tools (and Claude Code's ToolSearch that fetches them) are not
shown in the main chat: each helper's row stands for them.

## Helpers work in parallel, each in its own copy

A helper that changes the app (`changes_app`, the default) works in **its own copy of the app**: a
Git worktree of the app's repository at `<appsDir>\.helpers\<slug>-<helperId>`, on its own branch
`helper/<helperId>`, started from everything the app has (unsaved notes of the main chat are saved
first). Its `node_modules` is copied from the app with robocopy (`fs.cp` elsewhere), the same way
`builder/` copies its deps cache into a new app: real copies, never hard links, checked on two
probe files. So each copy runs `npm run check` at once without an install, and no copy can change
another's packages. Helpers that only look (`changes_app: false`) work in the app folder itself.

Helpers that change the app all work at the same time. Their work **lands one change at a time**
(a "landing slot" per app):

1. When the helper's turn ends, the companion commits its work on its branch. No new commits: no
   landing ("it changed no files").
2. Holding the landing slot, the app's unsaved notes are committed, the helper's copy merges in the
   app's branch (what landed meanwhile), and the app fast-forwards to the helper's branch.
3. **A clash**: when that merge conflicts, it is undone at once, the slot is let go (other helpers
   keep landing), and the helper gets a message: run `git merge <app branch>` in your copy, resolve
   every conflict so both changes work, run `npm run check`, do not commit. When its turn ends the
   companion checks for leftover conflict markers, commits, and tries the landing again (at most 3
   times, then the helper reports a failure and keeps its work in its copy).
4. Still holding the slot, the app is built (one build row in the main chat), then committed and
   pushed when it has GitHub, and the new APK goes to the phone. So the phone gets **one build per
   landing**, and builds never overlap.
5. A failed build goes back to that helper to fix in its copy (at most 3 times); each fix
   fast-forwards the app again, which still cannot have moved. A change that never builds is taken
   out of the app again (`git reset --keep` to before the landing, notes kept) and stays in the
   helper's copy.
6. After a good landing (or no change) the copy and its branch are removed. A helper that failed or
   was stopped keeps its copy, so a follow-up carries on where it was. A follow-up to a finished
   helper makes a fresh copy at the same path, so its Claude Code session resumes there.

"Try again" on a failed build starts a helper "Build the app again" that checks the app and builds
even when it changed nothing.

## How reports reach the coordinator

When a helper settles (done, failed or stopped), the companion writes its report (its last message,
and what happened to its landing and build, including any clash it combined) and queues it to the
coordinator as a message starting `[Worker report]`. Reports that arrive while the coordinator is
busy go together as one message. They are not shown as the person's messages: the person sees the
helper row turn "done" and the coordinator's short answer. A report is kept on disk until the
coordinator has received it.

## Stop

- Stop in the main chat stops only the main chat's own reply, and drops the person's messages that
  were still queued behind it (they show "Not sent, you stopped the agent", as before). Helpers
  keep working, and their reports stay queued: a helper's news still reaches the main chat.
- Each helper has its own Stop (in its chat, on the phone and the PC), which cancels its turn; a
  helper waiting to land shows "Stopped" at once. The coordinator can stop one too (`stop_worker`).
- Where a turn was stopped, the chat shows a plain "Stopped" line (`ChatItem` kind `stopped`): in
  the main chat after its Stop, in a helper's chat after the helper's.

## The main chat's other features with helpers

- **Queued messages**: a message waits only behind the main chat's own reply (seconds), never
  behind helpers. The PC sets `App.replying` while the main chat answers; the composer shows Stop
  and queues new messages only then, not while only helpers work (the app's status is still
  "working" then, so the home tile says "2 helpers at work").
- **Pictures**: they reach the main chat as ACP image blocks, and the message also lists where they
  are saved on the PC, so the coordinator can put the paths in a helper's brief (a helper opens
  them by path).
- **"No new version this time"** and its "Build it again" never show with helpers: the main chat
  only talks, and builds follow helpers' landings.

## Restart

Everything is saved under `<state>/workers/<appId>/` (`workers.json` and one chat file per helper),
and helpers' copies stay on disk. On start the coordinator resumes its session as before, with the
new tool endpoint and secret. A helper that was working, waiting to land or building resumes its
own session in its own copy with "The PC restarted while you were working, carry on", then lands as
usual; a report the coordinator never got is handed over again. An app made before helpers resumes
its old session and gets the coordinator playbook once on its next message.

## What the person sees (built, on the phone and the PC)

The main chat stays the coordinator's conversation; its header and the app's tile say "2 helpers at
work" while helpers work. Each helper is one row in it (`ChatItem` kind `worker`, upserted in
place): its task in a few words, its state (waiting to add its change, working, combining changes,
building, done, a problem, stopped) and its latest line (its current step while it works, its
result when done). Tapping the row opens the helper's own chat, **read only**: the task it was
given (a "Task from the main chat" card, then "From the main chat" for follow-ups), its messages
and steps, a Working line while it is busy, its Stop, and a line at the bottom: "To change what
this helper does, tell the main chat."

- Phone (`app/`): the row in the chat (`src/chat/ChatRows.tsx`), the helper's chat as its own
  screen `helper/[appId]/[workerId]` (also a deep link, `anyappagent://helper/<appId>/<workerId>`).
- PC (`desktop/`): the helper's chat always opens beside the main chat (the user's answer to
  Q8; `HELPER_CHAT_PLACEMENT` in `src/renderer/src/Chat.tsx` still switches it to "replace"). When
  the chat area is under 760 px the two chats share it half and half with tighter spacing, and in a
  window under 1500 px the app list folds to its icons while a helper's chat is open, so even the
  smallest window (960 px) gives each chat about 315 px.
- Everything that is not drawing is in the shared core, `shared/chat/helpers.ts` (row wording and
  icons, the helper chat's rows, which Stop applies, the header count), with tests.

## Protocol (additive, `shared/protocol.ts`)

- `ChatItemKind` gains `"worker"` and `"stopped"`; `ChatItem` gains `worker?: WorkerInfo` (on a
  worker row) and `workerId?: string` (on items of a worker's own chat).
- `App` gains `replying?: boolean` (the main chat itself is answering) and `activeHelpers?: number`
  (helpers waiting, working or building; set, 0 or more, only when the chat uses helpers).
- New `WorkerState` and `WorkerInfo`.
- `ServerEvent` gains `worker.updated` and `worker.item` (worker chat items never travel as
  `chat.item`, so an older app never mixes them into the main chat).
- Routes: `GET /api/apps/:id/workers`, `GET /api/apps/:id/workers/:workerId/messages`,
  `POST /api/apps/:id/workers/:workerId/cancel`. (`POST .../messages` existed briefly before the
  helper chat became read only, and was never released.)
- `POST /api/apps/:id/cancel` stops the main chat's turn only.

## Where it lives

- `server/src/coordinator-playbook.ts`: the coordinator and helper playbooks, the report format.
- `server/src/workers.ts`: helpers, their sessions, chats, landing slot, landings, clashes, builds,
  reports, restart.
- `server/src/helper-copies.ts`: the helper's copy (worktree, node_modules copy), saving, landing,
  conflict markers, undoing a landing, removing a copy.
- `server/src/worker-http.ts`: the MCP tool endpoint and the worker routes.
- Small hooks in `server/src/apps.ts` (coordinator session options, report turns, build options,
  status, `replying`, `activeHelpers`, the Stopped line), `http.ts`, `main.ts`, `config.ts`,
  `acp/claude-session.ts` and `acp/translate.ts`.
- `shared/chat/helpers.ts` and the `helper`, `stopped` and `task` rows in `shared/chat/rows.ts`.
- `app/`: `src/chat/ChatRows.tsx`, `src/app/helper/[appId]/[workerId].tsx`, `src/lib/{api,store,session}.ts`.
- `desktop/`: `src/renderer/src/{Chat.tsx,helperStore.ts,styles.css}`, `src/main/{admin-client,index}.ts`,
  `src/preload/index.ts`, `src/shared/types.ts`.
- Proof: `server/scripts/coordinator-e2e.mjs` (`E2E_BUILDER=real E2E_APPS=<short folder>
  E2E_HOME=<builder home>` for real Android builds); unit tests `server/test/helper-copies.test.ts`
  and `server/test/worker-tools.test.ts`; the screens: `server/scripts/ui-proof/` (a DevTools
  driver for the desktop, an API client, and the scripts that drove the phone and the PC).

## Not covered yet

- Deleting an app does not remove helper copies of it under `<appsDir>\.helpers`.
- A helper that changes dependencies (`npm install` in its copy) lands a new lockfile; the app's
  next build reinstalls (the builder checks its deps stamp), so that build is slower.
