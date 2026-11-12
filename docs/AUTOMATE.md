# Appwin Automate: automations you just describe

The user answered the page `C:\aa\ideas\any-tasker.html` (it was called "Any Tasker" there) on
2026-11-12. The product is being renamed to Appwin.ai (not final): code ids and package names stay
as they are, and only this app's visible text says "Appwin Automate".

## The user's answers

| Question | Answer |
| --- | --- |
| Where | A separate app, **Appwin Automate**, one of the apps AnyAppAgent makes and keeps: a normal app in the grid with its own repo, key, versions and fast-lane updates. Not part of AnyAppAgent itself |
| How a prompt becomes an automation | **Scripts** (option C): "because they're creating the app basically". The agent writes each automation as a script the app runs |
| Where to prompt | One place: the app's **Change this app**. The person types once; the agent either adds or edits an automation, or changes the app itself. No second prompt box |
| Safety rails | **All of them**: a card before an automation turns on, ask before sending anything, a run log, Stop all, hard limits. Plus a toggle in Settings, Advanced, that turns the safety locks off, with a clear warning, off by default |
| Powers in the first version | **All nine**: time and prayer times (Ajman), speak and notify, Do Not Disturb, Bluetooth, Wi-Fi and charging, notifications from other apps, location, the app in front, Accessibility, Shizuku |
| Published | Through GitHub releases like any shared app. Others build their own automations in their own copy (a separate clone, as Change this app already does) |
| Developer verification | Not now: the Advanced flow on the page, later ("we'll come to this when we come to this"). Most changes go through the fast lane after install, so they do not trigger install warnings: **a new or changed automation must arrive as a quick update, never a new APK, unless it needs a new native power** |

## The design in five lines

1. Appwin Automate is an ordinary AnyAppAgent app (React Native preset) made from a starter kept in
   this repo (`automate/app`); each automation is one TypeScript file in its `automations/` folder.
2. A Babel plugin (the fence) checks and wraps every script at build time: only the automation API,
   no imports or globals, guarded dynamic access and loops, and a record of every power call.
3. A small runtime in the app runs scripts when Android wakes it (exact alarms, a headless
   JavaScript task), and every power goes through one gate: Stop all, hard limits, permissions, ask.
4. The card the person approves is drawn from the script's own code and triggers, not from the
   agent's words, and a changed script never runs until its new card is approved.
5. Automations are JavaScript only, so they ship through the fast lane; a new native power is one
   APK, after which every script using it is a quick update again.

## What the person sees

1. In Appwin Automate, **New automation** (or Settings, Change this app) opens AnyAppAgent at this
   app's chat. They type "At Maghrib, turn on Do Not Disturb for 20 minutes and say 'Maghrib time'".
2. The agent writes `automations/maghrib-quiet.ts`; the PC sends it as a quick update (seconds, no
   install). The app shows "Version 3 is ready", Reload.
