# Ready apps: the gallery of official Kiwimake apps (W21)

The user answered the gallery options page (Q43 to Q48, 2026-11-18):

- **Q43, where:** on the empty Home (the apps themselves, "Start from a ready app"), and a **Ready
  apps** tile next to Make a kiwi once the person has apps. On the desktop: a Ready apps row at the
  end of the app list that opens the gallery in the chat's place.
- **Q44, the mark:** a line plus a badge. The badge reads **Official Kiwimake App**; the line is the
  app's one sentence from the list.
- **Q45, what people can do:** both. **Install** (the signed APK, no PC needed) and **Make it mine**
  (the existing `POST /api/clones`: the person's PC makes a separate own version from the app's
  published code, `docs/CHANGE-THIS-APP.md`).
- **Q46, where things live:** all of A, B and C. Each app's public `maddada/anyapp-<slug>-releases`
  (APKs, `update.json`, each version's code zip); the list as `website/public/gallery.json` in this
  repository, served at `https://kiwimake.ai/gallery.json`; and the code repos
  `maddada/anyapp-<slug>` made public with their history.
- **Q47, updates:** when the owner publishes a version (the shared-app update path: the updater in
  every app, `docs/DISTRIBUTION.md`).
- **Q48, which apps:** Water Glass, Prayer Alarm, Alarm Up, and Game renamed to **Kiwi Games**.

Then (the second round, Q49 to Q53):

- **Q49, public code: fresh repos, one commit.** The private `anyapp-<slug>` repos stay private with
  their history. The public code goes in new repos, `anyapp-<slug>-source`, that start with one
  commit of the current code (no `APP_MEMORY.md`, no PC paths, the GitHub noreply address). Built
  into the Share step as "Publish the code too" (below).
- **Q50:** Prayer Alarm's city becomes a setting first, so Ajman is not in its code, and the
  personal lines leave its notes.
- **Q51:** MIT licence on all four.
- **Q52:** Alarm Up: only "Wake-up check" becomes "Still awake?". Its `overview.md` still names
  Alarmy, and `overview.md` is public (it is in every version's code).
- **Q53:** the gallery goes in the next Kiwimake release.

## The list: gallery.json

```json
{
  "format": 1,
  "updatedAt": "2026-11-18T00:00:00Z",
  "maker": "Kiwimake",
  "apps": [
    {
      "package": "com.anyapp.waterglass",
      "name": "Water Glass",
      "line": "Tap once per glass and watch the day's goal fill up.",
      "icon": "https://raw.githubusercontent.com/maddada/anyapp-waterglass-releases/HEAD/icon.png",
      "repo": "maddada/anyapp-waterglass-releases",
      "code": "maddada/anyapp-waterglass",
      "certSha256": "<SHA-256 of its signing certificate, lowercase hex>",
      "latest": { "version": "1.0", "build": 12 }
    }
  ]
}
```

- Read by `shared/chat/gallery.ts` (`readGallery`), the same code on the phone, the desktop and the
  companion. A bad entry hides only itself; another `format` asks the person to update Kiwimake.
  Addresses must be https (plain http only to this PC: `10.0.2.2`, `127.0.0.1`, for test lists).
  `feed` and `installUrl` exist for test lists only; normally both follow from `repo`.
- Where it is read: the paired PC first (`GET /api/gallery`, kept 10 minutes, `ANYAPP_GALLERY_URL`
  points a test install at its own list, an address or a file), else straight from
  `https://kiwimake.ai/gallery.json`, then the same file on GitHub's `main`.
- The website serves it with `Access-Control-Allow-Origin: *` and a 5-minute cache
  (`website/public/_headers`). It ships with an empty list.
- **Kept by a script, not by hand:** `website/gallery-apps.json` says which apps go in and their
  words; `node website/gallery-refresh.mjs` fills `public/gallery.json` from each releases repo's
  published `update.json` (version, build, and the certificate from its `signer`). A certificate
  that differs from the one already listed is refused unless `--accept-new-key <package>` says the
  key was moved on purpose. `--check` writes nothing.

## The mark is earned, not typed

- **Install** reads the app's `update.json`, refuses it when its `signer` is not the list's
  certificate or the build was pulled back, downloads the APK for the phone's ABI, checks its size
  and SHA-256, then reads **the APK's own signing certificate** (`apkCertSha256`, native) and installs
  only when it is the list's. Then Android's own prompt, as for every app.
- **A copy already on the phone** shows the badge and Open (or Update when the list or the feed has
  a newer build) only when its installed certificate (`signingCertSha256`, native) is the list's.
  Otherwise: no badge, "The Water Glass on this phone is not the official one. Remove it to install
  Kiwimake's." and Remove it. A lookalike repo or an APK signed by anyone else can never get the mark.
- The list itself comes over https from kiwimake.ai or GitHub, or from the person's own PC.

## Updates

Apps installed from the gallery are not the person's own (Kiwimake on their phone installed them,
but their PC does not build them), so Kiwimake tells its updates provider about them
(`setGalleryApps`): `handles/<package>` answers 0 for them, and the app's own updater shows the
maker's published versions ("Water Glass 1.3 is ready"). On the owner's phone, where the same
packages are their own apps, nothing changes: Kiwimake keeps handling them. The gallery card also
offers Update when the list or the feed names a newer build.

## Make it mine

Phone: the card's Make it mine (only with a paired PC, and not for the person's own apps) opens the
existing "Make my own version" form directly (`/change?...&start=own`). Desktop: a dialog with the
version's name (default "Water Glass (Ahmad's)") and an optional first change. Both send
`POST /api/clones` with the gallery app's releases repo. Not built for cloud apps.

