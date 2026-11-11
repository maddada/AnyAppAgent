# Pages in the chat, plan first, and "Ask me more"

The user's words: "the agent should always write bullet points and subpoints and give HTML that
explains the app that it's going to build before it starts, so the user can confirm. Copy how inline
HTML works in Ghostex", "I can answer questions in that inline HTML itself and send them to the
agent", "I need to be able to view the inline HTML that was sent on the desktop on my phone", and an
"Ask me more" option that lets the agent ask more questions about the app before it starts.

## What the person gets

- **Pages in each app's chat.** The app's agent (the main chat, or a helper it asks) can show a page:
  an explainer of the plan with a mockup of the app, questions with choices, or how a feature would
  work. The chat shows a card ("Water Buddy: the plan", "1 question for you", Open and answer). A tap
  opens it: full screen in the phone app, a window over the desktop app. The same page opens on both,
  and answers sent from one show as answered on the other.
- **Answering on the page.** Choices, a note under each question, an "Anything else?" box (pictures
  can be pasted), Skip all and Send, all from Ghostex's question kit. What was picked is kept while the
  page is open or closed and reopened (a draft on the PC). Send posts everything as one message to the
  agent; the chat shows it as an answers card and the page card turns "Answered".
- **Plan first.** Before a new app is built, and before any large change, the agent writes the plan
  as bullets and sub-bullets in the chat and publishes a plan page (a mockup of the main screen, what
  it does, what it chose), ending with "Shall I build it like this?" (Build it / Change something).
  It builds only after a yes. Small changes need no plan.
- **"Ask me more"** in the New app sheet (phone and PC): the agent first sends a page of questions
  about the app (up to 8, each with a recommended choice), then plans with the answers.
- **Pages on request.** "Show me how snooze would work" (or "make a page about it") gets a page.

## How it works

### Publishing (server/src/pages.ts)

- Every session gets an MCP server `pages` (Streamable HTTP on the companion's port, loopback only,
  a new random Bearer secret every run) at `POST /mcp/pages/<appId>`, beside the coordinator's
  `workers` server. Helpers get it with `?worker=<id>&title=<title>`, so their pages say who made
  them. Tools: `show_page({path, title?})` and `list_pages()`. Its tool calls are never shown in the
  chat: the page's card stands for them.
- The agent writes one HTML file in `<state>/pages/<appId>/files/` (outside the app's repository)
  and calls `show_page`. The companion refuses a page with an em dash or without a `<title>`, puts
  local pictures into the page as data URIs (absolute paths or relative to the file, up to 10 MB each,
  8 MB per page) and names those it cannot find, reads the page's questions (`<gx-question>` titles)
  and whether it asks nothing (then it waits to be marked seen), stores it as
  `<state>/pages/<appId>/<id>.html` + `<id>.json`, and upserts a `page` item in the app's main chat.
- The guide for agents is `server/src/pages/PAGE-KIT.md` (the skeleton, phone-first layout, the
  question kit, the plan page). The playbooks point at it.

### Serving (copied from Ghostex's server/src/visual_pages)

- `POST /api/apps/:id/pages/:pageId/open` (phone or desktop token) returns
  `/page/<pageId>/<ticket>`, a ticket signed with a secret kept in `<state>/pages/ticket-secret`,
  valid for a day. The page and its own routes are served there without a Bearer token: a web view
  cannot add one to the page's own requests, and the page must never see the session token.
- `GET /page/<id>/<ticket>`: the stored page with the kit put at the start of its `<head>` on every
  serve (so old pages get today's kit) and its state (answered, answers, or the draft). Headers: a
  content policy that starts with `sandbox allow-scripts allow-forms allow-popups` (an opaque origin:
  no cookies, no storage, no same-origin access to the companion), scripts and styles inline or
  https, fonts from `/page-kit/fonts/`, and fetches only to https and to this page's own address.
- The page's own routes, as in Ghostex: `POST answers` (`{answers}`, 64 KB, the first set wins;
  409 after), `GET/POST draft` (`{draft, editedAt}`, a newer edit always wins), `POST image` (a
  pasted picture, saved next to the page; answers carry `[Image #N](path)`), `GET image?path=` (only
  that page's pictures), `POST notice|scroll` (accepted, unused). Replies carry
  `Access-Control-Allow-Origin: *`; the page posts plain text, so no preflight.
- Answers reach the agent through the same path as a typed message (`sendMessage`, queued behind a
  running turn) as `<page-answers page="<id>" title="<title>">` + pretty JSON. A helper's page adds a
  line asking the main chat to pass the answers on with `message_worker`.

### The kit (server/src/pages/kit/)

- `page-api.html`, `kit-style.html`, `kit-script.html`, `fit-style.html`, `fit-script.html` are
  Ghostex's own, copied by `node server/scripts/port-page-kit.mjs` (it only changes a few sentences
  that name Ghostex, shows the theme switch on every page, and adds `window.anyapp` as the same
  object as `window.ghostex`). Run it again to take a newer Ghostex kit.
- `theme.html` is AnyAppAgent's: the Workbench colours under Ghostex's token names, light and dark,
  Bricolage Grotesque and IBM Plex Mono, and Ghostex's bootstrap (`#gx-theme=light|dark` in the
  address sets the theme; links open outside). `workbench.html` tunes the kit's headings, eyebrow,
  ribbon and badges to Workbench.

