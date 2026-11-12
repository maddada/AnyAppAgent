# Change this app

The user picked, on `C:\aa\ideas\change-this-app.html` (2026-11-12):

- **Q240, a friend with no PC: Suggest a change** (option A), by share text now. It lands in the
  owner's "From others" inbox (desktop app page, phone app sheet); Open in chat puts it in the
  app's composer to send or edit.
- **Q241, where a friend's own version gets its code: Code in each public release** (option B).
  When an app is shared, every published release also carries that version's code. No approvals.
- **Q242, the owner's later versions: clones.** In the user's words: "We need to do clones in this
  case. For example, I will have my app, and they will have the same app, but their own version of
  it. We can have multiple versions of the same app. This way, everything is separate. I can ask my
  agent to copy from someone else, for example, but the apps are separate." So an own version is a
  fully separate app (new id, package, signing key, repo and name), installed beside the original,
  and nothing flows between them by itself. Any app's agent can be asked to copy something from
  another app (`anyapp copy`).
- **Q243, someone without Kiwimake: the explanation in the app, then GitHub** (option A). The
  sheet keeps one plain line for the cloud service planned for people without a PC (no button yet).

## What each person sees

| Who taps Change this app | What happens |
| --- | --- |
| The owner (the app is in their PC's list) | Kiwimake opens on the app's chat |
| Someone with a new enough Kiwimake, paired with a PC | "Prayer Times is Mohamad's app": Suggest a change to Mohamad, or Make my own version |
| Someone with Kiwimake, no PC | The same sheet with Suggest a change; one line says an own version needs a PC (and that a no-PC way with cloud credits is planned) |
| Someone without Kiwimake | The app's own explanation sheet: what Kiwimake is, what an own version needs (this phone, a Windows PC that stays on, a Claude account, about 20 minutes), Get Kiwimake (its latest release on GitHub), Suggest a change to Mohamad, Not now |

## In the generated apps

- **React Native**: `src/screens/SettingsScreen.tsx` (new, reached from the starter Home screen's
  Settings link) ends with `ThisAppSection` from `src/components/ChangeThisApp.tsx`: Change this
  app, Version, Made by <owner> with Kiwimake. `ChangeThisAppRow` alone is there for a settings
  list of the app's own design.
- **Kotlin**: `ui/ThisApp.kt` (`ThisAppSection`, `ChangeThisAppRow`, `SettingsScreen`), with
  `Route.Settings` in `MainActivity` and a Settings button on the starter screen.
- **The native part, one copy for both** (byte for byte, `builder/test/updater-copies.test.mjs`):
  `com.anyapp.updates.ChangeThisApp` (who sees the row, the link, the suggestion text) and
  `ChangeSheet` (the explanation sheet, plain Android views in the Workbench colours and fonts, so it
  works offline). React Native reaches them through `modules/updates` (`changeVisible`,
  `changeOwner`, `openChange`).
- **Template `AGENTS.md`**: the row, the Settings screen and a way to reach Settings must be kept;
  `ThisAppSection` stays last in the app's settings. "Keep my apps healthy" names the part
  ("updates and Change this app inside the app") and its update message says to copy the row in.
- **Expo Exact**: not built. Exact apps come from `exact new` and do not have the
  `com.anyapp.updates` module yet (no updater, crash catcher or diary either, `docs/VERSIONS.md`),
  so there is nothing for the row to call. It can follow when Exact gets a Kotlin module.

### The link

The row opens Kiwimake with the action `com.anyappagent.action.CHANGE` and

```
anyappagent://change?package=com.anyapp.prayertimes&name=Prayer%20Times&owner=Mohamad
  &repo=mohamad/anyapp-prayertimes-releases&build=37&version=1.4&screen=settings
```

- `repo` is read from the app's update feed (only a shared app has one), `owner` from the build.
- Only Kiwimake versions with this feature declare the action (`ChangeLinkActivity`, which hands
  the link to the router at `/change`), so an older Kiwimake on the phone is never opened with a
  link it does not know: the app then shows its own explanation sheet. The emulator holds a dozen
  older copies; this is what keeps them out.
- With several Kiwimake copies, the app opens the one that installed it, else
  `com.anyappagent`, else the first. Android 11+ package visibility: the templates query the action.

### Who sees the row

The PC writes two string resources into every build (Gradle properties through
`builder/anyapp.init.gradle`, part of the native fingerprint, so a change is a full build):

| Resource | Value |
| --- | --- |
| `anyapp_change_owner` | The owner's name ("Mohamad"): Git's `user.name` first word on the PC, else the Windows user name; changeable in the desktop Share dialog ("Your name in your apps"), one for the PC |
| `anyapp_change_others` | `0` when the owner switched "Show Change this app to others" off; absent (on) by default |

With the switch off the row shows only on the owner's phone: the app asks its Kiwimake's
provider `content://<host>.updates/owns/<package>` (1 when the package is in the paired PC's list,
which the phone keeps in step with `setOwnApps`; only the app asking about itself gets an answer).
The switch takes effect with the app's next version.

## Suggest a change

The message, the same from Kiwimake and from the app's own sheet (`shared/chat/suggestions.ts`,
Kotlin `ChangeThisApp.suggestionText`):

