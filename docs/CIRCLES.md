# Circles: share apps with a group through a link

The user decided the Family circle design on `C:\aa\ideas\family-circle.html` (2026-11-12, questions
Q350 to Q359). A circle is a small group (a family, a few friends) with one **shelf** of apps its
members share, one **invite link**, and the people on it. This file is the agreed plan for when it is
built, **right after the cloud's first version** (`docs/CLOUD.md`), alongside cloud sharing. Status:
**the agreed plan, nothing built, nothing signed up for.**

The product name is **Kiwimake** (decided 2026-11-12) and its domain is **kiwimake.ai** (being
bought); see "The name" below for what that touches.

What it builds on:

- `docs/CLOUD.md`: Convex (one deployment, US East), Convex Auth (Google or an email code), the
  `users` table, Convex file storage, the rule "we do not store code".
- `docs/DISTRIBUTION.md`: "Share with others" (a public, releases-only GitHub repo per app), the
  release and `update.json` format, the updater in every app, and Kiwimake taking over updates
  of shared apps (stage 5).
- `docs/CHANGE-THIS-APP.md`: Suggest a change, the owner's From others inbox, "Make my own version",
  and the code zip carried by every public release.
- `docs/FAST-LANE.md`: quick updates (a signed zip with the new JavaScript bundle).

## What was decided

The user took every recommendation on the page, with two changes (Q353 and Q356), and added to
Q351 and Q352.

| Q | Decision |
| - | -------- |
| Q350 | All recommendations as drawn on the page, except where this table says otherwise. |
| Q351 | kiwimake.ai sits on Cloudflare's free plan, which forwards `/c/*` and `/.well-known/*` to Convex **without a redirect**, so Android App Links verify. |
| Q352 | **Sign in to join** (Google or an email code): the cloud account, the same one for cloud and circles. |
| Q353 (changed) | **Both, by how the app is shared.** The user: "If the app is public we do A (since it's on a public GitHub repo); if the app is private and shared only with this group, then B." A public app sits on the shelf as an unlisted link to its public GitHub releases. A private app shared only with a circle has its APKs (and quick update bundles) stored in Convex behind the circle, downloadable only by members. |
| Q354 | Every member who has shared apps can put them on the shelf; the admin can take any app off. |
| Q355 | A suggestion from a member lands directly in the owner's From others inbox. |
| Q356 (changed) | **Push through Firebase Cloud Messaging**: "Sara shared Quran notes" arrives right away. Needs a Firebase project (setup below). |
| Q357 | Invite links last 7 days and take up to 10 people. |
| Q358 | Built right after the cloud's first version, alongside cloud sharing. |
| Q359 | Nothing more. Product name: not final. |

## What it looks like

The mockups are on the page above (all in the Workbench look, `shared/theme/`):

