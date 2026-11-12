# Working on this app

You are changing an Android app for a non-technical person who uses it on their phone. They tell
you what they want in plain words; they never see the code. When your turn ends, Kiwimake
builds a signed **release** APK from this folder (the JavaScript is embedded, there is no dev
server) and installs it over the version on their phone. If the build fails, the error comes back
to you as your next prompt. **Keep the app building, and check your work before you finish.**

## Automate: read this first

This app is **Automate**: automations the person describes in plain words, which run on
their phone by themselves. They type every request in one place (Change this app), so **every
message is one of two kinds**. Decide which before you do anything:

1. **An automation**: something that should happen by itself, at a time or on an event ("At
   Maghrib, turn on Do Not Disturb for 20 minutes", "every morning at 7 say good morning", "make
   the Maghrib one 30 minutes"). Add or change one file in `automations/` (below) and nothing else.
   No plan page, no questions unless something essential is missing: it is a small change.
2. **A change to the app itself**: its screens, its look, its settings, or a new power it does not
   have yet. Change the app as usual (the rest of this file).

When a message could be either, it is an automation. When it changes an automation but it is not
clear which one, ask in one short line. To change an existing automation, edit its file (same
file name: the file name is its id); never make a second file for the same thing.

What to tell the person after an automation: one or two plain lines, then "Open Automate
and check its card to turn it on." (A new or changed automation never runs until they approve its
card on the phone; that is on purpose.)

### Automations

Each automation is one file, `automations/<id>.ts` (`<id>`: lowercase letters, digits and dashes,
for example `maghrib-quiet`), listed in `automations/index.ts`:

```ts
// automations/maghrib-quiet.ts
export default automation({
  name: 'Maghrib quiet time',                       // short, shown in the list
  says: 'At Maghrib, turn on Do Not Disturb for 20 minutes and say "Maghrib time".', // the person's request, plainly
  when: prayer('maghrib'),                          // or a list: [at('07:00'), prayer('isha', { before: 20 })]
  async run(event) {                                // event: { trigger, at, test }
    await speak('Maghrib time');
    await doNotDisturb.on({ minutes: 20 });
  },
});
```

```ts
// automations/index.ts: one import and one entry per automation
import maghribQuiet from './maghrib-quiet';

export const automations: AutomationScript[] = [maghribQuiet];
```

The whole API (types and comments: `automations/api.d.ts`):

| Name | What |
| --- | --- |
| `at('07:30', { days? })` | Every day at a local time; `days: ['mon', 'fri']` limits it |
| `prayer('fajr' \| 'sunrise' \| 'dhuhr' \| 'asr' \| 'maghrib' \| 'isha', { before?, after? })` | At an Ajman prayer time (UAE Awqaf), minutes before or after |
| `every({ minutes } \| { hours })` | Repeating, at least every 15 minutes |
| `charging({ plugged? })` | The charger plugged in (default) or unplugged |
| `wifi({ connected?, network? })` | Wi-Fi connects (default) or drops; `network` is its name (then the card also asks for Location, all the time) |
| `bluetooth({ connected?, device? })` | A Bluetooth device connects (default) or disconnects; `device` is part of its name (Nearby devices is asked on the card) |
| `speak(text, { language? })` | Says it aloud on the alarm volume (heard in Do Not Disturb) |
| `notify(title, body?)` | A notification |
| `doNotDisturb.on({ minutes? })`, `.off()`, `.isOn()` | Do Not Disturb (alarms still sound); with `minutes` it ends by itself |
| `web.get(url)`, `web.post(url, body)` | Sending: the phone asks the person every time first; https only |
| `sleep({ seconds })`, `log(text)`, `now()`, `prayerTimes(day?)`, `memory.get/set` | Helpers |

**The rules** (the build enforces them: a script that breaks one fails the build with a message
saying which line and why, and that message comes back to you):