3. Home shows **Maghrib quiet time, Check it**. The card: When ("At Maghrib, every day (Ajman prayer
   times)"), It will ("Say "Maghrib time" aloud", "Turn on Do Not Disturb for 20 minutes"), You
   asked for (the agent's sentence, labelled), It needs (Do Not Disturb access: Allow), Hard limits.
   **Turn it on**.
4. At Maghrib the phone wakes the app (closed or not), it speaks and turns Do Not Disturb on; a
   quiet "Running an automation" notice with **Stop all** shows while it runs; the run log says what
   happened. Do Not Disturb turns itself off after 20 minutes.
5. "Make it 30 minutes" in Change this app: a quick update; the card shows the new line marked
   **new** and the old one struck through; it does not run until **Keep it on with this version**.

## Where it lives

- **The starter**: `automate/app/` in this repo, the files that make a fresh React Native app into
  Appwin Automate (its `AGENTS.md`, `overview.md`, the runtime, the native module, the screens, the
  icon). It is not a preset: the app is made the normal way (New app), and its first message asks
  the agent to copy the starter in. So it has everything every app has (repo, own key, versions,
  fast lane, Change this app, crash catcher, diary) and nothing in the server or builder knows it
  is special. The message: `automate/README.md`.
- **On the phone**: package `com.anyapp.appwinautomate` (from the name), signed with its own key.

## Scripts: format and runtime

One file per automation, `automations/<id>.ts`, listed in `automations/index.ts`:

```ts
export default automation({
  name: 'Maghrib quiet time',
  says: 'At Maghrib, turn on Do Not Disturb for 20 minutes and say "Maghrib time".',
  when: prayer('maghrib'),
  async run(event) {
    await speak('Maghrib time');
    await doNotDisturb.on({ minutes: 20 });
  },
});
```

The API (declared for TypeScript in `automations/api.d.ts`, built by `src/automate/api.ts`):
triggers `at`, `prayer`, `every`; powers `speak`, `notify`, `doNotDisturb`, `web`; helpers `sleep`,
`log`, `now`, `prayerTimes`, `memory`. The app's `AGENTS.md` ("Automations") is the agent's guide.

**The runtime** (`src/automate/runtime.ts`):

- On every start of the app (also after a quick update) and before every background run it
  `sync`s: a new script, or one whose source hash differs from the approved one, is logged and
  notified ("Maghrib quiet time changed. Check it to keep it running.") and is not run.
- `plan` arms one exact wake-up per automation that is on: its next trigger
  (`setExactAndAllowWhileIdle`, through `modules/automate`). The prayer times are the person's
  Prayer Alarm app's Awqaf calculation for Ajman, copied in (`src/automate/prayer.ts`).
- When Android wakes it, `TriggerReceiver` starts `AutomateTaskService`, a React Native
  `HeadlessJsTaskService` running as a short foreground service (type `shortService`, a quiet
  "Running an automation" notice with Stop all). It runs the headless task `AppwinAutomateRun` in
  the app's own JavaScript, which runs the script with a fresh scope, writes the run log, and plans
  the next wake-up. After a reboot or an app update the boot receiver re-arms and plans again.
- **Pretend clock** (for testing, and the proof): "Test with a pretend clock" on an automation's card
  shifts that one automation's clock so its next trigger comes in 30 seconds; the real wake-up path
  then fires it (alarm, headless task, powers, log). Other automations keep the real clock. It ends
  after that run.

## The sandbox: the fence

Scripts run inside the app's JavaScript runtime (Hermes), so the fence is at the language level,
enforced at build time with runtime guards where a build-time check cannot decide
(`tools/automate-fence.js`, a Babel plugin that `babel.config.js` applies to `automations/*.ts` in
every build, full and quick):

| Check | When |
| --- | --- |
| No `import`, `export` other than the one `export default automation(...)`, no `require`, `import()`, `import.meta` | Build |
| Every free name must be the automation API or a safe built-in (`Math`, `JSON`, `Date`, `Array`, `Map`, `Set`, `Promise`, ...). So no `fetch`, `XMLHttpRequest`, `globalThis`, `Function`, `eval`, `Object`, `Reflect`, `Proxy`, `setTimeout`, `console`, native modules | Build |
| No `.constructor`, `.prototype`, `__proto__`, `caller`, `callee`, `arguments`, also in destructuring | Build |
| `x[key]` (a key computed at run time) becomes `$get/$set/$call/$del/$upd`, which refuse those names | Run |
| Every loop body starts with `$tick()`: the run's time budget and Stop all are checked inside loops | Run |
| The whole file is wrapped in `define($api)`, so the script sees only what the runtime hands it | Build |

A script that breaks a rule fails the build with "automations/x.ts line 3: "fetch" is not available
in an automation...", which the builder sends back to the agent to fix (tested: the real Metro
bundle refuses such a script). Honest limits: it keeps scripts to the API and so behind the safety
rails; it is not a process boundary against someone who can change the app's own code (only the
owner and their agent can), and a single built-in call (a huge `Array.from`) cannot be interrupted.
The stronger option, if ever needed, is running scripts in a separate JavaScript isolate (Android's
`JavaScriptSandbox`), at the cost of the shared runtime and of a slower start.

The fence also **records what each script can do**: every power call with its literal arguments
(constants are worked out), the powers used, and a SHA-256 of the source. The runtime draws the
card from that record.

## How each power is reached natively

