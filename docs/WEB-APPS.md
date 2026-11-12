# Web apps: the plan

The user (12 Nov 2026): "We need to also add web app building, which we host for the user and keep
in Appwin. Those would still work without needing to install an APK."

Today Kiwimake makes only Android apps: the
React Native and Kotlin templates, APKs, and the fast lane. This file plans a second kind of app: a
**web app** that Kiwimake builds, hosts at its own address, and opens on the phone without an install.

Status: **the agreed plan** (decisions of 12 Nov 2026, section 7), nothing built, no account made,
nothing spent. Facts were checked on the web
on **12 Nov 2026**; each has its source. It builds on `docs/CLOUD.md` (the agreed cloud plan),
`docs/DISTRIBUTION.md`, `docs/CHANGE-THIS-APP.md`, `docs/FAST-LANE.md`, `docs/VERSIONS.md` and the
Family circle page (`C:\aa\ideas\family-circle.html`).

## 0. The recommendation in short

1. **Same codebase**: a web app is the React Native template with Expo's web target switched on, so
   one app can be web, Android, or both, and "Make it an Android app too" is a switch, not a rewrite.
2. **Hosted by us on Cloudflare**: one Worker plus one R2 bucket serves every app at its own
   address, `prayertimes-mohamad.<apps domain>` (a separate domain for people's apps, one subdomain
   per app so apps never share storage). About **$0 a month at 10 and 100 people, about $6 at 1000**.
3. **On the phone**: a tile in Kiwimake's grid that opens the app full screen in a WebView, "Add to
   home screen" as a pinned shortcut, and offline through a service worker. In any browser it is
   the same address.
4. **Data stays in the browser** in the first version (private, offline, nothing stored by us);
   shared data between people and devices (a per-app store in Convex, sign-in with Kiwimake) is the
   next step, +5 days.
5. **About 15 days** for the first version in PC mode once the cloud's Convex project and sign-in
   exist (+3 days if web apps go first), and +1.5 days to add it to cloud mode.

## 1. What a web app is here

### The template: Expo web, compared with a plain web template