1. **PC**: the desktop app's rail gets a "Circles" group. New circle asks only for a name. The circle
   page has "Invite people" (the link, Copy link, Stop this link, "Lasts 7 days, up to 10 people,
   anyone with it can join", a QR) and "Your apps on this shelf" (one switch per app). The phone app
   has the same page; its link goes out through Android's share menu.
2. **Phone, link tapped, Kiwimake installed**: it opens on **Join "Yahia family"?** (who invited
   you, how many people and apps), "Your name in this circle", two plain lines (they see your name
   and the apps you share; nobody sees what you install or use), Continue with Google, Use an email
   code, Not now.
3. **Phone, link tapped, no Kiwimake**: a small page served by Convex: who invited you, "Get
   Kiwimake" (Android asks once to allow installs from the browser), "tap the invite link
   again", or "install one app" from the circle's public apps.
4. **The circle's shelf** (Shelf and People tabs): tiles grouped "From Mohamad", "From Sara", each
   with Open, Install or Update. Tapping an app shows its sheet with install progress and Suggest a
   change and My own version (the Change this app choices, unchanged).
5. **A notification**: "Workout 1.3 is ready. Tap to update." and "Sara shared Quran notes."

## 1. How a link reaches the app

```
 Member taps https://kiwimake.ai/c/K7Q2M9XT
   Android, Kiwimake installed:  App Link verified -> opens Kiwimake on Join
   Android, not installed:           browser -> Cloudflare (free) -> Convex HTTP action -> the invite page
```

- **Cloudflare, free plan.** kiwimake.ai's DNS and a small Worker live in a free Cloudflare account.
  The Worker is attached to exactly two routes, `kiwimake.ai/c/*` and `kiwimake.ai/.well-known/*`, and
  **fetches** the same path from the Convex deployment (`https://<name>.convex.site`) and returns the
  answer as it is: no redirect, same status, same headers. (Convex's own custom domains need its Pro
  plan, $25 a month; that was the other choice in Q351.) Any other path on kiwimake.ai is not part of
  circles. The Worker never sees more than Convex already serves publicly.
- **Convex HTTP actions** (`cloud/convex/http.ts`) serve three things:
  - `GET /c/:code`: the invite page (HTML, no scripts needed), with Open Graph tags so a chat shows
    "Mohamad invited you to Yahia family".
  - `GET /c/:code/preview`: the same facts as JSON for the phone's Join screen (circle name,
    the inviter's first name, member and app counts, and whether the link is valid, expired, full or
    stopped). It says nothing else and is rate limited.
  - `GET /.well-known/assetlinks.json`: the App Links proof. Android **refuses this file behind a
    redirect**, which is why the Worker forwards and does not redirect. It names `com.anyappagent` and
    the phone app's own release key certificate (`0b0621e6...702fd7`, `docs/RELEASING.md`; the key
    exists since 0.2.0). Debug copies on the emulator are signed with another key and get no App
    Link: they take the code from the page's "Open in Kiwimake" button (a `anyappagent://join?code=`
    link) or the "Have a code?" field on the first screen.
- **The phone app** declares an intent filter for `https://kiwimake.ai/c/` with `autoVerify`, and a
  `/join/:code` route (the router already handles `anyappagent://` links, such as `change`).