```
Ahmad suggests a change to Prayer Times:

Bigger numbers, I can't read Isha.

If you made Prayer Times with Kiwimake, share this message to Kiwimake or paste it there.
anyapp-suggestion: com.anyapp.prayertimes 37
```

It goes through Android's share menu. The owner shares it into Kiwimake (the share-in screen
hands a suggestion to the inbox instead of "Like this, but mine"), or copies it and taps
Paste a suggestion (phone: the app's sheet, From others; desktop: From others in the app's header).
The last line files it under the right app (a forwarded message with extra lines around it, or one
the owner edited, still reads). The PC keeps the inbox (`<state>/suggestions/<appId>.json`, the same
message once); `App.fromOthers` counts the ones not opened. Open in chat puts
"Ahmad suggested this change: ..." in the app's composer; nothing is sent until the owner sends it.

## Code in each public release

Every version published from a shared app also carries `<slug>-source.zip` (`server/src/release-source.ts`):

- `git archive` of the commit that version was built from (the version record's commit), so it is
  exactly that version, without history. `update.json` names it with its size and SHA-256
  (`source`), and `PublishedRelease.source` is set.
- **What it leaves out**: `APP_MEMORY.md` (the app's notes about the owner, anywhere in the tree),
  `.env` and `.env.*` files, signing keys and certificates (`*.p12`, `*.jks`, `*.keystore`, `*.p8`,
  `*.pem`, `*.key`). Never in it in the first place: the chat with the app's agent, the Git history,
  and everything git-ignored (build output, `node_modules`, the generated `android/` folder of a
  React Native app). `overview.md` (what the app should do), `AGENTS.md` and the code go with it.
- Every text file in it is scanned for secrets first; a hit refuses the publish with the file name.
- The Share dialog says so on both sides ("Each version you publish also carries its code").

## Make my own version

From the change screen on a paired phone: Your name, Name of your version (default
"Prayer Times (Ahmad's)"), First change (optional), Make it. `POST /api/clones`:

1. The PC finds the published version on the phone (`build`), else the latest stable one, through
   GitHub's public API, and downloads its code zip (anonymous, SHA-256 checked against
   `update.json`). A version published before code was included: "This version has no code in it".
2. It unpacks it (paths kept inside the folder, size limits) and `builder.adoptApp` makes a
   separate app: new slug and package (`com.anyapp.prayertimesahmads`), its own signing key, no
   build output, keys or `.env` carried over. Kotlin apps get their new name in `strings.xml`.
   Expo Exact apps are refused (not supported yet).
3. From there it is a new app on that PC: Git repo, its private GitHub repo, the agent's first
   turn (a note says it is a separate own version, nothing comes over by itself, where to copy
   from later), the build, and the phone installs it beside the original.
4. `App.madeFrom` records where it came from (name, package, owner, repo, version).

## Copy from another app

`anyapp copy <app>` (in every agent's PATH, `server/src/apps-cli.ts`): another of the person's
apps (its committed code, without the private notes, `.env` or keys), or someone's shared app by
its releases page (`owner/anyapp-<slug>-releases` or a GitHub link; `--build <n>` for an older
published version), into `<state>/scratch/copies/<name>-<time>/`, every file read only. The
playbooks tell the agent to use it only when the person asks, and to take only what was asked for.

## Protocol additions (additive)

`App.change` (`AppChangeSettings`), `App.fromOthers`, `App.madeFrom` (`AppOrigin`),
`PublishedRelease.source`, `Suggestion`, `FileSuggestionRequest`, `FileSuggestionResponse`,
`ChangeSettingsRequest`, `OwnerInfo`, `CloneRequest`, ServerEvent `suggestions.updated`; routes
`POST /api/suggestions`, `GET /api/apps/:id/suggestions`, `POST /api/apps/:id/suggestions/:sid/open`,
`DELETE /api/apps/:id/suggestions/:sid`, `POST /api/apps/:id/change`, `GET /api/owner`,
`POST /api/clones`. `update.json` gains `source`.

## Later

- The cloud service for people without a PC (paid with cloud API tokens, `docs/CLOUD.md`): the
  sheet's line "No PC? A way to change apps without one, using cloud credits, is planned." and the
  same line on Kiwimake's change screen without a PC are its place.
- A suggestion arriving by itself (a server or the Family circle idea) instead of a forwarded text.

## Proof (2026-11-12)

`emulator-5560`, my own copies of the phone app: **AA Owner** (`com.anyappagent.change`) paired with
my owner companion (port 8811, state `C:\aa\t\cta\state`) and **AA Friend**
(`com.anyappagent.change2`) paired with a second companion standing in for the friend's PC (port
8812, state `C:\aa\t\ctb\state`, GitHub off). Screenshots: `C:\aa\e2e\change-this-app`
(light and dark), desktop ones in `desktop\`.

| Step | Result |
| --- | --- |
| Owner companion, GitHub off: new app "Prayer Times" through the companion (real agent turn, real build) | The agent kept the template's Settings screen; build 1 (430 s) |
| Prayer Times installed by adb while no Kiwimake with this feature was on the phone (a dozen older copies were) | Settings: Change this app, Version, "Made by Mohamad" (`01-settings-row-*`). The row opened the app's own sheet (`02-sheet-no-anyappagent-*`), Suggest a change opened its form (`03-*`) |
| Owner copy installed it (installer of record), the row | "change: com.anyapp.prayertimes is this person's own app; opening its chat": the app's chat (`04-owner-lands-in-chat-*`) |
| Friend copy as installer, the row | "Prayer Times is Mohamad's app" with Suggest a change and Make my own version (disabled: not shared yet) (`05-friend-choices-light`) |
| Friend: Ahmad, "Bigger numbers please, I cannot read Isha at night", Send | Android's share menu with exactly the message of `shared/chat/suggestions.ts` (`06-*`, `07-*`); Copy stood in for a messenger (one emulator) |
| Owner copy: app sheet, From others, Paste a suggestion | "Ahmad suggests ... on version 1" filed under Prayer Times (`09-*`, `10-*`, `11-*`); Open in chat put "Ahmad suggested this change: ..." in the composer (`12-*`) |
| Desktop (dev build on the owner state): From others, paste a second message ("Mum") | Both listed, Mum's filed by the paste; Open in chat filled the composer; Share dialog with the switch and "Your name in your apps" (`desktop\*-change-*`) |
| Owner companion with GitHub on: Share, build 2 (carries the feed), Publish 1.0 | Repos `maddada/anyapp-prayertimes` (private) and `maddada/anyapp-prayertimes-releases` (public); release `v1.0-b2` with `prayertimes-source.zip` (239 files) and `update.json` naming it; the anonymous download's SHA-256 equals `update.json`'s; `APP_MEMORY.md` is committed in the private repo but not in the zip; no `.env` or keys in it |
| Friend copy on version 2, the row | Make my own version enabled; its form defaults to "Prayer Times (Ahmad's)" (`05-friend-choices-shared-*`, `13-friend-own-version-form-*`) |
| `POST /api/clones` on the friend's PC (the request Make it sends; started by API because another thread kept taking the emulator's front) | Downloaded `v1.0-b2`'s code, made `com.anyapp.prayertimesahmads` "Prayer Times (Ahmad's)" with its own key in the friend's keystore, no `APP_MEMORY.md`; agent turn, build 1 (337 s) |
| Installed beside the original | `pm list packages`: both `com.anyapp.prayertimes` and `com.anyapp.prayertimesahmads`; signing certificates `3809ee9a...` and `50c8f004...` (`14-*`) |
| Owner: "Add a sixth row, Tahajjud", build 3, Publish 1.1 | Release `v1.1-b3` with its code |
| Friend's version, asked "Mohamad added a Tahajjud row in his newest Prayer Times. Copy that row from his app into mine." | Its agent ran `anyapp copy maddada/anyapp-prayertimes-releases` (scratch copy `prayertimes-1-1-...`), brought the row in, quick build 2; on the phone "Prayer Times (Ahmad's)" shows Tahajjud (`14-clone-home-*`) |

Found and fixed during the proof: older Kiwimake copies do not know the change link, so apps now
look for `com.anyappagent.action.CHANGE` (only new versions declare it); a second tap of the row
reused the change screen still showing "Sent" (it now starts from the choices); the desktop header
squeezed the app's name to one letter (From others is icon-only, with its count). `app/dev/ui.mjs`
now resolves the launcher activity (a copy under another package keeps the first copy's class name).

Not proven on the device: the "Show Change this app to others" switch off (the row hidden on a
friend's phone, still shown on the owner's through `owns/<package>`); the Kotlin preset's row and
sheet on a phone (the Kotlin template app was built with them, not run); sharing a suggestion into
Kiwimake through the share-in screen (it landed on main after my phone copies were built; the
Paste path was used). Tests: `shared/chat` 63, `server` 119 (11 new in `test/change.test.ts`),
`builder` adopt and copies tests, `desktop` 58, typechecks.