| | **A. The React Native template with Expo web on** (recommended) | B. A plain web template (Vite, React DOM, CSS) |
| --- | --- | --- |
| What it is | `template/` as today plus `react-dom`, `react-native-web` and `@expo/metro-runtime` (Expo's documented web setup: `npx expo install react-dom react-native-web @expo/metro-runtime`, https://docs.expo.dev/workflow/web/); `npx expo export -p web` writes a static site to `dist/` | A new `template-web/`: Vite, React DOM, plain CSS with the Workbench tokens |
| One app on web and Android | **Yes, one codebase.** Turning a web app into an APK later is a setting and a full build | No. An APK later means a rewrite, or a WebView wrapper APK |
| Reuse | The Workbench components, `storage.ts`, `crash.ts`, Change this app, the agents' `AGENTS.md`, the fast lane's thinking | Little: new components, new rules for the agent |
| What the agent knows | React Native it already writes for every app; it must avoid Android-only libraries in a web app (the playbook says so, the web build fails loudly if it does not) | Plain React DOM, which agents write very well; the full web library world |
| Size and speed in a browser | Heavier: React Native Web on top of React (to measure in the spike) | Lighter and faster to first paint |
| Build | `expo export -p web`, seconds, no Gradle | `vite build`, seconds |

**Recommendation: A.** "Both from one codebase" is the point the user raised, the template and its
built-in parts already exist, and the person never sees the difference. B stays the fallback if the
spike finds React Native Web too heavy or too limiting for real apps.

What changes in `template/`:

- `package.json`: the three web packages above; `app.json` `platforms` gains `"web"` (it is
  `["android"]` today), `web.output: "single"` (one `index.html`, client-rendered), `web.favicon`.
- **Which targets an app has** lives in `anyapp.json`: `"targets": ["web"]`, `["android"]` (every
  app today) or `["android", "web"]`. Not a new preset: the same React Native preset. Kotlin and
  Expo Exact apps stay Android only.
- **Each native module gets a web file** (`modules/<name>/index.web.ts`, which Metro picks for web):
  `ai` (the Kiwimake bridge, section 3), `alarms` (while the page is open only; the playbook says what
  it cannot do), `camera` (the browser's camera through `getUserMedia`, or a file input with
  `capture`), `updates` (the service worker's update check and the Reload card), `diary` (a small
  ring in `localStorage`), `feedback` and `abilities` (what the browser has).
- **PWA**: Expo does not make a manifest or a service worker by itself. Its guide: write
  `public/manifest.json` by hand, and generate the service worker with Workbox on the exported
  `dist/` (`npx workbox-cli generateSW workbox-config.js`)
  (https://docs.expo.dev/guides/progressive-web-apps/). The template ships both files; the builder
  fills the name, colours and icons from `app.json`.
- **A web Reload card** (`src/components/WebReady.tsx`): when the service worker finds a new version,
  the same "Version 7 is ready" card as `ReadyPopup.kt`, in the Workbench look, with Reload.
- `AGENTS.md`: a "Web apps" section (what a web app cannot do, no Android-only libraries, keep the
  web files of the modules, test with `npm run web:check`).

### How it opens

**Inside the Kiwimake phone app:**

- A tile in the home grid like any app, with a small globe mark and the version ("V7").
- **Open** shows the app full screen in a WebView screen (`app/src/app/web/[id].tsx`;
  `react-native-webview` 14 is already in `app/`), with a thin bar only when you pull down (Back to
  Kiwimake, Reload, Share the address). **Change it** opens the chat, as for every app.
- **Add to home screen**: an Android pinned shortcut (`ShortcutManager.requestPinShortcut`) with the
  app's icon and name, which opens Kiwimake straight on that app's web screen. It looks and starts like
  an installed app; it needs no "install unknown apps" permission and no APK. (A person who prefers
  Chrome can also open the address there and use Chrome's own Install, which makes a real PWA.)
- **Offline**: the service worker caches every file of the current version, so the app opens with
  no internet once it has been opened once. Android's WebView supports service workers, so this
  works inside Kiwimake as it does in Chrome. Data kept in the browser (section 3) works offline too.
- **Each app has its own storage** because each app has its own address (its own origin). Inside one
  WebView, browsers keep `localStorage`, IndexedDB and service workers per origin, so one app can
  never read another's data. That is why paths like `kiwimake.ai/a/<app>` are not recommended (section 2).

**In any browser**: the same address on any phone, tablet or computer, with Add to home screen from
the browser's menu. Someone without Kiwimake uses it like any website.

### What a web app cannot do (compared with an APK)

The plan page and the agent say this in plain words when the person asks for one of them, and offer
"Make it an Android app too".

| Phone power | APK | Web app |
| --- | --- | --- |
| Alarms and reminders at an exact time while the app is closed (the Ajman prayer alarm) | Yes | **No.** Only while it is open, or by web push (needs a push server, later) |
| Notifications when closed | Yes | Only by web push (later, +3 days), and only after the person allows it |
| Running in the background, foreground services | Yes | No |
| Home screen widgets, quick settings tiles | Yes | No |
| Reading SMS, call log, other apps, contacts in bulk | Yes (with permission) | No |
| Bluetooth, NFC | Yes | Partly (Chrome only, the page must be open) |
| Camera, microphone, location, vibration, speech | Yes | Yes, with the browser's permission prompt |
| AI for your apps | Through Kiwimake's proxy | Inside Kiwimake through the same proxy; in a plain browser not in the first version |
| Crash catcher, What changed, Reload card | Yes | Yes (web versions, section 4) |
| The diary the agent reads | Yes | Not in the first version (it lives in the browser) |
| Install needed | Yes, and "install unknown apps" once | **No** |
| Works on iPhone, tablets, computers | No | **Yes** |

## 2. Hosting "for the user"

### The address

Recommended: **`<app>-<owner>.<apps domain>`**, for example `prayertimes-mohamad.<apps domain>`. The apps
domain is still to be picked (not `kiwimake.ai`, see below).

- **One subdomain per app**, so each app is its own origin: separate storage, separate service
  worker, separate permissions (a camera allowed for one app is not allowed for another).
- **One level deep** (`a-b.<apps domain>`, not `a.b.<apps domain>`): Cloudflare's free Universal SSL
  certificate covers the root and "first-level subdomains"; deeper names "are not covered and will
  not serve a valid certificate" without Advanced Certificate Manager and Total TLS
  (https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/). So
  `<slug>.<user>.kiwimake.ai` from the brief would cost extra; `<slug>-<user>` does not.
- **A separate domain for people's apps** (the name is still to be picked, about $15 a year), not
  `kiwimake.ai` itself. Apps run code an agent wrote from anyone's prompt: if one is used for phishing,
  Safe Browsing can flag the whole domain, and `kiwimake.ai` carries the circles' invite links, the
  App Link proof and later the sign-in pages. GitHub keeps people's sites on `github.io` for the same
  reason. Later the domain goes on the Public Suffix List, so browsers treat every app as its own
  site for cookies too (it takes weeks to land, so it is not in the first version).
- `<owner>` is the person's short handle, picked once at sign-in (default from their name). Names
  are unique; a few are reserved (`www`, `api`, `app`, `admin`, `mail`, `kiwimake`, and so on). A
  renamed app keeps its old address forwarding for 90 days.
- Not recommended: `kiwimake.ai/a/<app>` (every app in one origin: apps could read each other's data,
  and service workers would clash).

### Where the built site lives: three options checked

| | **Cloudflare Worker + R2** (recommended) | Convex static hosting | GitHub Pages from the app's repo |
| --- | --- | --- | --- |
| How | One Worker on the route `*.<apps domain>/*` with a proxied wildcard DNS record, reading each app's files from one R2 bucket | The `@convex-dev/static-hosting` component: files in Convex storage, served "through HTTP actions" with "Automatic fallback to index.html" (https://www.convex.dev/components/static-hosting) | The built site pushed to a `gh-pages` branch of `anyapp-<slug>` |
| Many apps, one per address | Yes: the Worker reads the host name. Wildcard proxied records are on every plan (https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/) and `*.` routes match every subhost (https://developers.cloudflare.com/workers/configuration/routing/routes/) | Built for one site per deployment at `<deployment>.convex.site`; many apps on many hosts would need our own routing and Cloudflare in front anyway (custom domains are not on Convex's Free and Starter plans, https://www.convex.dev/pricing) | One address per person, `<login>.github.io/anyapp-<slug>`: all of a person's apps share one origin, and it is not "kept in Kiwimake" |
| The code repo stays private | Yes | Yes | **No on GitHub Free**: Pages needs a public repo on Free; private repos need GitHub Pro, Team or Enterprise, and the site is public anyway (https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site, https://github.com/orgs/community/discussions/22817) |
| Rules | Ours | Ours | Pages "is not intended for or allowed to be used as a free web-hosting service to run your online business ... providing commercial software as a service (SaaS)"; soft 100 GB a month, 10 builds an hour, 1 GB per site (https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |
| Cost per request | Worker requests: Free 100,000 a day; Paid $5 a month with 10 million included, then $0.30 a million (https://developers.cloudflare.com/workers/platform/pricing/). R2: 10 GB, 1M writes and 10M reads a month free, then $0.015 a GB-month, $4.50 and $0.36 a million; **egress free** (https://developers.cloudflare.com/r2/pricing/) | Every file served is a function call (1M free, then $2.20 a million) and egress (1 GB free, then $0.132 a GB) on Starter | Free |

Why not Cloudflare's own "static assets" (free, unlimited requests): they belong to one Worker
version, so every app's publish would be a new Worker deployment, at most 100 or 500 Workers per
account and 20,000 or 100,000 files per version
(https://developers.cloudflare.com/workers/platform/limits/). Pages is the same shape (100 projects
per account "not routinely increased", and no wildcard custom domains,
https://developers.cloudflare.com/pages/platform/limits/). So: one Worker of our own that reads R2.
If Cloudflare's paid "Workers for Platforms" ever fits better it can replace this behind the same
publish API.

**How it works:**

```
Companion (PC mode) or runner (cloud mode)
  buildWeb -> dist/ -> list of files {path, size, sha256}  (no source maps, secrets scan passed)
  -> Convex: webPublish.begin(appId, build, files)       checks the owner, returns which files
                                                          R2 does not have yet, with signed PUT URLs
  -> PUT the missing files straight to R2 (files/<sha256>)  nothing else is uploaded
  -> Convex: webPublish.finish(...)                       writes sites/<appId>/<build>.json (path -> sha256)
                                                          and moves "current" for the app's host
Browser or Kiwimake's WebView: https://prayertimes-mohamad.<apps domain>/...
  -> Worker: host -> appId and current build (R2 object, cached at the edge for 30 s)
           -> path -> sha256 (the build's file list, cached) -> R2 files/<sha256>
           -> index.html for unknown paths (one-page apps); our 404 page for unknown hosts
           -> headers: long cache for hashed files, no-cache for index.html and the service worker,
              a strict Content-Security-Policy, X-Content-Type-Options, a noindex robots tag
```

- **Content addressed**: a file is stored once by its SHA-256, so a version that changed one screen
  uploads only that bundle, and old versions cost almost nothing to keep. Undo and Go back only move
  "current" (section 4).
- **Nobody but Convex can publish.** The box and the companion never hold a Cloudflare token: they
  get short-lived signed PUT URLs for exactly the files that are missing, and only Convex can move
  "current" (with an R2 key that lives in a Convex environment variable). The Worker only reads.
- **Ready in seconds**: an export plus a few uploads, no Gradle and no install. This is the fast lane
  for every web change.
- One more account: a free Cloudflare account, the same one the Family circle plan already uses for
  `kiwimake.ai`'s DNS, plus R2 (asks for a card even on its free tier).

### Costs

Assumptions (to be replaced by real numbers after a month): each person has 2 web apps; each is
opened 450 times a month (the owner and 4 family members, 3 times a day); a first open loads about
10 files, a repeat open about 2 (the service worker serves the rest), so about 3 Worker requests per
open on average; a version is about 3 MB, with about 300 KB new per change (content addressing).

| A month | 10 people | 100 people | 1000 people |
| ------- | --------- | ---------- | ----------- |
| Opens | 9,000 | 90,000 | 900,000 |
| Worker requests | 27,000 | 270,000 | 2.7 million (about 90,000 a day: close to the free 100,000) |
| Workers plan | Free, $0 | Free, $0 | **Paid, $5** (headroom; 10M included) |
| R2 storage (all versions) | 0.2 GB, $0 | 1.8 GB, $0 | about 18 GB, about $0.12 |
| R2 reads and writes | free tier | free tier | free tier (2.7M reads, about 50,000 writes) |
| Egress | $0 (R2 and Workers have none) | $0 | $0 |
| Convex (publish calls only, a few per change) | inside the cloud plan's Starter | inside Starter | inside Professional |
| The apps domain | about $1.25 ($15 a year) | about $1.25 | about $1.25 |
| **Total** | **about $1** | **about $1** | **about $6** |

The same traffic on Convex static hosting would be about 2.7 million function calls (about $4) plus
the egress of every file at 1000 people, and still need Cloudflare in front for the addresses. GitHub
Pages costs nothing but breaks the private code repos and its own rules.

**Recommendation**: hosting is free to the person, with fair-use limits (10 web apps each, a soft cap
of 1 million opens a month per app, then we ask). At these numbers metering it from credit would
cost more to build than it brings.

### "We don't store code"

Built files are not code in the sense the user meant: the same reasoning `docs/CLOUD.md` uses for
APKs ("APKs are build output, not code"). The source, its history and the chat stay in the person's
GitHub repo (cloud mode) or on their PC (PC mode). But a web bundle is easier to read than an APK, so:

- Only `dist/` is uploaded, and **never source maps** (`*.map` is dropped and the bundle's
  `sourceMappingURL` comment removed), so the original files and their names cannot be rebuilt from
  what we host.
- **Every file is scanned for secrets before upload** (`server/src/secrets.ts`, the scanner that
  already guards published APKs). A hit refuses the publish and names the file: anything in a web
  bundle is public to anyone with the address.
- The person can delete a site (all its versions) at any time; deleting an app deletes its site.
- Settings says it in one line: "Kiwimake keeps your web app's built files so it can run. Your code
  stays on your GitHub (or your PC)."

## 3. Data

### Where a web app keeps its data

| | **First version: in the browser only** (recommended) | Next: shared data in Convex (+5 days) |
| --- | --- | --- |
| How | The template's `storage.ts` (AsyncStorage, which uses `localStorage` on web) and IndexedDB for bigger things. The app asks the browser to keep it (`navigator.storage.persist()`) | A small per-app document store in Kiwimake's Convex: `appData` rows (`appId`, `space`, `collection`, `docId`, `data`, `updatedBy`), with live queries through a tiny `src/lib/shared.ts` (`useShared`, `put`, `remove`) |
| Good for | Personal apps: a tally, a tea timer, a diary | A family shopping list, a shared chore chart, scores between friends |
| Offline | Fully | Reads the last copy; writes wait for the connection |
| Across devices | No: each browser and Kiwimake's WebView have their own copy | Yes |
| What we store | Nothing | The app's data, never its code |
| Also for APKs | No | Yes: the same API works in Android apps through the Convex React Native client |

### Sign-in for the app's own users

- First version: **none**. An app with data in the browser needs no account.
- With shared data: **"Sign in with Kiwimake"** (the Google or email code sign-in the cloud and circles
  already plan, Convex Auth), one tap inside Kiwimake's WebView (the phone app passes a short-lived
  token through the bridge), a normal sign-in page in a plain browser. A **space** is who shares the
  data: "just me", "this circle", or "anyone with this link" (an unguessable share code). The owner
  sets the default in the app's Settings; the agent never invents another login system.

### Privacy

- Browser-only data never leaves the device; the agent never sees it.
- Shared data: only members of the space can read it; the owner of the app cannot read other
  people's private spaces; the app's agent never reads it (no tool for that), only the shape of it.
  Each person can export and delete their data; deleting an app deletes all its data after 30 days.
  Limit 50 MB per app at first.
- The Worker keeps no logs of who opened what beyond Cloudflare's own counts. No analytics in the
  apps; the noindex header keeps them out of search engines.
- AI: the key never reaches a browser. Inside Kiwimake, a web app asks through a small bridge
  (`window.kiwimake.ai`, injected only into the owner's own apps' web screens), and Kiwimake calls its
  existing AI proxy path with the person's key, with the same per-app switch, limits and usage line
  as Android apps. In a plain browser the AI parts say "Open this in Kiwimake to use AI" (a hosted AI
  proxy on the owner's key is a later question).

## 4. Both modes, and how every feature works for web apps

### PC mode

The companion builds, the phone shows, our hosting serves.

1. After each turn the builder runs `buildWeb({ dir, buildNumber, onLog })` (new, next to
   `buildApk`): `expo export -p web`, Workbox, the manifest, drops source maps, and returns
   `{ distDir, files: [{ path, size, sha256 }], sizeBytes }`. TypeScript is checked as for APKs; a
   failed build goes back to the agent (up to 3 times), as today. An app with both targets runs both
   builds; the web one finishes first and goes live first.
2. The companion publishes it through Convex (section 2). For that the PC needs an **Kiwimake
   account**, asked for only where it is needed (the build card's "Put it online"), never as a
   step of the desktop's onboarding. The person signs in once, on the phone or the PC, and the
   other side joins through pairing: the same account and sign-in as circles and the cloud
   (`docs/CLOUD.md` section 3, "One account, two places that make apps"). The companion publishes
   with the cloud's PC link (`pcLinks`, its `web` scope), which can do nothing but publish this
   person's web apps (and what its other scopes allow); it is stored like the other secrets and
   never put in an agent's environment.
3. The chat's build card: "Your web app is live" with the address, Open and Share. The phone's tile
   updates, and an open copy shows the Reload card.
4. Without an account, or offline, the web app still builds and the owner's phone opens it from the
   companion (`GET /api/apps/:id/web/*`, the same auth as `/apk`, inside Kiwimake only). The card says
   "Not online yet: sign in to give it an address." (on the phone or the PC).

### Cloud mode

The box builds and publishes; nothing else changes. The runner calls the same `buildWeb` and the
same publish calls (it already talks to Convex), and the code is pushed to the person's GitHub as for
every cloud app. A web-only app never runs Gradle, so its box can be the smaller size (2 vCPU,
4 GiB), about half the machine time of an Android change. About 1.5 days on top of the cloud's first
version (the image gets the web packages warm; the runner learns the targets).

### Versions, undo, What changed

- A version is still a successful build with its commit (`docs/VERSIONS.md`). For a web app it is
  also a file list in R2. The last 20 are kept (cheap, because files are shared).
- **Go back and Undo are instant**: Convex moves "current" to that version's file list, and the PC
  (or the box) makes the "Back to version 2" commit as today so the code matches, then counts it as a
  new version number. No rebuild, so no build can fail. Browsers pick it up on their next open, or
  at once through the Reload card.
- **What changed**: the same `describe_change` lines, on the build card, the tile's sheet and in the
  web app's own Reload card ("Version 7 is ready: Bigger numbers for Isha").
- **Crash catcher**: the template's error boundary and `window.onerror` post a crash to a Convex
  HTTP action for that app (rate limited, no personal data, the same report fields as Android), and
  "Prayer Times crashed. Fix it?" appears in the owner's chat. This works for every visitor, not only
  the owner's phone, which is better than Android today.
- **Pull back** is the same as Go back for a web app: nothing is installed anywhere, so there is no
  "blocked" list.

### Change this app

- The "This app" section in the web app's Settings works as on Android. Who sees what:
  - **The owner inside Kiwimake**: Change this app opens the app's chat (through the bridge).
  - **The owner in a browser**: a link to `kiwimake.ai/open/<appId>`, which opens Kiwimake on the chat
    (an App Link) or says how to get it.
  - **Anyone else**: Suggest a change goes **straight into the owner's From others inbox** through
    Convex (no share text to forward: the Family circle page recommends the same for shelf apps),
    with a name field and a limit of 5 a day per browser. Make my own version works as today from a
    shared app's published code zip (`docs/CHANGE-THIS-APP.md`), and the copy can be web, Android or
    both.
- Without Kiwimake, the explanation sheet from Android, as a web page.

### Sharing and circles

- **Sharing is the address.** No releases repo, no GitHub release, no "install unknown apps": Share
  sends the link (and a QR on the PC). This removes the hardest step for family members.
- "Share with others" for a web app means only "show Change this app to others and publish the code
  zip with each version" (the code zip still goes to the public releases repo as today, never to us).
- **Circles**: a web app on a circle's shelf shows **Open** instead of Install; opening it in Kiwimake
  adds its tile; updates need nothing (the next open is the new version). Private sites ("only this
  circle") come after the first version (section 7, decision 3).

## 5. Turning a web app into an APK later, or both from one codebase

- **Web to Android**: "Make it an Android app too" on the app's sheet sets `targets` to
  `["android", "web"]`; the next turn runs both builds. The agent gets a note: replace the web-only
  fallbacks where Android can do more (exact alarms, notifications). It gets the package
  `com.anyapp.<slug>` (or `com.anyappcloud.<slug>` in the cloud), its own signing key, and from then
  on both arrive after each change. Data does not move by itself from the browser into the APK (two
  different storages); with shared data (section 3) it does.
- **Android to web**: "Put it on the web too" does the reverse for a React Native app. It works when
  the app uses only libraries with web support; otherwise the web build fails and the agent replaces
  or stubs the Android-only parts, or says plainly what will not work on the web. Kotlin and Expo
  Exact apps cannot (a rewrite; the agent says so).
- **Both from day one**: the new app sheet's plan (below) can pick both.
- Not recommended: a WebView wrapper APK around the address (a "TWA"). It would give an icon but none
  of the phone powers, which is the only reason to want an APK.

**Choosing in the New app sheet**: no new question. The plan (plan first, `docs/PAGES.md`) says
"This will be a web app: it opens from a link, no install" or "This needs to be an Android app:
alarms when closed", with a switch "Web / Android / Both" on the plan page. The playbook picks
Android when the request needs a power from section 1's table, web otherwise.

## 6. The first version

**In**: the template's web target and module stubs; PWA (manifest, service worker, offline); the web
Reload card; `buildWeb` with the secrets scan and no source maps; the Cloudflare Worker and R2 with
content-addressed files; Convex publish calls and the address table; PC mode publishing with an
Kiwimake sign-in on the desktop; the phone's web tile, WebView screen, pinned shortcut and AI bridge;
versions, instant undo, What changed, crash reports from every visitor; Change this app with
suggestions straight to From others; sharing by address; the plan page's Web, Android or Both.

**Out (next)**: shared data in Convex and Sign in with Kiwimake for the app's users (+5); cloud mode
(+1.5, after the cloud's first version); private sites, only me or only a circle (+3, a signed
cookie checked by the Worker); web push notifications (+3); "Make it an Android app too" and "Put it
on the web too" buttons (+2; the agent can do it by hand before); circles' Open on the shelf (with
circles); a hosted AI proxy for web apps in a plain browser (needs a decision on whose key pays);
the Public Suffix List entry.

| # | Milestone | Days |
| - | --------- | ---- |
| 0 | Spike: the template with web on; export the Prayer Times and Tea Timer apps for web and measure bundle size, first paint on a mid phone, export time; check every built-in module's web file compiles; a Worker plus R2 serving two test hosts from content-addressed files on the user's Cloudflare test account; the WebView screen with a service worker offline | 2 |
| 1 | Template: web packages, `targets`, the web files of the seven modules, manifest and Workbox, `WebReady`, the crash hook, Settings "This app" on web, `AGENTS.md` "Web apps", `web:check` | 3 |
| 2 | Builder: `buildWeb`, source maps dropped, the file list, CLI `build-web`, tests | 1.5 |
| 3 | Hosting: the Worker (host routing, caches, headers, one-page fallback, 404), R2 layout, Convex tables (`webSites`, `webBuilds`), `webPublish.begin` and `finish` with signed PUT URLs, addresses and handles, delete a site, fair-use counters | 2.5 |
| 4 | Companion and desktop: publishing with the cloud's PC link (its `web` scope), publishing after each build, instant go back and undo, the build card, the local preview route, the desktop's address, Open and QR; protocol additions | 2.5 |
| 5 | Phone: the web tile, the WebView screen, pinned shortcuts, the bridge (AI, Change this app, back to Kiwimake), the plan page's switch | 2.5 |
| 6 | Proof: a web app made from the phone on `emulator-5560` (a Tally or a shopping list), opened in Kiwimake and in Chrome, a change arriving with the Reload card, offline, Go back, a crash reaching the chat, a suggestion from a browser landing in From others; screenshots light and dark | 1 |
| | **First version, PC mode** | **15 days, about 3 weeks** |
| | If web apps go before the cloud: the Convex project and Kiwimake sign-in (Convex Auth) built here first | +3 |
| | Cloud mode | +1.5 |
| | Shared data and Sign in with Kiwimake | +5 |
| | Private sites | +3 |
| | Web push notifications | +3 |

**Protocol (additive, when built)**: `App.targets?` (`("android" | "web")[]`), `App.web?`
(`{ address, liveBuild, since }`), `BuildInfo.web?` (`{ files, sizeBytes, address }`),
`CreateAppRequest.targets?`, `GET /api/apps/:id/web/*` (owner preview), `POST /api/apps/:id/targets`.

**What the user would do (later, not now)**: buy the apps domain (about $15 a year) and add it to
the free Cloudflare account the Family circle plan already needs; turn on R2 there (a card is asked
for, the free tier covers this). Nothing else beyond the cloud accounts already listed in
`docs/CLOUD.md` section 11.

## 7. Decisions (12 Nov 2026)

The user took every recommendation (Q360).

1. **Template**: the same React Native template with Expo web on. A plain web template is only the
   fallback if the spike finds React Native Web too heavy.
2. **Address**: a separate domain for people's apps, one subdomain per app,
   `<app>-<owner>.<apps domain>` (about $15 a year). The domain name is the user's to pick when it is
   bought; it is not picked yet.
3. **Who can open a web app**: anyone with the address, not listed in search engines, in the first
   version. Private sites (only me, only a circle) come next (+3 days).
4. **Data**: in the browser only in the first version. Shared data in Convex with Sign in with Kiwimake
   comes next (+5 days), for Android apps too.
5. **Every successful build goes live** at the app's address, as every build reaches the owner's
   phone today; Go back is instant. A separate Testing address can come later.
6. **PC users sign in to Kiwimake to put web apps online**: free, the same sign-in as circles and the
   cloud, once on either the phone or the PC (the other joins through pairing), never a step of the
   desktop's onboarding (`docs/CLOUD.md`, decisions Q20 to Q24). Without it a web app opens only on the owner's phone through the PC.
7. **Hosting is free** to the person, with fair-use limits (10 web apps each, a soft cap of opens per
   app).
8. **When**: together with circles, right after the cloud's first version (Convex, sign-in and
   Cloudflare exist by then).
9. **Web or Android for a new app**: the plan decides and says why, with a Web, Android or Both
   switch on the plan page. The New app sheet does not change.

## Sources (checked 12 Nov 2026)

- Expo web setup: https://docs.expo.dev/workflow/web/
- Expo PWA (manual manifest, Workbox service worker, `npx expo export -p web`): https://docs.expo.dev/guides/progressive-web-apps/
- Cloudflare Workers pricing (Free 100,000 requests a day; Paid $5, 10M included, $0.30 a million; "Requests to static assets are free and unlimited"): https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare static assets billing: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare Workers limits (100 or 500 Workers per account; 20,000 or 100,000 asset files per version; 25 MiB per file): https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Pages limits (100 projects "not routinely increased"): https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare routes (`*.` matches all subhosts; a proxied DNS record is needed): https://developers.cloudflare.com/workers/configuration/routing/routes/
- Cloudflare wildcard DNS records, proxied on all plans: https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/ and https://blog.cloudflare.com/wildcard-proxy-for-everyone/
- Cloudflare Universal SSL covers first-level subdomains only: https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/
- Cloudflare R2 pricing (free tier, $0.015 a GB-month, egress free): https://developers.cloudflare.com/r2/pricing/
- Convex static hosting component: https://www.convex.dev/components/static-hosting
- Convex pricing (Starter limits, custom domains not on Free and Starter): https://www.convex.dev/pricing
- GitHub Pages limits and rules: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub Pages and private repositories: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site and https://github.com/orgs/community/discussions/22817