## Public code: "Publish the code too"

A switch in the Share dialog (desktop) and the Share screen (phone), under Share with others, shown
once the app is shared. On, each **stable** Publish also puts that version's code into the public
`<owner>/anyapp-<slug>-source` repo (`server/src/public-code.ts`):

- The first Publish after the switch went on makes the repo, with that version's code as its only
  commit. Each later stable Publish adds exactly one commit, "Water Glass 1.3 (build 12)", tagged
  `v1.3-b12`. Testing versions do not go there. The same code again adds nothing.
- Each commit holds exactly the files of that version's `<slug>-source.zip` (files the version no
  longer has are removed): never `APP_MEMORY.md`, `.env` files, keys, the chat or the private repo's
  history, and the whole zip is scanned for secrets first, as for every release.
- Author and committer are the GitHub account with its noreply address
  (`<id>+<login>@users.noreply.github.com`, from `gh api user`); no Git name or email of this PC
  can slip in (every identity setting is given, and `GIT_AUTHOR_*` / `GIT_COMMITTER_*` are removed
  from that git's environment).
- **No PC folder paths:** every Publish (with or without the switch, since the code zip is public on
  every release) is refused when a text file of the code names this PC's home folder, its apps or
  state folder, or any `/home/<name>/`, `/Users/<name>/` or `C:\Users\<name>` path, with the file and
  line. (The four gallery apps have none outside `APP_MEMORY.md`, which never goes.)
- The release is out before the code commit: if GitHub refuses the commit, the app keeps
  `sharing.codeProblem` (shown under the switch) and the next Publish tries again with its own code.
- The private repo, its history and the app's folder are never touched: the commit is made in a
  temporary clone of the public repo.

## Protocol (additive)

`GalleryApp`, `GalleryList`, and the route `GET /api/gallery`. Public code: `ShareRequest.publicCode`
(with `shared: true`), `AppSharing.publicCode`, `AppSharing.codeRepoUrl`, `AppSharing.codeProblem`. Native module (phone): `setGalleryApps`,
`signingCertSha256`, `apkCertSha256` (a new phone APK is needed).

## Proof (2026-11-18)

A test install: companion on port 8831 with its own `ANYAPP_STATE_DIR` and `ANYAPP_APPS_DIR`
(`~/aa/t/w21`), GitHub off, fake builder, `ANYAPP_GALLERY_URL` pointing at a test gallery.json with
two entries: **Test Glass** (a real signed test APK served on port 8832, its `update.json` with the
APK's SHA-256 and certificate) and **Test Tea** (the list names a certificate nobody has). A test
copy of the phone app (`com.anyappagent.gallery`, built from an isolated copy of HEAD) on the
`anyapp2` emulator (`emulator-5562`), paired by address and code.

| Step | Result |
| --- | --- |
| Empty Home | Make a kiwi, the Ready apps tile, "Start from a ready app" with both cards, each with the badge |
| Install on Test Glass | Download, SHA-256 and certificate checked ("installing com.anyapp.testglass build 3 (certificate checked)"), Android's prompt, Play Protect's scan prompt (Install without scanning), installed: `versionCode=3`, installer of record the test Kiwimake |
| Test Tea installed by adb, signed by another key | Its card: no badge, "not the official one", Remove it |
| Ready apps screen | Test Glass: badge, "On this phone", Make it mine and Open (Open launched it) |
| Home with an app | The tile next to Make a kiwi; the list is gone from Home |
| Make it mine on the phone | The own-version form at once, default name "My Test Glass" |
| Desktop (built from HEAD, own port 8841 and state) | Ready apps row; the page with both cards, light and dark; Install on a phone (QR of the APK link); Make it mine dialog |

Found and fixed during the proof: the desktop row could not open its page (the main window passed
down only ids of existing apps); the phone kept a failed internet read when the PC connected while it
ran (it now reads the list again through the PC).

Not proven: Make it mine end to end from a gallery app (it is `POST /api/clones`, proven in
`docs/CHANGE-THIS-APP.md`, and needs a published code zip on a real releases repo); the update
notice of a gallery-installed app (needs a second published version); `handles/<package>` answering
0 for a gallery app (the provider answers only the app itself, so it was not read from adb);
kiwimake.ai serving the file (the website was not deployed).