- A script uses only the names above plus `Math`, `JSON`, `Number`, `String`, `Boolean`, `Array`,
  `Date`, `Map`, `Set`, `Promise`, `Error`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`. No
  `import`, `require`, `fetch`, `setTimeout`, `console`, `globalThis`, `Object`, `Function`; no
  `.constructor`, `.prototype` or `__proto__`. Helper functions and constants inside the file are fine.
- Exactly one `export default automation({ ... })`.
- Await every power call. A run stops after 60 seconds and after 20 power calls (hard limits);
  long waits are triggers, or `doNotDisturb.on({ minutes })`, never `sleep`.
- **Call powers with plain values written in the file** (`speak('Maghrib time')`,
  `doNotDisturb.on({ minutes: 20 })`, constants are fine): the card the person approves is drawn
  from these calls in the code, so a literal shows as "Say "Maghrib time" aloud", while a value
  worked out at run time shows as "something worked out when it runs".
- `says` is the person's request in one plain sentence: the card shows it as "You asked for".
- Never log or speak what the person wrote elsewhere or who they are.
- The app's name is never written out in screens or messages: use `APP_NAME` from
  `src/automate/brand.ts` (it is the name under the icon, so a rename changes it everywhere).
- Leave `src/automate/`, `tools/automate-fence.js`, `babel.config.js` and `modules/automate/`
  alone for an automation: they are the runtime and its safety rails. Change them only for a
  change to the app itself, and never weaken a safety rail unless the person asks for exactly that.

While an automation that is on uses `charging`, `wifi` or `bluetooth`, a small "Listening for ..."
notice stays (Android needs it to keep listening); it carries Stop all.

**What is not in this version yet** (say so in one line and offer to add it, as a change to the
app that needs a new install): notifications from other apps, location (arrive and leave), the app
in front, Accessibility (read the screen and tap), and Shizuku powers. `docs/AUTOMATE.md` in Kiwimake has the plan for each.

**How it reaches the phone**: an automation is JavaScript only, so it goes out as a quick update
(the fast lane, no install). Do not touch `app.json`, `package.json`, `assets/` or native code for
an automation: any of those makes it a full build and a new install.

**Check your work**: `npm run check` (the bundle step runs the automation rules).

Stack: Expo SDK 58, React Native 0.88 (New Architecture, Hermes), React 19.3, TypeScript (strict),
React Navigation 7. Android only. Expo changes between SDKs; when unsure of an API, read the docs
for this exact SDK: https://docs.expo.dev/versions/v58.0.0/ (or the `.d.ts` files in
`node_modules`), not memory.

## Layout

```
index.ts                 entry point (leave it)
src/App.tsx              root: navigation (register screens here), theme, one-time setup
src/screens/             one file per screen; HomeScreen.tsx is the automations list (keep it,
                         and keep a way to reach SettingsScreen.tsx, which ends with "This app")
automations/             the automations (see "Automations" above)
src/automate/            the automation runtime and its safety rails
modules/automate/        native (Kotlin) side of the runtime: wake-ups, Do Not Disturb, speech, Stop all
src/components/          Screen (safe area + scroll), Card, Button: reuse them
src/lib/storage.ts       persistent JSON storage + usePersistentState hook
src/lib/notifications.ts notification permission, notify now, exact scheduled reminders
src/lib/alarms.ts        exact alarms with sound + spoken text, work while the app is closed
src/lib/ai.ts            AI (chat, streaming, tools, agents) through Kiwimake's key
src/lib/diary.ts         the app's diary: short private notes of what the app did (see "The diary")
src/lib/crash.ts         crash catcher: crashes reach Kiwimake, which offers a fix (see "Crashes")
src/components/CrashBoundary.tsx  "Something went wrong" screen instead of a blank one (leave it)
src/components/AiSetupNotice.tsx  the "AI is not set up" card with a button to Kiwimake
src/theme.ts             colours (light + dark), spacing, radius, font sizes
assets/icon.png          THE launcher icon (1024x1024 PNG); also the splash and starter image
assets/sounds/           sound files for alarms and in-app playback (adhan.mp3, beep.wav, …)
scripts/make-icon.mjs    makes assets/icon.png from a colour and a glyph or letter
modules/alarms/          native (Kotlin) code behind src/lib/alarms.ts
modules/ai/              native (Kotlin) code behind src/lib/ai.ts (leave it)
modules/diary/           native (Kotlin) code behind src/lib/diary.ts and src/lib/crash.ts (leave it)
modules/feedback/        "Point at it": shake to send feedback (built in: keep it, leave it as is)
modules/abilities/       home screen widgets, Quick Settings tiles, app shortcuts, receiving shares (leave its code)
modules/camera/          camera smarts: scan codes, read text from pictures (off until app.json turns it on)
app.json                 app config (name, permissions, plugins)
overview.md              what the person wants the app to do (see below)
```

`@/` means `src/` in imports (`import { Card } from '@/components/Card'`).

## overview.md and the person's other apps

- `overview.md` (project root) holds the app's main requirements as the person gave them: what
  the app is for, its main screens and features, the choices that matter. High level and short,
  not a README and not a changelog. The agent the person talks to (the main chat) keeps it up to date after every
  message that changes what the app should do; a helper reads it and leaves it alone. A first line
  `<!-- anyapp: draft ... -->` marks a draft the PC wrote: replace the whole file.
- The `anyapp` command shows the person's other apps on this PC: `anyapp apps` (name, kind,
  version, folder; this app is marked `*`), `anyapp overview <app>` (its `overview.md`),
  `anyapp path <app>` (its folder, to read its code). Before building a new app or feature, look
  there for something that already works (a calculation, a screen, notifications, a look the
  person liked) and copy it into this app, adapted to it.
- Other apps are read only: never change, build, commit or run anything in another app's folder.

## Never

- Never change `expo.android.package`, `expo.slug`, `expo.android.versionCode`, `expo.updates`,
  `expo.runtimeVersion`, or anything about signing. The builder sets the version code and signs
  every build with the same key; a different package id would be a different app that cannot
  update the one on the phone.
- Never create or edit `android/` (or `ios/`). It is generated from `app.json` by `expo prebuild`
  on every build and is git-ignored, so edits are lost. Native settings go in `app.json` or a
  config plugin. Only touch `modules/alarms/` if a feature really needs new native code.
- Never run `expo start`, `expo run:android`, Gradle, EAS, or anything that needs a phone. The
  builder does the native build.
- Never use `npm install <pkg>`: use `npx expo install <pkg>` (picks the version that matches SDK
  58). Prefer what is already installed (below): every new native library makes the next build
  slower and riskier.
- Never put secrets or keys in the app. For AI, use `src/lib/ai.ts` (below): never ask the person
  for an API key and never call an AI provider with `fetch`.
- Never remove or change `modules/feedback/` (see "Feedback: shake and point at it").

You may change `expo.name` (the name under the icon) when the user asks to rename the app.

## Check your work (no device needed)

```
npm run typecheck    # tsc --noEmit; type errors also fail the real build
npm run lint         # eslint, warnings count as errors
npm run bundle       # bundles the JS exactly like the release build (~20 s): catches bad imports,
                     # syntax errors and missing assets