- **If verification fails** on some phone (it can be switched off per app in Android's settings),
  the link opens the page, and the page has the same button. Nothing breaks, it costs one tap.
- **Names**: the link carries only the 8-character code. Alphabet without look-alikes
  (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`, 31 characters, about 8.5 x 10^11 codes), made from random
  bytes, never from the circle's name or id.

## 2. The data model in Convex

Tables added to the cloud's Convex project (`cloud/convex/schema.ts`). `users` is the cloud's own
table: one account for the cloud and for circles. `_id` and `_creationTime` are Convex's. Times are
milliseconds. File ids are Convex storage ids.

| Table | Fields (short) | Indexes |
| ----- | -------------- | ------- |
| `circles` | `name`, `createdBy` (user), `createdAt`, `memberCount`, `appCount` (kept in step in the same mutations), `maxMembers` (default 25), `deletedAt?` | `by_creator` |
| `members` | `circleId`, `userId`, `name` (their name in this circle), `role` ("admin" or "member"), `joinedAt`, `lastSeenAt`, `muted` (no pushes from this circle), `removedAt?` | `by_circle`, `by_user`, `by_circle_user` |
| `invites` | `circleId`, `code`, `createdBy`, `createdAt`, `expiresAt` (default +7 days), `maxUses` (default 10), `uses`, `stoppedAt?` | `by_code`, `by_circle` |
| `shares` | One app on one circle's shelf. `circleId`, `ownerId` (a member), `package`, `name`, `slug`, `iconFileId?`, `kind` ("public" or "private"), `version`, `build`, `notes`, `signer` (SHA-256 of the app's certificate), `updatedAt`; public: `releasesRepo` (`owner/anyapp-<slug>-releases`), `feedUrl`, `hasSource`; private: `appBuildId` (the current published build); `removedBy?`, `removedAt?` | `by_circle`, `by_owner`, `by_circle_package` |
| `appBuilds` | The private files of one published build, stored once per app however many circles show it. `ownerId`, `package`, `build`, `version`, `channel` ("stable" or "testing"), `notes`, `signer`, `apks` (`{abi, fileId, sizeBytes, sha256}[]`), `otaFileId?`, `otaSizeBytes?`, `commit`, `blocked` (pulled back), `publishedAt` | `by_owner_package_build` |
| `suggestions` | `shareId`, `circleId`, `package`, `build`, `fromUserId`, `fromName`, `toUserId` (the owner), `text`, `createdAt`, `filedAt?` (set when the owner's PC or phone put it in From others), `openedAt?` | `by_owner_unfiled`, `by_share` |
| `devices` | A phone that gets pushes. `userId`, `fcmToken`, `appPackage`, `createdAt`, `lastOkAt`, `disabledAt?` | `by_user`, `by_token` |
| `pushes` | The outbox. `userId`, `kind` ("shared", "update", "suggestion", "joined"), `circleId`, `shareId?`, `title`, `body`, `dedupeKey`, `state` ("queued", "sent", "dropped"), `createdAt`, `sentAt?` | `by_user_state`, `by_dedupe` |
| `pcLinks` | The cloud's PC link (`docs/CLOUD.md` sections 3 and 4), built in the cloud's first version; circles use its `share` scope: publish and refresh this user's shares and read their suggestions | `by_hash`, `by_user` |

Notes:

- **Roles.** Whoever makes a circle is its admin; an admin can make another member an admin. An
  admin can stop or renew the link, change its days and people, remove any app from the shelf,
  remove a member, rename the circle, and delete it. A member can share and un-share their own apps,
  leave, and mute. The last admin cannot leave without naming another or deleting the circle.
- **What the circle knows about a person**: their name in the circle, their role, when they joined
  and last opened it, and the apps they share. **It does not record what anyone installs or uses**
  (the Join screen says so, and the schema has no field for it). Public downloads are counted by
  GitHub as today, for the owner only.
- **Limits** (rate limiter component, all changeable): 25 members a circle; 10 circles a person
  makes; 30 apps on a shelf; 20 invite page views a minute per address; 10 joins an hour per
  address; 10 suggestions a day per member per app, 2,000 characters each.
- **Public shares keep a copy of the feed** (`version`, `build`, `notes`, `signer`) so the shelf
  draws without calling GitHub. It is refreshed when the owner publishes (the PC or phone tells
  Convex) and by a cron every 6 hours reading `releases/latest/download/update.json` (a download
  address, not the GitHub API, so the 60 an hour limit of the API does not apply).
- **Private builds are kept** like cloud builds: the last 3 per app, never one a circle's shelf still
  points to, deleted when no shelf shows the app any more.
- **Where the files of a cloud app already are**: a cloud app's builds are in Convex already
  (`builds`, `docs/CLOUD.md`). Sharing it privately makes an `appBuilds` row that points at the same
  file ids, so nothing is copied, and the cloud's retention rule also keeps a build a shelf points
  to.

## 3. The flows

### Make a circle and its link

1. The person signs in once, on either side (desktop: a browser page, then back; phone: Google or an
   email code, the same screens as the cloud's), right where Circles asks for it. The other side
   joins through pairing (the PC link, `docs/CLOUD.md` section 3, "One account, two places that make
   apps"), so no one signs in twice. A PC user's apps keep being made on the PC; the account is
   optional for everything else.
2. New circle asks only for a name. `circles.create` makes the circle, the person's `members` row (admin)
   and the first invite, and shows the link and QR. Share goes through Android's share menu on the
   phone and Copy link on the PC.
3. Admins can Stop this link (sets `stoppedAt`, the page then says "This link was stopped. Ask
   Mohamad for a new one"), renew it, and change the days and the people. A link past its days or
   full says so on the page and on the Join screen.

### Join

1. Tapping the link opens Kiwimake on Join (section 1). Join calls `/c/:code/preview` and shows
   the circle. The person signs in if they are not (Continue with Google or Use an email code), types
   their name (prefilled from the account), and taps Join.
2. `circles.join(code, name)` checks the invite (not stopped, not expired, `uses < maxUses`, the
   circle not full, the person not already in), adds the `members` row, and adds one to `uses`, in
   one mutation, so two people cannot both take the last place.
3. The shelf opens. The admin gets one quiet push ("Nana joined Yahia family") only if they turned it
   on; it is off by default.
4. **Without Kiwimake**: the page offers **Get Kiwimake** (the latest phone release on GitHub,
   `https://github.com/maddada/AnyAppAgent/releases/latest/download/AnyAppAgent.apk`, `docs/RELEASING.md`),
   and "tap the invite link again". It also lists the circle's **public** apps (name, who shared it,
   size) with an Install link to each app's public GitHub release, so one app can be had without
   joining. **Private apps are never listed there**: their tile reads "Join to get this one".

### The shelf

- **Sharing an app into a circle** (desktop and phone: a switch per app on the circle page, or "Share
  with a circle" in the app's Share sheet). What happens depends on the app:
  - **The app is public** (its "Share with others" switch is on, so its releases repo is public,
    `docs/DISTRIBUTION.md` stage 2): a `shares` row of kind `public` with its releases repo and feed.
    Nothing is uploaded. It needs at least one published version; if there is none the switch asks to
    Publish first.
  - **The app is private** (not shared with others): the switch says "Only people in your circles can
    get this. Their phones download it from Kiwimake's cloud, not from GitHub." Turning it on
    makes a `shares` row of kind `private` and uploads the app's latest published build (section 4).
  - An app that is public **and** on a shelf is a `public` share: the shelf is only a listing of it.
- **Unlisted** means what it says: a public app's releases repo is public on GitHub, so anyone who
  finds the link can install it (and read its code zip, `docs/CHANGE-THIS-APP.md`). The shelf does
  not advertise it, and the circle's own page never shows more than the circle's members and invite
  holders can see. The Share dialog says this before the first public share.
- **Every member who has shared apps can put them on the shelf; the admin can take any off.** An
  admin's removal sticks: the owner sees "Removed by Mohamad" and cannot put that app back until the
  admin allows it. A member can un-share their own apps at any time.
- **Open, Install, Update** on a tile: the app is on the phone (Open), is not (Install), or the shelf
  has a newer build than the phone's `versionCode` (Update).
- A member who leaves, or is removed, **keeps the apps already installed** (nothing can reach into a
  phone) but gets no more updates from the circle, and the shelf closes to them at once. Deleting a
  circle removes its shelf and the private files nobody else's shelf shows.

### Install and update

- **Public share**: Kiwimake does what stage 5 of `docs/DISTRIBUTION.md` describes: reads the
  feed from GitHub itself, downloads the APK for the phone's ABI from the releases repo, checks size,
  SHA-256 and signer, and installs through `app/src/lib/installer.ts`. **This is the piece stage 5
  left unbuilt** ("following a friend's app from a share link inside Kiwimake"): the shelf is
  where it lives. The app's own updater stays quiet because Kiwimake says it handles that package.
- **Private share**: the same steps, but the file comes from Convex through a gated endpoint
  (section 4), and **the app has no GitHub feed in it**, so its own updater has nothing to check and
  stays silent: updates of a private app come only through Kiwimake and the circle. (This is
  consistent: nobody can be in a circle without Kiwimake.)
- **Updates**: while Kiwimake is open, Convex live queries show a new build at once. When it is
  closed, a push says so (section 5), and the daily background check of the stage 5 job remains as the
  fallback. One notification per app and build (its id is the package and the build number), so a
  push and the local check never show it twice.
- **Quick updates** (`docs/FAST-LANE.md`): a private app's published build can carry its quick update
  zip. Kiwimake hands it to the app exactly as it does for the owner's own apps (the Reload card).

### Suggest a change (Q355)

Today a suggestion is a text the friend shares and the owner pastes (`docs/CHANGE-THIS-APP.md`).
For a shelf app it goes straight in:

1. On a shelf app's sheet, Suggest a change opens the same small form. Send calls
   `suggestions.send(shareId, text)`. The message has the same format as the share text, including its
   last line `anyapp-suggestion: <package> <build>`, so the filing code that reads it today reads it
   unchanged.
2. The owner's Kiwimake has a live query on `suggestions.forMe`. For each new one it files it into
   From others: with a PC, through the existing `POST /api/suggestions` (`FileSuggestionRequest`) on the
   paired companion; for a cloud app, into the cloud app's inbox in Convex. It then sets `filedAt`.
   If the owner's phone is closed it waits in Convex and arrives when the phone opens (or the push
   brings the phone up).
3. The owner sees it in From others exactly as before, and "Open in chat" works as before. Nothing
   is sent to the agent until the owner sends it. Text sharing stays for everyone outside a circle.

**Make my own version** on a shelf app works for **public** apps (their releases carry the code zip).
For a **private** app it is off, with one plain line ("Mohamad shared this one only with the circle,
without its code"), because private storage holds no code (section 4).

## 4. Private apps in Convex (the second half of Q353)

**Does this break "we don't store code"?** No. What is stored is the app's **build output**: signed
APKs and the quick update zip, which is what `docs/CLOUD.md` already keeps in Convex for the cloud's
own apps ("APKs are build output, not code"). The code, the Git history, the app's notes and the
chat with its agent are never uploaded. A private circle app carries **no code zip** (the code zip
rides only on public releases). An APK can be unpacked, as `docs/DISTRIBUTION.md` says: this keeps
the source private, not how the app works. Convex also encrypts all data at rest.

**What is uploaded.** On Publish to a circle (the same Publish version action as for GitHub, with the
circle shown as the place), the PC (a PC app) or Convex itself (a cloud app) stores:

| File | Why |
| ---- | --- |
| The `arm64-v8a` APK (phones) | The install |
| The quick update zip, if the build has one | Reload and quick updates |
| `appBuilds` row with SHA-256 and signer | What the phone checks before installing |

Not the universal APK and not the `x86_64` one (an emulator is not a circle member), to save space.
A PC app uploads through the PC link (below); a cloud app's files are already there.

**The PC's link.** The PC needs a credential that can upload for its owner but nothing else: the
cloud's **PC link** (`pcLinks`, `docs/CLOUD.md` section 3), made when the person signs in on either
side (the desktop app, or the paired phone handing it over through pairing): random, shown once,
stored only as a hash, kept by the companion in its state folder (`%USERPROFILE%\.anyappagent`),
revocable from the desktop's Account page or the circle's page. Its `share` scope allows only
publishing builds and refreshing shares for that user's apps and reading that user's suggestions.

**Who may download.** Convex's `getUrl()` links work for anyone who has them until the file is
deleted (`docs/CLOUD.md`), so a plain link would not be "behind the circle". Instead **no file URL is
ever handed to a client**. A Convex HTTP action `GET /files/:buildId/:abi` takes the member's sign-in
token, checks that the person is in a circle whose shelf shows that build and was not removed, and
answers with the file (`ctx.storage.get`, response up to 100 MiB, an APK is 30 to 50 MB). It supports
a `Range` request so a broken download can resume, and the phone checks size and SHA-256 as for any
download. The milestone checks the HTTP action's limits with a real 45 MB APK before anything else
is built on it; if it falls short, the `@convex-dev/r2` component with expiring links (as
`docs/CLOUD.md` plans for the cloud) takes over without changing the phone.

**Signing.** Unchanged: the app's own key, on the PC or the cloud. The phone's installer checks that
the `signer` equals the installed app's certificate before replacing it, so an update from a circle
can only replace the app it belongs to.

**Pull back** (`docs/DISTRIBUTION.md`): the build goes in `blocked`, the shelf shows the one before,
and a phone that has not installed the blocked build skips it. The Testing channel works the same:
an `appBuilds` row with `channel: "testing"` that only people who switched that app to Testing see.

## 5. Push notifications through Firebase Cloud Messaging (Q356)

"Sara shared Quran notes" and "Workout 1.3 is ready" arrive as soon as they happen, even with
Kiwimake closed.

- **Registering.** After the person joins their first circle (not at install), Kiwimake asks for
  Android's notification permission with a plain line of why, gets its FCM token (`google-services.json`
  in the phone app's build, the Firebase library or `expo-notifications` with the device push token),
  and calls `devices.register`. The token is renewed when it changes and dropped when the person signs
  out or FCM answers that it is no longer valid (`UNREGISTERED`).
- **Sending.** An event (an app put on a shelf, a new build, a suggestion, optionally a join) writes
  `pushes` rows for the people it concerns and schedules `internal.push.send`, a Convex Node action
  that calls the FCM HTTP v1 API (`POST https://fcm.googleapis.com/v1/projects/<project>/messages:send`)
  with an access token made from the Firebase service account (kept in a Convex environment
  variable, cached under its hour). Never sent to the person who caused the event, never to a muted
  circle.
- **No spam.** `dedupeKey` makes one push per (person, circle, kind, app) at most every 10
  minutes, and several apps shared at once become one line ("Sara shared 3 apps"). Settings has a
  switch per kind and a mute per circle. A push opens the circle's shelf on that app.
- **Phones without Google Play services** (some Huawei and custom ROM phones) get no push. They
  still get everything when Kiwimake opens and from the daily background check, as without push.
  The emulator image is Google APIs (`docs/ENVIRONMENT.md`), so push can be tried there.
- **Privacy.** A push carries the app's name, the sharer's name and the circle, which go through
  Google's FCM like any push. No code, no file and no install information is in one.

## 6. What it costs

Everything on top of the cloud plan, a month:

| Part | Cost |
| ---- | ---- |
| Convex, circles, invites, shelves, suggestions, devices | Rows and a few calls a day, inside the Starter allowance (1M calls free, then $2.20 per million). About 30 to 60 calls per person per day with live queries. Nothing extra to speak of. |
| Convex, private APKs and quick updates | **File storage**: 1 GB included on Starter, then $0.033 a GB; Professional includes 100 GB, then $0.03. **Egress**: 1 GB included, then $0.132 a GB; Professional 50 GB, then $0.12. (https://www.convex.dev/pricing, checked 2026-11-12; the allowances are shared with the cloud's own files.) |
| Cloudflare in front | $0 (free plan; the Worker's free allowance is 100,000 requests a day, to confirm in the spike; an invite page view or a Join is one request) |
| Firebase Cloud Messaging | $0 (Spark plan; FCM has no per-message charge) |
| GitHub, public apps | $0 (public releases, as today) |
| The domain | kiwimake.ai: .ai sells for at least 2 years, about $160 up front at Cloudflare's $80 a year (already in the cloud plan) |
| Resend, email codes from our own address | The cloud's account; its free tier covers a family. Verifying the domain there is the only new step. |

**Worked example for private storage.** One private app is about 45 MB per build (the arm64 APK
plus a quick update of 1 to 5 MB), 3 builds kept: about **135 MB**. 100 private apps are 13.5 GB: about
$0.41 a month on Starter above the free GB, and it fits Professional's 100 GB. A download of one
build is about 45 MB, so $0.006 beyond the free 1 GB. A family of 5 with 4 apps updating once a
month each is about 1 GB: **about $0 to $0.15 a month**. A quick update is 1 to 5 MB. If circles of
private apps grow to hundreds of GB of downloads a month, the R2 component moves the files without
an egress fee (as `docs/CLOUD.md` plans), and nothing changes for the phone.

The abuse guard that keeps it that way: at most 10 private apps and 500 MB of private builds per
person, 30 apps a shelf, 25 members a circle, rate limits on the invite page and on downloads (60
files an hour per member). All numbers are defaults in one config.

**Who pays**: us, as the cloud's Convex bill. It stays free to the people. Nothing in circles is
charged from a person's credit.

The page's chip said "New cost: $0 a month" and "APKs stay on GitHub". That is true for public apps;
with private apps it becomes "about $0 to a few cents a month at family scale".

## 7. The name

The name is Kiwimake (decided 2026-11-12). Circles touch the name in four places, all of them
with kiwimake.ai:

- the domain (`kiwimake.ai` in the link, the Cloudflare zone, the Resend sender);
- the phone app's manifest (the host of the App Link intent filter) and `assetlinks.json`;
- the Firebase project's display name and the notification text;
- the wording of the invite page and Join screen.

After a release the host of the intent filter is baked into every installed phone app. If the name
changes later, **keep the old domain forwarding** and list both hosts in the next release, so old
links keep opening the app. The package ids (`com.anyappagent`, `com.anyapp.<slug>`) do not change
with a display name.

## 8. The first version

**In**: sign in with the cloud account; make, rename and delete a circle; the invite link and QR
(7 days, 10 people by default, the admin can change or stop it); the invite page, App Links through
Cloudflare; Join; the shelf with public (unlisted GitHub) and private (Convex) apps; install, update
and quick update from the shelf, one notification per build; Suggest a change straight into From
others; push through FCM; the People tab; leave, remove and promote; the desktop pages and the
phone's. Both the PC and the cloud can share.

**Out**: chat or comments inside a circle; a public directory of circles; install counts per person;
per-app visibility inside a circle; letting only admins put apps on the shelf (Q354 chose everyone);
iOS; a code zip for private apps (so no "Make my own version" of a private app); selling anything.

## 9. Milestones

The days are working days, and count the two changes of the user's answers (Q353 both, Q356 push).

| # | Milestone | Days |
| - | --------- | ---- |
| 0 | **Spike**: the domain on Cloudflare, the Worker forwarding `/c/*` and `/.well-known/*` to a Convex HTTP action, `assetlinks.json` served with the release key's certificate and verified on the emulator (`adb shell pm get-app-links`, `pm verify-app-links --re-verify`, then a real link tap opening a dev build of the phone app), and the Worker's request limit read in the dashboard | 1 |
| 1 | Convex backend: schema (circles, members, invites, shares), create, join, leave, remove, roles, link renew and stop, the limits and rate limits | 1.5 |
| 2 | The web side and the link: the invite page, preview JSON, expired, full and stopped states, Open Graph tags, the `autoVerify` intent filter, the Join route and screen, the "Have a code?" field | 1.5 |
| 3 | The shelf, public (unlisted): `shares`, the per-app switch, the feed copy (publish hook and the 6 hour cron), admin removal that sticks | 1.5 |
| 4 | Phone: circles list, the circle (Shelf and People), invite and share sheet, install and update of a public shelf app through the installer (the stage 5 follow-a-friend piece), the notification and its dedupe, the Suggest a change form | 2 |
| 5 | Desktop: Circles in the rail, New circle, the invite panel and QR, the switches, and the sign-in sheet and PC link reused from the cloud (`docs/CLOUD.md` milestone 7) | 1 |
| 6 | Suggestions straight into From others (live query, filing through `POST /api/suggestions`, `filedAt`) | 0.5 |
| 7 | **Proof of the public path** on the emulator and real GitHub test repos (below) | 1 |
| | **Circles, public apps only (the page's "about 2 weeks")** | **10** |
| 8 | **Private apps in Convex (Q353 B)**: `appBuilds`, the check of the 45 MB gated download, upload from a PC with the PC link and from the cloud's own files, retention, Publish to circles with Testing and Pull back, install and update from Convex, quick update bundles, the quotas, and its proof (page said about 3 days; the quick update bundles add half a day) | 3.5 |
| 9 | **Push through FCM (Q356)**: the Firebase project, `google-services.json` in the phone build, notification permission, `devices`, the outbox and its dedupe, the Node action with the service account, settings and mute, and its proof on the emulator (page said about 2 days) | 2 |
| | **All of Q350 to Q359** | **15.5 days, about 3 weeks** |

What changed in the days from the page's "about 2 weeks": +3.5 for private apps (the page's
circle-only option, +3, with the quick update bundles) and +2 for push. The page's recommended
design had neither (unlisted only, push on open).

If the cloud's first version slips, nothing here starts: milestone 0 needs its Convex project and
sign-in.

## 10. What the user will need to set up (later, not now)

These come on top of the cloud's list (`docs/CLOUD.md` section 11); the cloud's Convex, Google
sign-in and Resend accounts are reused. Do them in order before milestone 0. **Put every value in the
1Password item `Kiwimake Cloud (dev)`** and never paste a key in a chat.

1. **Buy the domain** kiwimake.ai (the name is decided, section 7), about $160 up front for the
   first 2 years of a `.ai`. Buying it at **Cloudflare** Registrar puts its DNS there at once.
2. **A Cloudflare account** (free plan) at https://dash.cloudflare.com/sign-up. Add the domain if it
   was bought elsewhere. Make one **API token** with "Workers Scripts: Edit", "Workers Routes: Edit"
   and "Zone DNS: Edit", for that one zone only, and hand over the token and the account id. (A thread
   then deploys the Worker and its two routes; the Worker code is in `cloud/`.)
3. **A Firebase project** (free Spark plan, no billing) at https://console.firebase.google.com:
   Add project, and choose the existing Google Cloud project `anyappagent-cloud` (the one that holds
   the Google sign-in client, `docs/CLOUD.md` step 6). Then Add app, Android, with the package name
   `com.anyappagent`. Hand over: `google-services.json` (downloaded there), the project id, and a
   service account key: Project settings, Service accounts, "Generate new private key" (a JSON file;
   a secret that goes into a Convex environment variable, never into a repository). Test copies of the
   phone app under other package names are added as more Android apps in the same project when a
   thread needs push on them.
4. **Resend**: verify the new domain in the cloud's Resend account (it gives DNS records to add in
   Cloudflare), so email codes come from the project's address and reach people other than yourself.
   This is the cloud's step 10 (a domain) and step 7, now with the real domain.
5. Nothing else: no Apple account, no Google Play developer account (the phone app is never published
   to a store), no payment for Convex beyond the cloud's plan.

Each of these also goes on the "Later" list of `docs/CLOUD.md` section 11 (items 12 to 14).

## 11. Proof when it is built

On `emulator-5560` with the thread's own copy of the phone app, test GitHub repos that are deleted
afterwards, a test Convex deployment and a test Cloudflare route (screenshots in `C:\aa\e2e\circles`,
light and dark):

| Step | Expected |
| ---- | -------- |
| `pm get-app-links` and a real tap on `https://kiwimake.ai/c/<code>` | The phone app opens on Join (a debug copy: the page's button) |
| The same link in the emulator browser with no phone app | The invite page, with Get Kiwimake and the public apps |
| Expired, stopped, full and used-up links | Each says so, on the page and on Join |
| A second account joins; both see 2 people | Counts and names correct; nothing about installs anywhere |
| A public app on the shelf, installed and then updated by a new publish | Installs from its GitHub release; one notification; no double prompt from the app's own updater |
| A private app, shared only to the circle, installed from Convex by the second account | Installed; a file URL tried by hand without membership is refused; an updated build and a quick update arrive |
| The admin removes an app; a member leaves | The shelf closes at once; the installed copy keeps working |
| A suggestion from the second account on a shelf app | In the owner's From others on the PC and on the phone, "Open in chat" fills the composer |
| Push: the second account shares an app with the first phone closed | "Sara shared Quran notes" arrives; tap opens the shelf; 3 shares in a row make one line |
| The costs: Convex dashboard after the run | Storage and egress match section 6 |
