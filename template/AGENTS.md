# Working on this app

You are changing an Android app for a non-technical person who uses it on their phone. They tell
you what they want in plain words; they never see the code. When your turn ends, AnyAppAgent
builds a signed **release** APK from this folder (the JavaScript is embedded, there is no dev
server) and installs it over the version on their phone. If the build fails, the error comes back
to you as your next prompt. **Keep the app building, and check your work before you finish.**

Stack: Expo SDK 58, React Native 0.88 (New Architecture, Hermes), React 19.3, TypeScript (strict),
React Navigation 7. Android only. Expo changes between SDKs; when unsure of an API, read the docs
for this exact SDK: https://docs.expo.dev/versions/v58.0.0/ (or the `.d.ts` files in
`node_modules`), not memory.

## Layout

```
index.ts                 entry point (leave it)
src/App.tsx              root: navigation (register screens here), theme, one-time setup
src/screens/             one file per screen; HomeScreen.tsx is the starter screen: replace it
src/components/          Screen (safe area + scroll), Card, Button: reuse them
src/lib/storage.ts       persistent JSON storage + usePersistentState hook
src/lib/notifications.ts notification permission, notify now, exact scheduled reminders
src/lib/alarms.ts        exact alarms with sound + spoken text, work while the app is closed
src/lib/ai.ts            AI (chat, streaming, tools, agents) through AnyAppAgent's key
src/components/AiSetupNotice.tsx  the "AI is not set up" card with a button to AnyAppAgent
src/theme.ts             colours (light + dark), spacing, radius, font sizes
assets/icon.png          THE launcher icon (1024x1024 PNG); also the splash and starter image
assets/sounds/           sound files for alarms and in-app playback (adhan.mp3, beep.wav, …)
scripts/make-icon.mjs    makes assets/icon.png from a colour and a glyph or letter
modules/alarms/          native (Kotlin) code behind src/lib/alarms.ts
modules/ai/              native (Kotlin) code behind src/lib/ai.ts (leave it)
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
// src/screens/SettingsScreen.tsx
import { useNavigation } from '@react-navigation/native';
export function SettingsScreen() { /* … */ }

// src/App.tsx: register it in RootStack.screens
Settings: { screen: SettingsScreen, options: { title: 'Settings' } },

// anywhere: navigate (typed from RootStack)
const navigation = useNavigation();
navigation.navigate('Settings');
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

### AI: chat, streaming, tools and agents (Claude or OpenRouter, through AnyAppAgent)

Use this whenever the person asks for anything AI: a chat, summaries, smart suggestions, reading a
photo, an assistant that does things in the app. The person adds their AI key once in AnyAppAgent's
Settings; this app never sees the key. AnyAppAgent sends the requests, shows usage per app and can
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
  without AI. Its button opens AnyAppAgent's settings. Never show a key field in this app.
- Stream long answers with `onText`; pass `signal` (an `AbortController`'s) to let the person stop.
- Keep tools small and safe: the AI decides when to call them, so never give it a tool that deletes
  or spends without the person confirming in the UI.
- Limits set by AnyAppAgent: about 30 AI calls a minute and 3 at once per app (`AiError` code
  `limit`), answers up to `maxTokens` (default 8192). An agent step is one call.
- Images: to let the person pick or take a photo, install `expo-image-picker`
  (`npx expo install expo-image-picker`, then `launchImageLibraryAsync({ base64: true, quality: 0.6 })`)
  and pass `asset.base64`. Keep images small (quality 0.6 or a resize), a few MB at most.
- Save conversations with `usePersistentState` if the person should find them again.

### Other things already installed

`expo-constants` (app name/version: `Constants.expoConfig?.name`),
`@expo/vector-icons`, `react-native-safe-area-context`, `expo-status-bar`. `fetch` works for the
internet (HTTPS). `expo-updates` is installed for later over-the-air updates but **off**; leave it.

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

## When the build fails

The error you receive is the useful part of the output: TypeScript errors, a Metro (bundling)
error with the file and line, or a Gradle/Kotlin error. Fix the cause; do not work around it by
deleting features. The full log is in `build/logs/`.