| Power | Android | Asked when | Script API | Version |
| --- | --- | --- | --- | --- |
| Time and prayer times | `AlarmManager.setExactAndAllowWhileIdle`, `USE_EXACT_ALARM` (granted to side-loaded apps), boot receiver | Never (granted) | `at`, `prayer`, `every`, `now`, `prayerTimes` | First slice |
| Speak, notify | `TextToSpeech` on the alarm stream (heard in Do Not Disturb), notification channels, `POST_NOTIFICATIONS` | Notifications: on the card of the first automation that notifies | `speak`, `notify` | First slice |
| Do Not Disturb | `NotificationManager.setInterruptionFilter(PRIORITY)` with a timed restore alarm; `ACCESS_NOTIFICATION_POLICY` | Card: "Allow" opens the Do Not Disturb access page, one switch | `doNotDisturb.on/off/isOn` | First slice |
| Bluetooth, Wi-Fi, charging | `ListenerService`: a foreground service of type `connectedDevice` (its Android 14 prerequisite `CHANGE_NETWORK_STATE` is granted without asking) with receivers for `ACTION_POWER_CONNECTED/DISCONNECTED` and Bluetooth `ACTION_ACL_CONNECTED/DISCONNECTED`, and a Wi-Fi `NetworkCallback` (with `FLAG_INCLUDE_LOCATION_INFO` for the name). It runs only while an automation that is on uses one of these triggers (the runtime calls `listen()` in every plan), shows "Listening for ..." with Stop all, restarts after a reboot, and starts the headless runner with `{ event }` | Card: "A small notice while it listens"; Bluetooth asks Nearby devices; a Wi-Fi name asks Location, all the time (Android shows Wi-Fi names only then) | `charging({ plugged? })`, `wifi({ connected?, network? })`, `bluetooth({ connected?, device? })` | M2 (built) |
| Notifications from other apps | `NotificationListenerService`; side-loaded apps need "Allow restricted settings" in App info first (Android 13+) | Card: a short walkthrough (App info, then the listener switch) | `notificationFrom('WhatsApp', { text? })` trigger | M3 |
| Location (arrive, leave) | `LocationManager.addProximityAlert` (no Play services needed) or the fused geofencing API; `ACCESS_BACKGROUND_LOCATION` ("Allow all the time") | Card | `arrive('Mosque')`, `leave(...)`, places saved in the app | M4 |
| The app in front | `UsageStatsManager` events (`PACKAGE_USAGE_STATS`, one switch), polled by the listener service only while an automation needs it | Card | `appOpened('YouTube', { forMinutes? })` | M5 |
| Accessibility | An `AccessibilityService` that reads the window and taps; restricted settings again; Android 16 refuses it during calls | Card, with a plain warning | `screen.find(text)`, `screen.tap(text)`, with a deny-list (password fields, Settings security pages, the package installer, banking) that the safety locks cannot turn off | M6 |
| Shizuku | The Shizuku API (the Shizuku app runs a privileged process after a wireless-debugging pairing, again after every restart) | Card: walkthrough, then Shizuku's own Allow | `shizuku.run(...)` limited to a list of commands (mobile data, Wi-Fi on and off, stop an app, secure settings) | M7 |

**Permissions only when needed**: the manifest declares what a power needs (declaring is not
granting), but nothing is asked until an automation using that power is shown on its card. The card's
"It needs" list comes from the powers in the code; Turn it on is disabled until each is Ready. A
later version lists powers no automation uses any more, so the person can switch them off.

## The safety rails