npm run check        # all three
```

Run `npm run check` before you finish a turn. It does not catch runtime errors, so read your code
for crashes too (undefined values, unhandled promise rejections, permissions not asked for).

## Words in the app

- **Never use the em dash character (U+2014) anywhere**: not in UI text, notifications, spoken
  text, comments, or your messages. Use a comma, colon, full stop or parentheses instead.
- Short, friendly, plain words; no technical terms in anything the user sees.

## Design: the user's taste (follow it)

The user said: "no purple gradients or AI slop please". So, in every app:

- **No purple gradients, and no gradients as decoration at all.** Flat colour, hairlines, space.
- **No sparkle, magic wand, stars or "AI" icons**, and no "magical" wording.
- **No generic AI look**: no glowing cards, glassmorphism, neon, emoji as decoration, big
  rounded hero banners, or the same purple-blue template every app has.
- **Design each app for what it is for.** A prayer-time app, a shopping list and a workout timer
  should not look alike. Choose an accent, an icon and a layout that fit the subject (and its
  culture: a prayer app might use a calm deep green or ink colour and clear, large times).
- **Calm and well made**: good typography with a clear hierarchy (one large title per screen,
  then headings, body, small labels), generous spacing, one restrained accent colour used
  sparingly, and light and dark both looking deliberate.
- No em dashes (see above).

How: everything visual comes from `src/theme.ts`. Use `useColors()` (`background`, `surface`,
`surfaceMuted`, `border`, `text`, `textMuted`, `textFaint`, `accent`, `onAccent`, `accentSoft`,
`success`, `warning`, `danger`), `type` (`display`, `title`, `heading`, `body`, `bodyStrong`,
`small`, `label`, `numeric`), `spacing` and `radius`, never hard-coded colours, so dark mode works.
To give the app its character, change `accent` (and, if fitting, `background`) in both palettes
of `theme.ts` first. Big touch targets, short labels, one main action per screen. Icons:
`import { MaterialCommunityIcons } from '@expo/vector-icons'` (names at
https://pictogrammers.com/library/mdi/), used sparingly and in `textMuted` or `accent`. Wrap every
screen in `<Screen>` so content stays clear of the status bar and the gesture bar (the app is
edge-to-edge). The starter screen (`src/screens/HomeScreen.tsx`) shows the intended level of care.

## Built-in capabilities

All of these are installed, their Android permissions are declared, and they need **no native
changes**: only JavaScript.

### Screens and navigation

```tsx
// src/screens/HistoryScreen.tsx
import { useNavigation } from '@react-navigation/native';
export function HistoryScreen() { /* … */ }

// src/App.tsx: register it in RootStack.screens
History: { screen: HistoryScreen, options: { title: 'History' } },

// anywhere: navigate (typed from RootStack)
const navigation = useNavigation();
navigation.navigate('History');
```

Screens with `headerShown: false` draw their own title; others get a native header. Bottom tabs
are not installed: use a stack, or a segmented control on one screen.

### Persistent storage

```tsx
import { usePersistentState, load, save } from '@/lib/storage';

const [items, setItems, loaded] = usePersistentState<string[]>('items', []);
setItems((prev) => [...prev, 'new']);        // saved automatically

const settings = await load('settings', { offset: 10 });   // outside React
await save('settings', { offset: 15 });
```

Data survives restarts and app updates (it is wiped only if the app is uninstalled). Store plain
JSON; keep each key under ~1 MB.

### Alarms that ring, speak and survive the app being closed (exact, reboot-proof)

Use these for anything time-critical: alarms, prayer times, medication, timers. They use Android's
`setAlarmClock` (never delayed by battery saving), fire while the app is closed or swiped away,
are re-armed after a reboot, show a notification, then play `sound` and speak `speak` aloud on the
alarm volume.

```tsx
import { ensureAlarmPermission, scheduleAlarm, cancelAlarm, getScheduledAlarms, testAlarm } from '@/lib/alarms';

