# Working on this web app

You are changing a web app for a non-technical person who opens it on their phone, inside
Kiwimake or from their home screen. They tell you what they want in plain words; they never see
the code. When your turn ends, Kiwimake builds this folder (TypeScript check, then `vite build`)
and puts the new version online at once. If the build fails, the error comes back to you as your
next prompt. **Keep the app building, and check your work before you finish.**

Stack: Vite 8, React 19, TypeScript (strict), plain CSS. No server: the app is static files on
GitHub Pages, so everything runs in the browser, and its data stays on the person's device. When
unsure of an API, read the `.d.ts` files in `node_modules` rather than memory.

## Layout

```
index.html               the page: title, theme colour, manifest link (keep the %KIWI_NAME% and
                         manifest/icon links; change theme-color to match the app's background)
src/main.tsx             entry point (leave it)
src/App.tsx              the first screen; App.tsx is the starter screen: replace it
                         (keep <WebReady /> at the top of the first screen)
src/styles.css           colours (light and dark), type, spacing, radius, card and button styles
src/lib/storage.ts       ALL saved data: usePersistentState, load/save, IndexedDB (see "Storage")
src/lib/ai.ts            AI (chat, streaming, tools, agents) through Kiwimake
src/lib/route.ts         screens by hash route (#/history)
src/lib/kiwimake.ts      inside Kiwimake: "Change this app", back to Kiwimake (leave it)
src/lib/updates.ts       new versions and the service worker (leave it)
src/lib/app.ts           the app's name, slug and version number (leave it)
src/components/WebReady.tsx       the "Version N is ready" card with Reload (leave it)
src/components/AiSetupNotice.tsx  the "AI works inside Kiwimake / is not set up" card
src/components/ErrorBoundary.tsx  "Something went wrong" instead of a blank page (leave it)
src/components/Icon.tsx  Material Design icons: <Icon path={mdiAlarm} />
assets/icon.png          THE app icon (1024x1024 PNG): home screen, tab, and the starter image
scripts/make-icon.mjs    makes assets/icon.png from a colour and a glyph or letter
anyapp.json              the app's kind, slug and name (written by Kiwimake)
overview.md              what the person wants the app to do (see below)
```

`@/` means `src/` in imports (`import { Icon } from '@/components/Icon'`). Put new screens in
`src/screens/` and shared pieces in `src/components/`.

## Web and Android together ("Both")

When this folder is `web/` inside an Android app, it is the same app's web version: one chat, one
version history, and both are built after every change. Make a change in both when the person asks
for a feature (the Android app at the project root, this web version here), as far as a web app can
do it, and keep them looking alike. Storage, AI and the rules in this file apply to `web/`.

## overview.md and the person's other apps

- `overview.md` (project root) holds the app's main requirements as the person gave them: what
  the app is for, its main screens and features, the choices that matter. High level and short,
  not a README and not a changelog. The agent the person talks to (the main chat) keeps it up to
  date after every message that changes what the app should do; a helper reads it and leaves it
  alone. A first line `<!-- anyapp: draft ... -->` marks a draft the PC wrote: replace the whole file.