| Rail | How |
| --- | --- |
| A card before on | `AutomationScreen`: When and It will from the code, You asked for (the agent's sentence, labelled), It needs, Hard limits, Show the script. Nothing runs before Turn it on. The approval is tied to the source hash: a changed script stops running and shows its card again with the new lines marked |
| Ask before sending | `web.get` / `web.post` (and in later versions SMS, calls, messages) go through `ask()`: a high-priority notification "Maghrib quiet time wants to send to example.com", Allow / Don't allow, two minutes, then no. https only, never to this phone or its home network |
| Run log | Every run, failure, skip, block by a limit, change, turn on and off, Stop all, locks change. On the phone only (and short notes in the app's diary, which the agent can read with `read_diary`) |
| Stop all | Home (with a confirm) and every notice the app posts. Natively: a stop flag every power checks, all wake-ups cancelled, Do Not Disturb this app turned on goes off, speech stops, open questions answered no. Resume on Home |
| Hard limits | `src/automate/limits.ts`: at most 12 runs an hour per automation and 60 for all, a run stops after 60 s and 20 power calls, `every` at least 15 minutes, Do Not Disturb at most 12 hours and always timed, speech 300 characters, 10 sends an hour, each asked. Never install apps, change security settings or read passwords: there is no API for them |
| Safety locks (Settings, Advanced) | Off by default. Turning them off asks first with a plain warning, and turns off: the hard limits, asking before sending, and the card before on (new and changed automations turn on by themselves, logged). The run log, Stop all, and a 10-minute guard against a run that never ends stay. The Accessibility deny-list (M6) stays too |

## One prompt box

There is no prompt box in Appwin Automate. **New automation** and Settings, **Change this app**
open AnyAppAgent at the app's chat (the existing Change this app row, `openChange`). The app's
`AGENTS.md` starts with "Appwin Automate: read this first": every message is either an automation
(add or change one file in `automations/`, nothing else, no plan page) or a change to the app (as
usual); when in doubt it is an automation; one short question when it is unclear which automation.
The agent ends an automation turn with "Open Appwin Automate and check its card to turn it on".

## Shipping: the fast lane

The fast lane (`docs/FAST-LANE.md`) decides by the native fingerprint (`app.json`, `package.json`,
lockfile, `assets/`, native files in `modules/`, `plugins/`). `automations/`, `src/`, `tools/` and
`babel.config.js` are outside it, so a new or changed automation is a quick build and a quick
update: no APK, no install prompt, no verification warning. The app's `AGENTS.md` tells the agent
never to touch the fingerprint files for an automation. A new power (a manifest entry, a Kotlin
service) is the only thing that needs a new APK: plan the powers' native parts in a few batches
(M2 to M7), so after that every automation of every kind is a quick update.

## Publishing and clones

Nothing special: Share with others and Publish (`docs/DISTRIBUTION.md`) put Appwin Automate on
GitHub releases with its code (`docs/CHANGE-THIS-APP.md`). Someone else's "Make my own version"
gives them a separate clone (own package, key and repo) with the published automations in it; their
agent changes theirs, and nothing flows back. A clone's automations start as "Check it" on their
phone (no approval is carried in the code; approvals live in the phone's storage). Published
releases carry the quick updates too once the fast lane covers shared apps (FAST-LANE.md, "Shared
apps").

## Developer verification

Not now (the user's call). What keeps it light: install Appwin Automate once (one APK, Advanced flow
or ADB when verification arrives in 2027); afterwards automations are quick updates, which are not
installs, so they never meet verification. Each new native power batch is one more install.

## First version: scope and milestones

The first version is all nine powers. In working days, one thread:

| # | What | Days |
| --- | --- | --- |
| M1 | First slice (this): the app made through AnyAppAgent, the fence and runtime, all safety rails and the Advanced toggle, time and prayer times, speak and notify, Do Not Disturb | 2 (done) |
| M2 | Bluetooth, Wi-Fi and charging triggers: the listener service (always-on notice with Stop all), Nearby devices | 2 (built) |
| M3 | Notifications from other apps: the listener service, the restricted-settings walkthrough | 1.5 |
| M4 | Location arrive and leave: places in the app, proximity alerts, "Allow all the time" walkthrough | 1.5 |
| M5 | The app in front (usage access) | 1 |
| M6 | Accessibility: read and tap, the deny-list, the warning card | 2.5 |
| M7 | Shizuku: setup walkthrough, the command list, its own ask | 2 |
| M8 | Unused powers list, ask-before-sending for SMS and calls, publish and clone check, docs | 1 |

About 14 days in all, 12 after this slice. M2 to M7 each end with one APK; everything after is the
fast lane.

## What only the user's phone can prove

- **Shizuku**: wireless debugging, the pairing, Shizuku's own permission, and that it has to be
  started again after every restart. The emulator has no Shizuku.
- **Accessibility**: "Allow restricted settings" on a side-loaded app, Android 15 and 16's extra
  confirmations, Advanced Protection mode, and the phone maker's own restrictions.
- **Real notifications from other apps**: WhatsApp and the like (and the restricted-settings step
  for the notification listener).
- Also better on the real phone: exact alarms under the maker's battery saver (Samsung, Xiaomi),
  speech on the alarm volume in a real Do Not Disturb, Bluetooth with the real car, geofences.

## First slice: what is built

| Where | What |
| --- | --- |
| `automate/app/` | The starter: `AGENTS.md` (routing and the automation rules), `overview.md`, `index.ts` (headless task), `babel.config.js`, `tools/automate-fence.js`, `automations/` (`api.d.ts`, `index.ts`), `src/automate/` (runtime, API, store, triggers, card, limits, prayer times), `src/screens/` (Home, the card, Run log, Settings with Advanced), `modules/automate/` (Kotlin: wake-ups, headless runner, Do Not Disturb, speech, notices, ask, Stop all), the icon and theme |
| `automate/README.md` | The one message that makes the app through AnyAppAgent |
| `docs/AUTOMATE.md` | This file |

No change to `shared/protocol.ts`, the server, the builder or the phone app.

## First slice proof (2026-11-12)

`emulator-5560`, my own companion (port 8824, state `C:\aa\t\auto`, GitHub off, plan first and
the coordinator off), my phone copy **AA Automate** (`com.anyappagent.automate`), real Claude Code
turns. Screenshots: `C:\aa\e2e\automate\`.

| Step | Result |
| --- | --- |
| New app "Appwin Automate" through the companion with the message in `automate/README.md` | The agent copied the starter and kept its own `overview.md`; build 1 full (272 s, new native module and icon). It noticed a later fix in the starter and copied it: build 2 quick (11 s). In the grid, installed by my phone copy (versionCode 2, `01-*`, `02-*`, `03-home-empty-light.png`) |
| New automation in the app | Opens AnyAppAgent at this app's chat: the one prompt box (`04-*`) |
| "At Maghrib, turn on Do Not Disturb for 20 minutes and say Maghrib time" | The agent treated it as an automation: one file `automations/maghrib-quiet.ts` and a line in `index.ts`, "Open Appwin Automate and check its card". Build 3 quick (9 s), 91 s from Send to ready. "Version 3 is ready", Reload; the installed APK stayed versionCode 2 with the same install time (`05-*` to `08-*`) |
| The card | "Check it"; When, It will ("Say "Maghrib time" aloud", "Turn on Do Not Disturb for 20 minutes") drawn from the code, You asked for, It needs (Do Not Disturb access: Allow), Hard limits; Turn it on disabled until Ready (`09-*`, `10-*`) |
| Turn it on | Android has an exact alarm for 17:34:00 (Maghrib in Ajman), `exactAllowReason=policy_permission` (`11-*`) |
| Pretend clock, app in the background | The real path: the alarm fired, "Background started FGS: Allowed ... ALARM_MANAGER_WHILE_IDLE", the headless task ran the script, the run log has it (`13-*`, `14-*`) |
| First run | Failed: the emulator's voice engine did not start ("Failed creating TTS session: TimeoutException"). That runtime wrote "Said ..." before speaking, so the entry shows "Said" next to "Speech is not available" (`16-*`); fixed since version 4: the line is written only after the voice finished, otherwise "Could not say ..." |
| Second run | The voice started but never reported finishing on the overloaded emulator (load 22 to 28); the 60-second hard limit stopped the run, as it should (`17-*`). Since version 5 speech is best effort: one retry, at most 15 s, then a note, and the run goes on |
| Third run (05:44 the emulator went down; restarted at 06:23 with a software GPU) | Succeeded, app in the background: "Said "Maghrib time"", "Do Not Disturb on until 06:55", 4.3 s (`19-*`). Android: `zen_mode=1`, the rule "Managed by Appwin Automate" (priority, alarms allowed), the restore alarm at 06:55:00, 20 minutes later (`15-dnd-on-shade-light.png`, `18-*`) |
| Stop all | Confirm, then "Everything is stopped": Do Not Disturb off at once (`zen_mode=0`), no wake-up of the app left pending (the trigger and the timed restore both cancelled) (`20-*`, `21-*`); Resume brought the automation back |
| Second prompt: "Make the Maghrib one 30 minutes instead of 20, and also show a notification saying Quiet time started" | The agent edited the same file; build 6 quick (9 s), quick update 6 handed over (5.3 MB) once my phone copy was running again; Reload. The APK still versionCode 2, installed 05:16:04: no new install. Home: "Changed: check it", and no wake-up armed (a changed script does not run) (`22-*`, `23-*`) |
| The changed card | "Turn on Do Not Disturb for 30 minutes" and "Show a notification" marked new, the 20-minute line struck through; a new need, Notifications: Allow, asked only now (Android's prompt) (`24-*`, `25-*`, `26-*`). "Keep it on with this version": the 17:34 alarm is back (`27-*`) |
| Dark | Home, the card, the run log, Settings with Advanced, and the safety locks warning (kept on) (`30-*` to `35-*`) |
Both fixes reached the app as quick updates 4 and 5 (the agent copied them from the starter on
request). Found on the way: an app can be killed when another AnyAppAgent copy on the phone dies
("depends on provider com.anyappagent.dictate ... in dying proc"), template behaviour. Android's
Do Not Disturb access page stayed blank on the overloaded emulator, so access was granted with
`cmd notification allow_dnd` (the same switch).

**Not proven here**: ask before sending (no automation sends anything yet; the question is a
notification with Allow and Don't allow) and turning the safety locks off (the warning was shown, the
locks were kept on). The emulator restarted with a software GPU ran at load 20 to 30, and its first
boot after the restart called the old adb on PATH (the emulator inherits the user's PATH), which
restarted the shared adb server for a minute.

## The rails proof and M2 (2026-11-12, later)

The user asked to prove the safety rails before M2, then M2. Same setup (`emulator-5560`, my
companion on 8824, my phone copy). Screenshots `C:\aa\e2e\automate\4x-*`, `5x-*`, `6x-*`.

**Ask before sending.** "Two test automations to try the safety rails" made Web check (07:00,
`web.get('https://example.com')`, then a notification) and Minute tick (every 1 minute), quick
build 7. Web check's card: "Fetch from example.com (asks you first, every time)" (`41-*`). Try it
now: the notification "Web check wants to fetch from example.com", Don't allow / Allow (`42-*`);
Don't allow: "You said no: nothing was sent", the notification after the fetch never came (`43-*`);
again with Allow: fetched, "example.com answered with status 200" (`44-*`). The real 07:00 run
asked too (`52-ask-before-sending-dark.png`); nobody answered.

Found there: the question waits up to 2 minutes but a run is capped at 60 s, so the hard limit
ended the unanswered run first and the log said "took too long" (`53-*`), honest about nothing
sent but not about why. Fixed (version 8): a run's clock pauses while it waits for the person,
and a refusal is logged as "<name> did not send anything" with "You said no" or "No answer in
time", kind `blocked`, not a failure.

**Safety locks off.** With the locks on, Minute tick is "Problem: every() cannot be more often than
every 15 minutes (safety lock)" (`40-*`). Settings, Advanced, the switch, the warning, Turn off
(`45-*`, `46-*`): Minute tick turned on by itself ("Without a card: the safety locks are off") and
ran every minute, 06:54, 06:55, 06:56 (`47-*`, `48-*`). Locks back on: Minute tick is a Problem
again and its wake-up is gone (`49-*`, `50-*`). Dark: `51-*` to `53-*`.

**The name in one place.** The app's visible name is its own name under the icon (app.json
`expo.name`, which a rename in AnyAppAgent already changes): JavaScript reads it through
`src/automate/brand.ts` (`APP_NAME`), Kotlin through the app's label (`Notices.appName`). No
screen or message writes the name out; the app's AGENTS.md says so. The running notice now shows
the automation's name instead of its id.

**M2.** Built as above (`ListenerService.kt`, triggers in `src/automate/triggers.ts`, the card's
new needs in `card.ts`, the API in `automations/api.d.ts` and the fence's list). It reached the app
as one full build (8, 144 s, the new service and permissions), installed by my phone copy without
a prompt; the next automations using the new triggers were a quick build again (9, 17 s).

**Not proven on the device yet (M2):** turning on the charger and Wi-Fi automations, and the events
themselves (`adb emu power ac off/on`, Wi-Fi off and on). The code is built (the full build 8
compiled the listener service), installed on the phone, and the automations using the triggers
arrived as quick update 9; at 07:30 three other threads were driving the shared emulator, so the
taps were stopped rather than land in their apps. Bluetooth connect and disconnect cannot be shown
on the emulator (no device to pair): the user's phone with the car is the proof.