await ensureAlarmPermission();          // once, e.g. on first launch: asks for notifications
await scheduleAlarm({
  id: 'fajr-2026-11-11',                // your stable id; same id = replace
  at: new Date(2026, 10, 11, 5, 12),    // Date or ms timestamp (local time)
  title: 'Fajr in 10 minutes',
  body: 'Time to get ready',            // optional, defaults to `speak`
  speak: 'Fajr prayer is in ten minutes', // optional, text to speech
  language: 'en-US',                    // optional BCP-47; default = phone language
  sound: 'adhan',                       // optional: plays assets/sounds/adhan.mp3 first
  repeat: 'daily',                      // optional: same time every day
  fullScreen: true,                     // optional, default true (see below)
});
await cancelAlarm('fajr-2026-11-11');
const pending = await getScheduledAlarms();   // [{ id, at, title, … }] soonest first
await testAlarm({ id: 'test', title: 'Test', speak: 'This is a test' });  // fire now
```

- Alarms are one-shot unless `repeat: 'daily'`. For times that change every day (prayer times,
  sunrise), schedule the next several days (e.g. 7) whenever the app opens or settings change,
  using ids that include the date, and cancel the old ones first (`getScheduledAlarms()` +
  `cancelAlarm`). Keep the total under ~400.
- Sound files: put `name.mp3` (or .ogg/.wav) in `assets/sounds/`, lowercase letters, digits and
  underscores only, and pass `sound: 'name'`. A new sound file needs a rebuild (automatic).
- Without `sound` and `speak` the notification uses the normal notification sound.
- `fullScreen` (default true, only for alarms with `sound` or `speak`): when the phone is locked
  or its screen is off, the alarm wakes the screen and shows a full-screen alarm with a Stop
  button, like a clock app, and lowers other audio (music) while it plays. When the phone is in
  use it shows as a heads-up notification and plays over other audio. Use `fullScreen: false` for
  gentle announcements that should only speak (for example reminders before an event).
  `canUseFullScreenAlarms()` is false if the user turned this off (Android 14+ setting);
  `openFullScreenAlarmSettings()` opens that setting.
- The speech voice is prepared when you schedule a spoken alarm, so the first one is not late.

### Notifications and simple reminders

```tsx
import { ensureNotificationPermission, notifyNow, scheduleReminder, cancelReminder } from '@/lib/notifications';

if (await ensureNotificationPermission()) {
  await notifyNow('Saved', 'Your list was saved');
  const id = await scheduleReminder({ at: new Date(Date.now() + 3600_000), title: 'Drink water' });
  await cancelReminder(id);
}
```

`scheduleReminder` is exact and survives reboots too, but cannot speak. For anything else use
`expo-notifications` directly (`import * as Notifications from 'expo-notifications'`; daily and
weekly triggers: `SchedulableTriggerInputTypes.DAILY` / `WEEKLY`).

### Text to speech (while the app is open)

```tsx
import * as Speech from 'expo-speech';
Speech.speak('Hello', { language: 'en-US', rate: 1.0, onDone: () => {} });
Speech.stop();
```

### Audio playback

```tsx
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';

const player = useAudioPlayer(require('../../assets/sounds/beep.mp3'));   // or { uri: 'https://…' }
await setAudioModeAsync({ playsInSilentMode: true });
player.seekTo(0);
player.play();          // player.pause()
```

### Location

```tsx
import * as Location from 'expo-location';

const { granted } = await Location.requestForegroundPermissionsAsync();
if (granted) {
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  pos.coords.latitude; pos.coords.longitude;
}
```

Always handle "not granted" (show a friendly message and a fallback, e.g. a city picker). Only
foreground location is set up.

### Haptics, keep awake, date/time picker

```tsx
import * as Haptics from 'expo-haptics';
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

import { useKeepAwake } from 'expo-keep-awake';
useKeepAwake();       // inside a component: the screen stays on while it is shown

import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
DateTimePickerAndroid.open({
  value: new Date(), mode: 'time', is24Hour: true,
  onChange: (event, date) => { if (event.type === 'set' && date) setTime(date); },
});
```

### AI: chat, streaming, tools and agents (Claude or OpenRouter, through Kiwimake)

Use this whenever the person asks for anything AI: a chat, summaries, smart suggestions, reading a
photo, an assistant that does things in the app. The person adds their AI key once in Kiwimake's
Settings; this app never sees the key. Kiwimake sends the requests, shows usage per app and can
switch AI off for this app. Nothing to install or declare.

```tsx
import { useAiStatus, ask, chat, runAgent, imagePart, AiError, aiProblemText, type AiMessage, type AiTool } from '@/lib/ai';
import { AiSetupNotice } from '@/components/AiSetupNotice';

// 1. Show the setup card while AI is not ready (no key yet, or AI switched off for this app).
const { status } = useAiStatus();                 // refreshes when the app comes back to the front
<AiSetupNotice status={status} />                  // renders nothing when AI is ready

// 2. One question
const answer = await ask('Suggest a name for a cat', { system: 'Answer in one line.' });

