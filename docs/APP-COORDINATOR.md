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

- Stop in the main chat stops only the main chat's own reply. Helpers keep working.
- Each helper has its own Stop (in its chat), which cancels its turn; a helper waiting to land
  shows "Stopped" at once. The coordinator can stop one too (`stop_worker`).

## Restart

Everything is saved under `<state>/workers/<appId>/` (`workers.json` and one chat file per helper),
and helpers' copies stay on disk. On start the coordinator resumes its session as before, with the
new tool endpoint and secret. A helper that was working, waiting to land or building resumes its
own session in its own copy with "The PC restarted while you were working, carry on", then lands as
usual; a report the coordinator never got is handed over again. An app made before helpers resumes
its old session and gets the coordinator playbook once on its next message.

## What the person sees

The main chat stays the coordinator's conversation. Each helper is one row in it (`ChatItem` kind
`worker`, upserted in place): its task in a few words, its state (waiting to add its change,
working, combining changes, building, done, a problem, stopped) and its latest line (its current
step while it works, its result when done). Tapping the row opens the helper's own chat, **read
only**: the task it was given, its messages and steps, and its Stop. Anything the person wants to
tell a helper goes through the main chat. On the PC the helper's chat opens beside the main chat
(the recommended answer; the user has not decided yet, and "replace the main chat" is a layout
switch in the desktop app only). Mockup: `docs/mockups/worker-chat.html`.

## Protocol (additive, `shared/protocol.ts`)

- `ChatItemKind` gains `"worker"`; `ChatItem` gains `worker?: WorkerInfo` (on a worker row) and
  `workerId?: string` (on items of a worker's own chat).
- New `WorkerState` and `WorkerInfo`.
- `ServerEvent` gains `worker.updated` and `worker.item` (worker chat items never travel as
  `chat.item`, so an older app never mixes them into the main chat).
- Routes: `GET /api/apps/:id/workers`, `GET /api/apps/:id/workers/:workerId/messages`,
  `POST /api/apps/:id/workers/:workerId/cancel`. (`POST .../messages` existed briefly before the
  helper chat became read only, and was never released.)
- `POST /api/apps/:id/cancel` is unchanged: it stops the main chat's turn only.

## Where it lives (`server/`)

- `src/coordinator-playbook.ts`: the coordinator and helper playbooks, the report format.
- `src/workers.ts`: helpers, their sessions, chats, landing slot, landings, clashes, builds,
  reports, restart.
- `src/helper-copies.ts`: the helper's copy (worktree, node_modules copy), saving, landing,
  conflict markers, undoing a landing, removing a copy.
- `src/worker-http.ts`: the MCP tool endpoint and the worker routes.
- Small hooks in `apps.ts` (coordinator session options, report turns, build options, status),
  `http.ts` (two route hooks), `main.ts`, `config.ts`, `acp/claude-session.ts` (MCP servers,
  instructions on resume) and `acp/translate.ts` (`closeStreams`).
- Proof: `scripts/coordinator-e2e.mjs` (`E2E_BUILDER=real E2E_APPS=<short folder>
  E2E_HOME=<builder home>` for real Android builds); unit tests `test/helper-copies.test.ts` (a
  real Git repo: parallel landings, a clash, markers, undo, cleanup) and `test/worker-tools.test.ts`.

## Not covered yet

- Deleting an app does not remove helper copies of it under `<appsDir>\.helpers`.
- A helper that changes dependencies (`npm install` in its copy) lands a new lockfile; the app's
  next build reinstalls (the builder checks its deps stamp), so that build is slower.
