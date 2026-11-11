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
- **Q243, someone without AnyAppAgent: the explanation in the app, then GitHub** (option A). The
  sheet keeps one plain line for the cloud service planned for people without a PC (no button yet).

## What each person sees

| Who taps Change this app | What happens |
| --- | --- |
| The owner (the app is in their PC's list) | AnyAppAgent opens on the app's chat |
| Someone with a new enough AnyAppAgent, paired with a PC | "Prayer Times is Mohamad's app": Suggest a change to Mohamad, or Make my own version |
| Someone with AnyAppAgent, no PC | The same sheet with Suggest a change; one line says an own version needs a PC (and that a no-PC way with cloud credits is planned) |
| Someone without AnyAppAgent | The app's own explanation sheet: what AnyAppAgent is, what an own version needs (this phone, a Windows PC that stays on, a Claude account, about 20 minutes), Get AnyAppAgent (its latest release on GitHub), Suggest a change to Mohamad, Not now |

## In the generated apps

- **React Native**: `src/screens/SettingsScreen.tsx` (new, reached from the starter Home screen's
  Settings link) ends with `ThisAppSection` from `src/components/ChangeThisApp.tsx`: Change this
  app, Version, Made by <owner> with AnyAppAgent. `ChangeThisAppRow` alone is there for a settings
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

The row opens AnyAppAgent with the action `com.anyappagent.action.CHANGE` and

```
anyappagent://change?package=com.anyapp.prayertimes&name=Prayer%20Times&owner=Mohamad
  &repo=mohamad/anyapp-prayertimes-releases&build=37&version=1.4&screen=settings
```

- `repo` is read from the app's update feed (only a shared app has one), `owner` from the build.
- Only AnyAppAgent versions with this feature declare the action (`ChangeLinkActivity`, which hands
  the link to the router at `/change`), so an older AnyAppAgent on the phone is never opened with a
  link it does not know: the app then shows its own explanation sheet. The emulator holds a dozen
  older copies; this is what keeps them out.
- With several AnyAppAgent copies, the app opens the one that installed it, else
  `com.anyappagent`, else the first. Android 11+ package visibility: the templates query the action.

### Who sees the row

The PC writes two string resources into every build (Gradle properties through
`builder/anyapp.init.gradle`, part of the native fingerprint, so a change is a full build):

| Resource | Value |
| --- | --- |
| `anyapp_change_owner` | The owner's name ("Mohamad"): Git's `user.name` first word on the PC, else the Windows user name; changeable in the desktop Share dialog ("Your name in your apps"), one for the PC |
| `anyapp_change_others` | `0` when the owner switched "Show Change this app to others" off; absent (on) by default |

With the switch off the row shows only on the owner's phone: the app asks its AnyAppAgent's
provider `content://<host>.updates/owns/<package>` (1 when the package is in the paired PC's list,
which the phone keeps in step with `setOwnApps`; only the app asking about itself gets an answer).
The switch takes effect with the app's next version.

## Suggest a change

The message, the same from AnyAppAgent and from the app's own sheet (`shared/chat/suggestions.ts`,
Kotlin `ChangeThisApp.suggestionText`):

```
Ahmad suggests a change to Prayer Times:

Bigger numbers, I can't read Isha.

If you made Prayer Times with AnyAppAgent, share this message to AnyAppAgent or paste it there.
anyapp-suggestion: com.anyapp.prayertimes 37
```

It goes through Android's share menu. The owner shares it into AnyAppAgent, or copies it and taps
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

- The cloud service for people without a PC (paid with cloud API tokens): the sheet's line
  "No PC? A way to change apps without one, using cloud credits, is planned." is its place.
- A suggestion arriving by itself (a server or the Family circle idea) instead of a forwarded text.