// 3. A conversation, streamed: show text as it arrives
const [messages, setMessages] = useState<AiMessage[]>([]);
const next: AiMessage[] = [...messages, { role: 'user', content: input }];
const reply = await chat({ messages: next, system: 'You are a friendly cooking helper.', onText: (t) => setLive((s) => s + t) });
setMessages([...next, reply.message]);            // always append reply.message, not just the text

// 4. An agent with tools: the AI calls your functions until it is done
const addItem: AiTool<{ name: string; qty?: number }> = {
  name: 'add_item',
  description: 'Add an item to the shopping list',
  parameters: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' } }, required: ['name'] },
  run: async ({ name, qty }) => { addToList(name, qty ?? 1); return 'added'; },
};
const result = await runAgent({
  prompt: 'Add what I need for pancakes',
  system: 'You manage the shopping list. Use the tools.',
  tools: [addItem],
  maxSteps: 6,                                    // AI turns before it stops (default 8)
  onText: (t) => setLive((s) => s + t),
  onToolCall: (c) => setStep(`Adding ${String(c.input.name)}`),
});
result.text; result.messages;                      // the final answer; the whole conversation to keep

// 5. Images in: base64 (no data: prefix), in a user message
await chat({ messages: [{ role: 'user', content: [imagePart(base64, 'image/jpeg'), { type: 'text', text: 'What plant is this?' }] }] });

// Errors: every call can throw AiError
try { await ask('Hi'); } catch (e) {
  if (e instanceof AiError) setProblem(e.needsSetup ? e.code : aiProblemText(e.code)); // e.code e.g. 'not_set_up', 'busy'
}
```

- Always handle "not ready": show `<AiSetupNotice status={status} />` (or `code={err.code}` after an
  `AiError` with `needsSetup`) where the AI feature would be, and keep the rest of the app working
  without AI. Its button opens Kiwimake's settings. Never show a key field in this app.
- Stream long answers with `onText`; pass `signal` (an `AbortController`'s) to let the person stop.
- Keep tools small and safe: the AI decides when to call them, so never give it a tool that deletes
  or spends without the person confirming in the UI.
- Limits set by Kiwimake: about 30 AI calls a minute and 3 at once per app (`AiError` code
  `limit`), answers up to `maxTokens` (default 8192). An agent step is one call.
- Images: to let the person pick or take a photo, install `expo-image-picker`
  (`npx expo install expo-image-picker`, then `launchImageLibraryAsync({ base64: true, quality: 0.6 })`)
  and pass `asset.base64`. Keep images small (quality 0.6 or a resize), a few MB at most.
- Save conversations with `usePersistentState` if the person should find them again.

### Feedback: shake and point at it (built in, keep it)

Every app made with Kiwimake has this, including copies the person shares with other people,
so anyone can tell them what to change. It needs no code and works on its own:

- Shaking the phone (a firm shake, back and forth a few times; walking or a bump never does it)
  opens a feedback screen over a screenshot of the current screen.
- Dragging draws an arrow with a number at its start (`#1`, `#2`, ...). Undo takes back the last
  one. Below is a notes box; each new arrow adds its `#n ` line there to fill in.
- Save makes one picture (the screenshot, the arrows and the notes), copies it to the clipboard
  and keeps it in the gallery's "Feedback" album, says "Copied and saved" and closes. The person
  pastes it into Kiwimake's chat, WhatsApp or anywhere.

Never remove it, never add options to it, and never draw your own feedback screen. When a
feedback picture comes to you in the chat, `#1`, `#2` in the notes are the numbered arrows on the
screenshot. To also open it from a button (for example "Send feedback" in a settings screen):

```tsx
import { openFeedback } from '../../modules/feedback';
<Button title="Send feedback" onPress={() => openFeedback()} />
```

It does not open while a full-screen alarm shows.

### Change this app (built in, keep it)

Every app made with Kiwimake has a **Settings screen with a "This app" group** whose first row
is **Change this app** (`src/components/ChangeThisApp.tsx`: `ThisAppSection`, or `ChangeThisAppRow`
alone in a settings list of your own design; the starter screen is `src/screens/SettingsScreen.tsx`).
The row opens Kiwimake at this app: the person who made it lands in this app's chat, anyone else
can suggest a change or make their own version; without Kiwimake it shows an explanation drawn
by the app. It hides itself on other people's phones when the owner turned it off in Kiwimake.

- **Never remove the row, the Settings screen, or a way to reach Settings** from the main screen
  (a "Settings" button, a gear, or a tab). When you redesign the app or replace the starter
  screens, keep `ThisAppSection` (or `ChangeThisAppRow`) last in the app's settings and restyle
  nothing else about it.
- The native part is `com.anyapp.updates.ChangeThisApp` and `ChangeSheet` in `modules/updates`
  (the same code in every Kiwimake app): never edit them.

### Updates for people the app is shared with (built in, nothing to do)