- The `anyapp` command shows the person's other apps on this PC: `anyapp apps`, `anyapp overview
  <app>`, `anyapp path <app>` (its folder, to read its code). Before building something, look there
  for something that already works and copy it into this app, adapted to it. (Android apps there
  use React Native: copy the logic, not the screens.)
- Other apps are read only: never change, build, commit or run anything in another app's folder.

## What a web app cannot do (say so plainly when asked)

This is a web app, not an Android app. When the person asks for one of these, say in plain words
that a web app cannot do it, and that Kiwimake can make it an Android app instead (while the app is
new, saying so in the chat is enough; once it has versions, that is a new app):

- **No alarms, reminders or notifications while the app is closed**, and no exact alarms. Timers
  and sounds work only while the app is open and on screen.
- **No background work**: nothing runs when the app is closed or the phone is locked.
- **No home screen widgets, Quick Settings tiles or app shortcuts.**
- **No reading SMS, the call log, contacts in bulk or other apps.** No Bluetooth or NFC to rely on.

What works, after the browser asks the person for permission (ask only when the feature is used,
from a button, with a short line saying why): the **camera** (`<input type="file"
accept="image/*" capture="environment">` or `navigator.mediaDevices.getUserMedia`), the
**microphone**, **location** (`navigator.geolocation`), **vibration** (`navigator.vibrate`, Android
only), speech (`speechSynthesis`), sharing (`navigator.share`), the clipboard. Always handle "not
allowed" and "not supported" with a friendly line, never a crash. `fetch` works for HTTPS APIs
that allow it (CORS); there is no server of our own and no secrets can be kept in the app.

## Never

- **Never use `localStorage`, `sessionStorage`, `indexedDB`, `caches` or cookies directly, and
  never call `localStorage.clear()`.** All of this person's web apps share one web address and so
  one storage: going around `src/lib/storage.ts` can read or wipe another app's data. Use
  `src/lib/storage.ts` for everything (below).
- **Never use path routes** (`/history`, `history.pushState` routers, BrowserRouter): the app is
  served from one address only. Use hash routes (`src/lib/route.ts`) or state inside a screen.
- Never change `base` or `build.sourcemap` in `vite.config.ts`, and never add a service worker,
  `sw.js`, `manifest.webmanifest`, `version.json` or `icon-*.png`: the builder makes them on every
  build (offline use, Add to home screen, "Version N is ready"). Never edit `src/lib/updates.ts`
  or `src/components/WebReady.tsx`.
- Never change `slug` or `preset` in `anyapp.json`. You may change `name` (the app's name on the
  home screen and in the tab) when the person asks to rename the app.
- Never put secrets or keys in the app: everything in it is public. For AI, use `src/lib/ai.ts`
  (below): never ask the person for an API key and never call an AI provider with `fetch`.
- Never run a dev server or anything that needs a browser or a phone. The builder does the build.
- Prefer what is installed. A new library: `npm install <pkg>` (web libraries only, never React
  Native ones); every library makes the app bigger and slower to open on a phone.

## Check your work

```
npm run check        # tsc --noEmit, then vite build: what the real build runs (a few seconds)
```

Run `npm run check` before you finish a turn. It does not catch runtime errors, so read your code
for crashes too (undefined values, unhandled promise rejections, a permission not asked for).

## Words in the app

- **Never use the em dash character (U+2014) anywhere**: not in UI text, titles, comments, or your
  messages. Use a comma, colon, full stop or parentheses instead.
- Short, friendly, plain words; no technical terms in anything the person sees.

## Design: the person's taste (follow it)

The person said: "no purple gradients or AI slop please". So:

- **No purple gradients, and no gradients as decoration at all.** Flat colour, hairlines, space.
- **No sparkle, magic wand, stars or "AI" icons**, and no "magical" wording.
- **No generic AI look**: no glowing cards, glassmorphism, neon, emoji as decoration, big rounded
  hero banners, or the same purple-blue template every app has.
- **Design each app for what it is for**: choose an accent, an icon and a layout that fit the
  subject (and its culture).
- **Calm and well made**: one large title per screen, then headings, body, small labels; generous
  spacing; one restrained accent colour used sparingly; light and dark both deliberate.
- **Notices and cards: text takes the full width; their buttons go below the text, aligned right,
  never beside it.** (`<div className="card">` text, then `<div className="actions">` buttons.)
- It is used on a phone first: big touch targets (44 px), one main action per screen, no hover-only
  controls, and it must look right from 320 px wide up to a desktop window (the `.page` column).

How: everything visual comes from the CSS variables in `src/styles.css` (`--background`,
`--surface`, `--surface-muted`, `--border`, `--text`, `--text-muted`, `--text-faint`, `--accent`,
`--on-accent`, `--accent-soft`, `--success`, `--warning`, `--danger`, `--space-*`, `--radius-*`) and
its classes (`page`, `display`, `title`, `heading`, `body-strong`, `small`, `label`, `muted`,
`faint`, `numeric`, `card`, `actions`, `button`, `button secondary`, `button quiet`, `input`,
`list`, `row`). Never hard-code colours in components, so dark mode works. To give the app its
character, change `--accent` (and, if fitting, `--background`) in both palettes first, and set
`theme-color` in `index.html` to the light `--background`. Icons: `import { mdiAlarm } from
'@mdi/js'` with `<Icon path={mdiAlarm} />` (names at https://pictogrammers.com/library/mdi/),
used sparingly, in `--text-muted` or `--accent`.

## Built-in capabilities

### Screens and navigation (hash routes)

```tsx
import { useRoute } from '@/lib/route';

export default function App() {
  const [route, go] = useRoute();              // "/", "/history", "/item/42"
  return (
    <main className="page">
      <WebReady />
      {route === '/history' ? <History onBack={() => go('/')} /> : <Home onOpenHistory={() => go('/history')} />}
    </main>
  );
}
```

The phone's back button and the browser's back go to the previous route.

### Storage

```tsx
import { usePersistentState, load, save, remove, clear, openDatabase, dbRequest } from '@/lib/storage';

const [items, setItems] = usePersistentState<string[]>('items', []);
setItems((prev) => [...prev, 'new']);        // saved at once

const settings = load('settings', { offset: 10 });     // outside React (synchronous)
save('settings', { offset: 15 });
clear();                                               // only this app's saved values

