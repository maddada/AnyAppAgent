# Working on this app (AnyAppAgent, Expo Exact alpha)

You are changing an app for a non-technical person who uses it on their Android phone. They tell
you what they want in plain words; they never see the code. When your turn ends, AnyAppAgent
builds a signed Android APK from this folder and installs it over the version on their phone. If
the build fails, the error comes back to you as your next prompt. **Keep the app building, and
check your work before you finish.**

This app is made with **Expo Exact** (https://github.com/expo/exact), which is very new (pre-1.0,
"alpha" in AnyAppAgent). The view is written in **Contract** (`app.contract`), the data in
TypeScript (`app.ts`, run by Hermes on the phone). There is no React and no JSX. Exact's own guide
for this app is the generated block below this section, and `../../exact/docs/start-here.md` is
the one document you must read before your first change. `bun exact.mjs contract vocab <name>`
answers what a tag or property is called; `bun exact.mjs docs <words>` finds a guide section.
Exact changes daily: trust the checkout's docs and the compiler's messages, not memory.

## Layout

```
app.contract        the view, state and actions (Contract)
app.ts              the data module (TypeScript): what the view asks for
app.test.contract   the app's tests
app.json            Exact's manifest: name, id and hosts (android is on)
anyapp.json         written by AnyAppAgent: preset, slug, package id (read only)
exact.mjs           generated launcher for `bun exact.mjs ...` (never edit)
.exact/, target/    generated build folders (never edit)
```

## Never

- Never change `app.id` in `app.json`, `anyapp.json`, or anything about signing or versions.
  AnyAppAgent sets the version code and signs every build with the same key; a different id
  would be a different app that cannot update the one on the phone. You may change `app.name`
  (the name under the icon) when the person asks to rename the app.
- Never run anything that needs a phone or builds or installs the app: `bun exact.mjs android`,
  `verify`, `test android`, `agent android`, `ios`, `mac`, `share`, `windows`, Gradle or adb.
  AnyAppAgent does the Android build after your turn.
- Never run `bun exact.mjs update`, and never edit anything in `../../exact`: it is the shared,
  pinned Exact checkout every Exact app on this PC builds with.
- Never run `bun exact.mjs feedback` (nothing about the person's app leaves this PC).
- Never put secrets or keys in the app.

## Check your work (no device needed)

```
bun exact.mjs contract build app.contract --json      # [] means no problems
```

The first run of the day can take a couple of minutes (it builds the compiler); after that it is
quick. Fix every diagnostic it prints (each has a stable id and a source range). It does not
catch run time problems, so read `app.ts` for crashes too (missing data, unhandled errors).

## Words in the app

- **Never use the em dash character (U+2014) anywhere**: not in UI text, comments, or your
  messages. Use a comma, colon, full stop or parentheses instead.
- Short, friendly, plain words; no technical terms in anything the person sees.

## Design: the person's taste (follow it)

The person said: "no purple gradients or AI slop please". So:

- **No purple gradients, and no gradients as decoration at all.** Flat colour, hairlines, space.
- **No sparkle, magic wand, stars or "AI" icons**, and no "magical" wording.
- **No generic AI look**: no glowing cards, glassmorphism, neon, emoji as decoration.
- **Design the app for what it is for**, calm and well made: clear hierarchy, generous spacing,
  one restrained accent colour, light and dark both deliberate.
- Exact gives the platform's own controls, colours and type when you leave them unsaid: say less
  and the app looks more at home. Add colour only where it helps.

## What this preset does not have yet (alpha)

- **No AI through AnyAppAgent**: the shared AI key is not connected to Exact apps yet. If the
  person asks for AI, say in one line that this kind of app cannot use AI yet.
- **No custom launcher icon**: Exact's Android shell has no icon support yet, so the app shows
  Android's default icon. Do not spend the turn on an icon.
- **No exact alarms or notifications from AnyAppAgent's toolkit** (those are in the React Native
  and Kotlin starters). Use what Exact itself offers (its docs), and say plainly when something
  is not possible in this kind of app yet.

## Plan first, and pages in the chat

- Before you build a new app or make a large change (a new screen, a new feature, a redesign), the
  person confirms a plan: the plan as bullets and sub-bullets in the chat, and a plan page (a picture
  of what you will build, then "Build it?"). Start only after their yes. Small changes need no plan.
- Pages are HTML files you show in the chat with the `show_page` tool (MCP server `pages`): a plan,
  a mockup of a screen, how a feature would work, or questions they answer on the page. The guide
  (the skeleton and the question kit) is named in your instructions; read it before your first page.
- Page files never go into this project: write them in the folder the `show_page` tool names.

## When the build fails

The error you receive is the useful part of the output: Contract diagnostics, Rust errors, or
Gradle's "What went wrong". Fix the cause in `app.contract` or `app.ts`; do not work around it by
deleting features. The full log is in `build/logs/`.