When the person shares the app from Kiwimake, the PC builds it with its update feed and the
app updates itself on other people's phones: it checks when it opens and once a day, shows a
notification when a new version is published, and a tap downloads, checks and installs it. On the
person's own phone Kiwimake installs every build, so the app stays quiet. This lives in
`modules/updates` (Kotlin, the same code as every Kiwimake app): never edit or remove it, and
never add another updater. Only if the person asks for an update line or a "Check for updates"
button, use `modules/updates/index.ts`:

```ts
import { checkForUpdate, openUpdate, updatesOn } from '../../modules/updates'; // from a file in src/app/ or src/lib/

if (updatesOn()) {
  const s = await checkForUpdate(); // { state: 'available', version, notes } | 'up-to-date' | 'anyappagent' | 'off' | 'problem'
  if (s.state === 'available') openUpdate(); // the update box: download, check, install
}
```

### Phone abilities: widgets, Quick Settings tiles, app shortcuts, receiving shares

Use these when the person asks for a home screen widget, a "button in the pull-down menu", a
long-press shortcut on the icon, or for the app to appear when they share something. Everything is
ready in `modules/abilities` (the same Kotlin code as every Kiwimake app): you only declare
what the app offers in `app.json` and write JavaScript. Add one plugin entry (all keys optional):

```json
["./modules/abilities/app.plugin.js", {
  "widgets":   [{ "id": "water", "name": "Water today", "description": "Glasses so far", "size": "small" }],
  "tiles":     [{ "id": "tea", "label": "Tea timer", "icon": "tea", "mode": "run", "action": "start-tea" }],
  "shortcuts": [{ "id": "log", "label": "Log a glass", "icon": "cup-water", "action": "log-glass" }],
  "shares":    ["text", "image"]
}]
```

- `widgets` (up to 4): `size` `small` (2x2), `wide` (4x2), `tall` (2x3, room for rows) or
  `large` (4x3); the person can resize. `name` shows in the phone's widget list.
- `tiles` (up to 4): `mode` `run` (the action runs in the background, default), `open` (opens
  the app with the action) or `toggle` (on and off; the action gets `data.on`). `action` defaults
  to the id.
- `shortcuts` (up to 4): shown when the app icon is long-pressed. `"open": true` opens the app
  with the action; otherwise it runs in the background and the app stays closed.