// Big or many records (photos, long lists): IndexedDB through openDatabase
const db = await openDatabase('photos', 1, (db) => db.createObjectStore('photos', { keyPath: 'id' }));
await dbRequest(db, 'photos', 'readwrite', (s) => s.put({ id: '1', blob }));
const photo = await dbRequest(db, 'photos', 'readonly', (s) => s.get('1'));
```

Every key and database name is prefixed with this app's slug by `storage.ts`. The data lives in
this browser on this device only: it survives new versions and closing the app, but not "clear
site data", and it is not shared with the person's other devices. Keep `usePersistentState`
values small (plain JSON, under ~1 MB each); put pictures and long histories in IndexedDB.

### AI: chat, streaming, tools and agents (through Kiwimake)

Use this whenever the person asks for anything AI. Inside Kiwimake on the phone the app asks
Kiwimake, which uses the person's AI key (added once in Kiwimake's Settings) and can switch AI off
for this app. In a plain browser there is no AI: the app must say "Open this in Kiwimake to use
AI" (`AiSetupNotice` does) and keep working without it.

```tsx
import { useAiStatus, ask, chat, runAgent, imagePart, imagePartFromFile, AiError, aiProblemText, type AiMessage, type AiTool } from '@/lib/ai';
import { AiSetupNotice } from '@/components/AiSetupNotice';

// 1. Show the card while AI is not ready (plain browser, no key yet, or switched off).
const { status } = useAiStatus();                 // refreshes when the app comes back to the front and when Kiwimake's bridge arrives
<AiSetupNotice status={status} />                  // renders nothing when AI is ready

// 2. One question
const answer = await ask('Suggest a name for a cat', { system: 'Answer in one line.' });

// 3. A conversation, streamed: show text as it arrives
const next: AiMessage[] = [...messages, { role: 'user', content: input }];
const reply = await chat({ messages: next, system: 'You are a friendly cooking helper.', onText: (t) => setLive((s) => s + t) });
setMessages([...next, reply.message]);            // always append reply.message, not just the text

// 4. An agent with tools: the AI calls your functions until it is done
const addItem: AiTool<{ name: string }> = {
  name: 'add_item',
  description: 'Add an item to the shopping list',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  run: async ({ name }) => { addToList(name); return 'added'; },
};
const result = await runAgent({ prompt: 'Add what I need for pancakes', tools: [addItem], maxSteps: 6 });

// 5. A photo: <input type="file" accept="image/*" capture="environment">, then
await chat({ messages: [{ role: 'user', content: [await imagePartFromFile(file), { type: 'text', text: 'What plant is this?' }] }] });

// Errors: every call can throw AiError
try { await ask('Hi'); } catch (e) {
  if (e instanceof AiError) setProblem(e.needsSetup ? e.code : aiProblemText(e.code));
}
```

- Always handle "not ready": `<AiSetupNotice status={status} />` (or `code={err.code}` after an
  `AiError` with `needsSetup`) where the AI feature would be. Never show a key field.
- Stream long answers with `onText`; pass `signal` (an `AbortController`'s) to let the person stop.
- Keep tools small and safe: never give the AI a tool that deletes or spends without the person
  confirming in the UI. Limits: about 30 AI calls a minute and 3 at once per app (`AiError` code
  `limit`). Keep pictures small (resize on a canvas to ~1600 px first).

### Inside Kiwimake

`inKiwimake()` is true when the app runs inside Kiwimake. `openChangeChat()` opens this app's
chat ("Change this app"); `closeApp()` goes back to Kiwimake's home. Outside Kiwimake both do
nothing, so show those buttons only when `inKiwimake()`.

### New versions, offline, Add to home screen (built in, nothing to do)

Every build goes online at once. The builder adds a service worker (the app works offline after
the first open), a manifest and the icons (Add to home screen pins the app's own icon), and
`version.json`. `<WebReady />` shows "Version N is ready" with Reload when a newer version is
online. Keep `<WebReady />` on the first screen.

### What changed

Before you end a turn that changed the app, call the `describe_change` tool (MCP server `app`)
with what changed in the person's words, what to try, and anything to know. It shows on the new
version's card and in the app's "Version N is ready" card. Every version is a commit in Git; the
person can go back to any version with Versions in their chat, so never rewrite Git history.

## The app icon

The icon is **`assets/icon.png`**: a 1024x1024 PNG (8-bit, not interlaced), square, opaque,
full-bleed (no rounded corners, no transparency). Phones crop it into a circle or squircle, so keep
the picture in the middle ~60%. Give every app its own icon that matches what it does (the starter
icon is a placeholder). Flat colour, one simple glyph, no gradients, no sparkles:

```
npm run icon -- --bg "#14532D" --fg "#F4F1E8" --glyph mosque      # flat colour + glyph
npm run icon -- --bg "#1E2023" --letter W                         # colour + letter
npm run icon -- --search alarm                                    # find glyph names
```

Keep the icon at `assets/icon.png`: the builder makes the home screen sizes from it.

## Plan first, and pages in the chat

- Before you build a new app or make a large change (a new screen, a new feature, a redesign), the
  person confirms a plan: the plan as bullets and sub-bullets in the chat, and a plan page (a
  picture of what you will build, then "Build it?"). Start only after their yes. Small changes need
  no plan.
- Pages are HTML files you show in the chat with the `show_page` tool (MCP server `pages`). Page
  files never go into this project: write them in the folder the `show_page` tool names.

## When the build fails

The error you receive is the useful part of the output: TypeScript errors with file and line, or a
Vite error (a bad import, a syntax error, a missing file). Fix the cause; do not work around it by
deleting features. The full log is in `build/logs/`.