### Clients (shared/chat/pages.ts, rows.ts)

- `pageCard(page)` says how a card reads; `answerLines(answers)` how an answers card reads;
  `parsePageAnswers` / `pageAnswersMessage` are the envelope; `pageUrl` and `staysInPage` are what a
  web view loads and keeps. In `buildRows` a `page` item becomes a `page` row placed after the rest
  of its turn (so the card follows the plan text), and a person's message that is a page's answers
  becomes an `answers` row.
- Phone (`app/`): the card and the answers card in `src/chat/ChatRows.tsx`; the page opens in its
  own screen with `react-native-webview`, without `onMessage` (so no bridge into the app is
  injected), incognito, no shared cookies, no new windows; any navigation off the page opens in the
  browser. It closes itself a moment after the page is answered.
- Desktop (`desktop/`): the cards in `Chat.tsx`; `src/main/page-window.ts` opens a window per page
  (no preload, no Node, sandboxed, its own in-memory session, permission requests refused, links to
  the browser), focuses it when opened again, and closes it after the page is answered.

### Plan first and "Ask me more" (server/src/playbook.ts, coordinator-playbook.ts)

- The playbooks (single session, coordinator, helper) have a Pages section and a Plan first section;
  the coordinator writes the plan and its page itself (talk, not work) and starts the worker only
  after the yes. `COORDINATOR_PLAYBOOK_VERSION` is 2, so resumed coordinators get it once.
- A new app's first message to the agent gets a line from the PC (the chat shows only the person's
  words): plan first, and with `askMore`, ask a question page first. `ANYAPP_PLAN_FIRST=off` drops
  plan first (for scripts that expect a build right after the first prompt).
- The templates' `AGENTS.md` (`template/`, `template-kotlin/`, `template-exact/`) say the same in a
  short section, for helpers.

## Protocol (additive, shared/protocol.ts)

- `ChatItemKind` gains `"page"`; `ChatItem` gains `page?: PageInfo` (its `text` is the title, for
  older apps).
- New `PageInfo` (`id`, `appId`, `title`, `questions?`, `awaitsSeen?`, `answeredAt?`, `seen?`,
  `from?`, `createdAt`) and `PageOpenResponse` (`path`, `expiresAt`).
- `CreateAppRequest` gains `askMore?: boolean`.
- `App` gains `waitingForAnswer?: boolean`: a page with questions waits for the person (set when one is
  published, cleared when it is answered or the person sends any message, worked out again from the
  chat on start). The state line then says "Waiting for your answer" (the phone tile: "Your answer");
  an update or install to tap still comes first.
- Routes: `GET /api/apps/:id/pages`, `POST /api/apps/:id/pages/:pageId/open`, and the page's own
  `/page/<id>/<ticket>[/answers|/draft|/image]`, `/page-kit/fonts/<file>.ttf`.
- The answers envelope `<page-answers page="..." title="...">` in a person's message.

## Tests

`server/test/pages.test.ts` (reading pages, the kit's place, pictures, refusals, serving and the
sandbox policy, drafts, one set of answers, Mark as seen from a helper's page, the MCP tool, fonts),
`shared/chat/test/pages.test.ts` (envelope, answer lines, card wording, rows and their order, web
view navigation). The end-to-end proof is in `C:\aa\e2e\pages-in-chat\`.