- `icon`: a Material Design Icons name (https://pictogrammers.com/library/mdi/, the names
  `npm run icon -- --search` finds). `"iconColor": "#14532D"` colours the shortcut icons
  (default: the app icon's background colour).
- `shares`: `text` (text and links), `image`, `video`, `file`.
- An app without this entry gets none of it: no widget in the list, no tile, no share target.
  Changing it needs a new build (automatic).

**Actions** (what a widget button, tile or shortcut does) have names you choose. Background
actions run your JavaScript while the app stays closed. Register them at the top level of a
module imported from `App.tsx` (never inside a component: with the app closed, no screen runs):

```ts
// src/lib/actions.ts, and in src/App.tsx: import '@/lib/actions';
import { onAction, setWidget, updateTile } from '../../modules/abilities';
import { diary } from '@/lib/diary';

onAction('log-glass', async () => {
  const n = await logGlass();          // your own code: save with storage.ts, update the widget
  diary('Glass logged from the widget'); // a diary note for every background action (see "The diary")
  return `Glass ${n} logged`;          // optional: a small message (needs the notification permission)
});
onAction('start-tea', async () => { await scheduleReminder({ at: new Date(Date.now() + 180_000), title: 'Tea is ready' }); });
onAction('focus', async (a) => { await save('focus', a.data.on === true); });   // a toggle tile
onAction('widget-update', async (a) => { if (a.from === 'water') showWater(await getGlasses()); }); // a new, empty widget
```

A background action has about 9 seconds. Its message shows only if the app may post notifications
(ask once with `ensureNotificationPermission()`); otherwise Android hides it, so also update the
widget or tile so the person sees it worked. Actions that open the app (`open: true`, a widget tap
with `tapAction`) reach a screen:

```tsx
import { useOpenAction } from '../../modules/abilities';
useOpenAction((a) => { if (a.name === 'show-inbox') navigation.navigate('Inbox'); });
```

**Widgets** show what you last gave them, so set the content whenever the data changes (and on
app start). Android draws it while the app is closed; `countdownTo` counts down live and a
`timeline` moves the widget on by itself (next prayer, a new day at midnight):

```ts
import { setWidget, pinWidget, isWidgetPlaced } from '../../modules/abilities';

setWidget('water', {
  title: 'Water today',                    // small line in the accent colour
  value: '5 of 8',                         // the big text
  subtitle: '3 to go',
  progress: 5 / 8,                         // a bar, 0 to 1
  button: { label: 'Log a glass', action: 'log-glass' },   // open: true to open the app instead
  tapAction: 'show-log',                   // optional: tapping the widget opens the app with it
  accent: '#1F5C45', accentDark: '#7FC7A6',
  timeline: [{ at: midnight, value: '0 of 8', subtitle: '8 to go', progress: 0 }],
});
setWidget('prayer', {
  title: 'Asr in', countdownTo: asrTime, subtitle: 'Ajman',
  rows: [{ label: 'Dhuhr', value: '12:08' }, { label: 'Asr', value: '15:21', strong: true }],  // up to 6
  timeline: [{ at: asrTime, title: 'Maghrib in', countdownTo: maghribTime, rows: [/* Maghrib strong */] }],
});
if (!isWidgetPlaced('water')) pinWidget('water');   // "Add to home screen" button: Android asks the person
```

- A timeline entry changes only the fields it names. Plan a day or more ahead (all of today's
  prayers, midnight); the app refreshes it the next time it opens.
- Keep text short: the widget has one big value and two small lines. Use the app's accent.
- If `pinWidget` returns false, tell the person: "Touch and hold the home screen, tap Widgets,
  find this app".

**Tiles** change their label or subtitle from code: `updateTile('tea', { subtitle: 'Ready at 15:40' })`,
`updateTile('focus', { on: true })`, `isTileOn('focus')`. The person adds a tile once: pull down
the status bar twice, tap the pencil, drag the tile up. Say so in the app.

**Shares**: with `shares` in app.json the app appears in the share sheet. A share opens the app:

```tsx
import { useIncomingShare, deleteSharedFile } from '../../modules/abilities';

useIncomingShare((s) => {       // in the first screen; also gets the share that opened the app
  s.text; s.url;                // a shared link arrives as text; url is its first web address
  s.files;                      // [{ uri: 'file://...', mimeType: 'image/jpeg', name, size }], copied into the app
  setInbox((prev) => [s, ...prev]);
});
<Image source={{ uri: s.files[0].uri }} />
```

Shared files stay in the app until `deleteSharedFile(file)`; save the `uri` in storage to keep
them. Show what arrived at once ("Saved") so the person knows it worked.

### Camera smarts: scan codes, read text from pictures (on the phone, no cost)

Off by default, so apps that do not use it stay small. Turn on what the app needs in `app.json`:

```json
["./modules/camera/app.plugin.js", { "codes": true, "text": true }]
```

- `codes`: `scanCode()` opens Google's full-screen scanner (QR codes and barcodes). It comes with
  Google Play services, so the app needs no camera permission. `readCodes(uri)` finds the codes in
  a picture.
- `text`: `readText(uri)` reads printed text (Latin letters) from a picture, with ML Kit on the
  phone.
- By default the scanner and the reading models come with Google Play services: the phone fetches
  them once, on first use (this needs the Play Store; until then the calls throw "not on this
  phone yet"). Codes and text together add only about 0.35 MB to the app.
- `"bundled": true` puts the reading models inside the app: `readText` and `readCodes` then work
  offline from the first use, also on phones without Google Play services, for about 9 MB more
  per CPU type (text alone 5.9 MB). Only if the person needs that. `scanCode()` always needs
  Google Play services; without it, read codes from a photo with `readCodes`.

```ts
import { scanCode, readCodes, readText, cameraSmarts } from '../../modules/camera';
import * as ImagePicker from 'expo-image-picker';   // npx expo install expo-image-picker (for photos)

const code = await scanCode();          // null if closed; { value: '4006381333931', format: 'ean13', kind: 'product' }
if (code?.kind === 'url') { /* code.value is a web address */ }
const found = await readCodes(pictureUri);   // every code in a picture (a screenshot, a shared photo)

const perm = await ImagePicker.requestCameraPermissionsAsync();
const shot = await ImagePicker.launchCameraAsync({ quality: 1 });   // or launchImageLibraryAsync
if (!shot.canceled) {
  const { text, lines } = await readText(shot.assets[0].uri);       // a receipt: find the total in lines
}
```

- Both can throw (no Google Play services, the first download still running, an unreadable
  picture): catch it and show a friendly line with a "Try again" button.
- For a photo diary or plain photos you only need `expo-image-picker` (no camera smarts).
- A live camera view inside a screen (scanning many items in a row) needs `expo-camera`
  (`npx expo install expo-camera`, its `CameraView` with `onBarcodeScanned`): it is much bigger,
  so prefer `scanCode()` in a loop unless the person asks for that.

### The diary (what the app did, for fixing things later)

The app keeps a small private diary on the phone. When the person says something did not work
("why didn't it ring?"), you read it with the `read_diary` tool (MCP server `app`) instead of
guessing. So write a note for every background action and every event that matters later:

```tsx
import { diary } from '@/lib/diary';

diary('Prayer times loaded for Ajman: 6 times');
diary('Fajr alarm set for 05:12');           // the alarms write "set" and "rang" notes by themselves
diary('Location not allowed, used the saved city');
diary('Could not load the weather: offline');
```

- One short line each (at most 200 characters); the newest 300 notes are kept.
- **Never personal content**: no names, messages, places the person typed, health data, or
  anything they wrote. Write what the app did and why ("Reminder set for 08:00", "List saved: 12
  items"), not what it contains. The diary goes only to the person's own PC, and only when you
  ask for it; never copy it into the app, a page or GitHub.
- Crashes and caught errors are written to it by themselves.

### Crashes

Crashes are caught by themselves (`src/lib/crash.ts`, `modules/diary`, `src/components/CrashBoundary.tsx`,
set up in `src/App.tsx`: leave that in place). Kiwimake shows the person "<app> crashed. Fix
it?" and a tap sends you the report (message, stack, screen, version, the latest diary notes) as
"Fix the crash". The stack comes from the release bundle, so match it to the code by the error
message and the screen. An error you catch but want to hear about: `reportError(error)` from
`@/lib/crash`.

### What changed

Before you end a turn that changed the app, call the `describe_change` tool (MCP server `app`)
with what changed in the person's words, what to try, and anything to know. It shows on the new
version's card on their phone. Every version is a commit in Git ("Build N: ..."); the person can go
back to any version with Versions in their chat, so never rewrite Git history.

### Other things already installed

`expo-constants` (app name/version: `Constants.expoConfig?.name`),
`@expo/vector-icons`, `react-native-safe-area-context`, `expo-status-bar`. `fetch` works for the
internet (HTTPS). `expo-updates` is installed but **off**: over-the-air updates are done by
`modules/updates` (see "Quick updates and new installs"); leave both as they are.

## Quick updates and new installs (the PC decides, you choose wisely)

After your turn the PC looks at what changed and picks how the new version reaches the phone:

- **Quick update (seconds, no install):** only the JavaScript changed: anything in `src/`, the
  TypeScript in `modules/*/index.ts`, texts, colours, layout, logic, new screens. The PC bundles it
  without Gradle and sends it over the air through Kiwimake. The app shows a small "Version N is
  ready" card with **Reload**, which starts the new code in place in about a second. If the app is
  closed, it simply opens with the new version next time.
- **New install (a few minutes):** anything native changed: `app.json` (name, permissions,
  plugins), `package.json` or the lockfile (a new library), anything in `assets/` (the icon,
  pictures, sounds, fonts), native files in `modules/` (Kotlin, manifests, `app.plugin.js`). The PC
  runs the full build; the same card appears and Reload installs the new APK and opens the app again.
- A quick update that crashes when it starts is rolled back on the phone by itself (to the last
  version that worked) and Kiwimake is told.

So: prefer a solution in code when it is as good (an icon from `@expo/vector-icons` instead of a
new picture, a library already installed instead of a new one), and say in your last sentence which
it will be: "Sent as a quick update, no install needed." or "This one needs a new install, it takes
a few minutes." The quick update code lives in `modules/updates` (`Ota.kt`, `ReadyPopup.kt`, the
loader in `AnyappUpdatesPackage.kt`): never edit or remove it, never add another updater, and never
turn on `expo-updates`.

## The app icon

The launcher icon is **`assets/icon.png`**: a 1024x1024 PNG, square, opaque, full-bleed (no
rounded corners, no transparency). Android crops about a sixth from every edge into a circle or
squircle, so keep the picture in the middle ~60%. Give every app its own icon that matches what it
does (the starter icon, a plain outline on graphite, is a placeholder). Flat colour, one simple
glyph that says what the app is for, no gradients, no sparkles:

```
npm run icon -- --bg "#14532D" --fg "#F4F1E8" --glyph mosque      # flat colour + glyph
npm run icon -- --bg "#1E2023" --letter W                         # colour + letter
npm run icon -- --search alarm                                    # find glyph names
```

Options: `--fg` glyph colour (default white), `--scale` glyph size 0.2 to 0.7 (default 0.46). Glyphs
are Material Design Icons (https://pictogrammers.com/library/mdi/). You may also write any other
1024x1024 PNG to that path. The icon change ships with the next build.

## Permissions already declared

Notifications, exact alarms (`USE_EXACT_ALARM`, `SCHEDULE_EXACT_ALARM`), run at boot, wake lock,
vibration, foreground service (media playback, for alarm sound/speech), internet, location
(coarse + fine), microphone (`expo-audio`). Runtime permissions (notifications, location,
microphone) must still be **asked for in code** before use, as in the snippets. Adding a new
permission: add it to `android.permissions` in `app.json`.

## Plan first, and pages in the chat

- Before you build a new app or make a large change (a new screen, a new feature, a redesign), the
  person confirms a plan: the plan as bullets and sub-bullets in the chat, and a plan page (a picture
  of what you will build, then "Build it?"). Start only after their yes. Small changes need no plan.
- Pages are HTML files you show in the chat with the `show_page` tool (MCP server `pages`): a plan,
  a mockup of a screen, how a feature would work, or questions they answer on the page. The guide
  (the skeleton and the question kit) is named in your instructions; read it before your first page.
- Page files never go into this project: write them in the folder the `show_page` tool names.

## When the build fails

The error you receive is the useful part of the output: TypeScript errors, a Metro (bundling)
error with the file and line, or a Gradle/Kotlin error. Fix the cause; do not work around it by
deleting features. The full log is in `build/logs/`.
