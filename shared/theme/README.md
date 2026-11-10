# AnyAppAgent theme: Workbench

One look for the Android app (`app/`) and the desktop app (`desktop/`). A maker's bench: warm paper,
graphite ink and one bottle green that only ever means "do this next" or "ready". Bricolage
Grotesque for words, IBM Plex Mono for the labels on the drawers.

- `directions.html`: the three directions that were considered (Workbench, Almanac, Signal), with
  the reasons for choosing Workbench at the bottom. PNGs in `renders/`.
- `system.html`: the final system rendered from the real `theme.css`: colours, type, the mark,
  every component in `COMPONENTS.md`, and the four screens. PNGs in `renders/`.

## What is here

| Path | What |
| --- | --- |
| `tokens.ts` | **The source of truth.** Plain objects, no imports, no platform APIs. Colour (light, dark), type, space, size, radius, border, look switches, elevation, motion, icon rules. |
| `theme.css` | The same tokens as `--aa-*` custom properties for the desktop renderer. **Generated**, never edited by hand. |
| `COMPONENTS.md` | The exact spec, in tokens, of every shared component, including the chat pieces. |
| `fonts/` | 8 TTF files (2 families) and their OFL licences. |
| `mark/` | The app icon, wordmark and lockups as SVG, plus every PNG/ICO size both platforms need. |
| `tools/` | `gen-theme-css.mjs` (writes `theme.css`), `theme.test.mjs` (fails on drift), `build-pages.mjs`, `render-assets.mjs`, `make-wordmark.py`, and the page sources in `tools/pages/`. |

## Commands (Node 22.18 or newer; no install needed)

```
cd shared/theme
node tools/gen-theme-css.mjs          # after any change to tokens.ts
node --test tools/theme.test.mjs      # drift, contrast, fonts, page variables, no em dashes
node tools/build-pages.mjs            # rebuild system.html (directions.html needs --directions <fontdir>)
```

The test fails when `theme.css` is not exactly what `tokens.ts` generates, when a text colour drops
below WCAG AA on any surface, when a type style points at the wrong font file, when the pages use a
variable `theme.css` does not define, when there are more than two font families, or when any file
here contains an em dash.

## The Android app (React Native, Expo)

**Tokens.** Import the objects; they are plain TypeScript.

```ts
import { theme } from "@shared/theme/tokens"; // app/tsconfig.json already maps @shared/* to ../shared/*
```

Metro must be allowed to read the folder: add `metro.config.js` with
`config.watchFolders = [path.resolve(__dirname, "../shared")]` (Expo's default config plus that one
line). If that is ever a problem for EAS builds, copy `shared/theme` into the app at build time
instead; do not fork the values.

```ts
const scheme = useColorScheme() === "dark" ? "dark" : "light"; // or the user's own setting
const c = theme.color[scheme];
const t = theme.type.body;
<Text style={{ fontFamily: t.native, fontSize: t.size, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, color: c.text }} />
```

- Use `type.<role>.native` as `fontFamily` and never set `fontWeight` (each weight is its own file).
- Shadows: spread `theme.elevation[scheme][n].native` into the style.
- Easing: `Easing.bezier(...theme.motion.easing.standard)`; durations from `theme.motion.duration`.
- `radius.bubble` is per corner: `borderTopLeftRadius: r.topLeft` and so on.

**Fonts.** Either embed them with the `expo-font` config plugin in `app.json`
(`["expo-font", { "fonts": ["../shared/theme/fonts/BricolageGrotesque-Text-Regular.ttf", ...all 8] }]`),
or load them at start with `useFonts`, keyed by the same names (the file name without `.ttf`, which is
also each token's `native`):

```ts
useFonts({
  "BricolageGrotesque-Display-Bold": require("../../shared/theme/fonts/BricolageGrotesque-Display-Bold.ttf"),
  "BricolageGrotesque-Display-ExtraBold": require("../../shared/theme/fonts/BricolageGrotesque-Display-ExtraBold.ttf"),
  "BricolageGrotesque-Text-Regular": require("../../shared/theme/fonts/BricolageGrotesque-Text-Regular.ttf"),
  "BricolageGrotesque-Text-Medium": require("../../shared/theme/fonts/BricolageGrotesque-Text-Medium.ttf"),
  "BricolageGrotesque-Text-SemiBold": require("../../shared/theme/fonts/BricolageGrotesque-Text-SemiBold.ttf"),
  "BricolageGrotesque-Text-Bold": require("../../shared/theme/fonts/BricolageGrotesque-Text-Bold.ttf"),
  "IBMPlexMono-Regular": require("../../shared/theme/fonts/IBMPlexMono-Regular.ttf"),
  "IBMPlexMono-Medium": require("../../shared/theme/fonts/IBMPlexMono-Medium.ttf"),
});
```

The app currently loads Inter (`@expo-google-fonts/inter`); Inter goes away.

**Icon and system colours** (`app.json`):

```json
"icon": "../shared/theme/mark/android/expo/icon.png",
"android": {
  "adaptiveIcon": {
    "foregroundImage": "../shared/theme/mark/android/expo/adaptive-foreground.png",
    "backgroundColor": "#1D6A4A",
    "monochromeImage": "../shared/theme/mark/android/expo/adaptive-monochrome.png"
  }
}
```

The notification small icon is `mark/android/expo/notification-icon.png` (white, 96 px), tinted
`color.light.accent`. Splash: `mark/android/expo/icon.png` on `color.light.bg` (`color.dark.bg` in
dark). Status and navigation bars take `color[scheme].bg` with dark or light content to match.
Projects that are not Expo use `mark/android/res/` as is (every `mipmap-*` density, the
`mipmap-anydpi-v26` adaptive XML with the monochrome layer, and `drawable-*/ic_stat_anyappagent.png`).

**Replacing the current theme.** `app/src/ui/theme.ts` holds bb's greys today. Keep its `useTheme()`
hook if it helps, but make it return `theme.color[scheme]` (and the other groups) from `tokens.ts`;
do not copy values into the app.

## The desktop app (Electron renderer)

**Tokens.** Import the CSS once from the renderer entry; Vite bundles the fonts from the relative
`url("./fonts/...")` inside it:

```ts
import "../../../shared/theme/theme.css";
```

If the dev server refuses the path, add the folder to `server.fs.allow` in the renderer section of
`electron.vite.config.ts`. Then style with the variables: `background: var(--aa-bg)`,
`color: var(--aa-text-secondary)`, `border-radius: var(--aa-radius-card)`, `box-shadow:
var(--aa-shadow-1)`, or a type role in one class: `class="aa-type-heading"`. The TypeScript objects
are importable too (`../../../shared/theme/tokens.ts`) when a value is needed in code.

**Light and dark.** With nothing set, the page follows the OS (`prefers-color-scheme`). Set
`data-aa-theme="light"` or `"dark"` on `<html>` to force one, and mirror it with
`nativeTheme.themeSource` in the main process so the window frame matches. Window background before
first paint: `color.light.bg` / `color.dark.bg`.

**Icons for the window, installer and tray.** `mark/windows/anyappagent.ico` (16 to 256) for
`BrowserWindow({ icon })` and the installer. Tray: `new Tray(path/to/mark/windows/tray.png)`, with
`tray@1.25x.png` to `tray@3x.png` beside it so Electron picks the right one per display scale (or
`tray.ico`). The 16 and 24 px versions are drawn on the pixel grid (`mark/mark-small.svg`).

## Names an app needs to know

- **Colour** (`theme.color.light|dark`, CSS `--aa-<kebab>`): `bg`, `surface`, `surfaceSunken`,
  `surfaceOverlay`, `scrim`; `text`, `textSecondary`, `textTertiary`; `border`, `borderStrong`,
  `focus`; `accent`, `accentPressed`, `onAccent`; the three states `working` / `workingSoft`,
  `ready` / `readySoft`, `problem` / `problemSoft` (+ `onProblem`); component aliases `tileBg`,
  `tileBorder`, `tileNewBg`, `tileNewBorder`, `bubbleBg`, `bubbleBorder`, `bubbleText`, `fieldBg`,
  `fieldBorder`, `railBg`, `selectedBg`, `listBg`, `qrBg`, `qrFg`, `markBg`, `markFg`, `codeBg`,
  `iconEdge`.
- **Type** (`theme.type.<role>`, CSS `--aa-type-<role>-*` and `.aa-type-<role>`): `hero`,
  `display`, `title`, `titleSmall`, `heading`, `name`, `body`, `prose`, `lede`, `callout`, `label`,
  `row`, `caption`, `button`, `buttonSmall`, `mono`, `eyebrow`; plus `strongWeight`.
- **Space** `none hair xs sm md lg xl 2xl 3xl 4xl 5xl 6xl 7xl` (0 2 4 8 12 16 20 24 32 40 48 64 80).
- **Size**, **radius**, **border**, **look**, **elevation** (0 to 3), **motion** (`duration`,
  `easing`), **icon**: see `tokens.ts`; each one is commented.

## Icons

**Lucide** (ISC licence), `lucide-react-native` on the phone and `lucide-react` on the desktop; both
apps already depend on them. Rules:

- `strokeWidth={1.75}` with `absoluteStrokeWidth`, at every size, so small icons are as heavy as big
  ones. Round caps and joins (Lucide's default).
- Sizes: 16 in chat rows and inline, 18 in buttons, 20 in navigation and cards, 24 in headers.
- Icons are ink (`textSecondary` or `textTertiary` at rest, `text` when active). An icon is coloured
  only when it is a state mark (ready, problem) or sits on a filled button.
- One icon per meaning across both apps (the tool-row glyphs are listed in `COMPONENTS.md`). No
  icon without a word next to it, except the universal ones (back, settings, close, send).

## Fonts

| Family | Files | Licence |
| --- | --- | --- |
| Bricolage Grotesque (Ateliers Triay), static cuts at optical size 14 ("Text": 400, 500, 600, 700) and 36 ("Display": 700, 800) | `fonts/BricolageGrotesque-*.ttf` | SIL Open Font License 1.1, `fonts/OFL-BricolageGrotesque.txt` |
| IBM Plex Mono (IBM), 400 and 500 | `fonts/IBMPlexMono-*.ttf` | SIL Open Font License 1.1 (Reserved Font Name "Plex"), `fonts/OFL-IBMPlexMono.txt` |

The files are the static instances Google Fonts serves, unmodified, renamed only. Bundling them in
the apps is allowed by the OFL; keep the licence files next to them.

## The mark

Three finished tiles and one still being set into place: your apps, and the next one on the bench.
No robot, no sparkle, no gradient.

- `mark/mark.svg` (the full icon), `mark/mark-small.svg` (16 to 24 px), `mark/wordmark*.svg`
  (outlined, needs no font), `mark/lockup.svg` / `lockup-dark.svg` (mark plus wordmark).
- Android: `mark/android/adaptive-{foreground,background,monochrome}.svg`, inside the 66 dp safe
  zone; `expo/` (1024 px sources and the notification icon); `res/` (every density).
- Windows: `mark/windows/` (`anyappagent.ico`, `icon-16` to `icon-512.png`, `tray.ico`, the tray
  PNGs).
- Rebuild the PNGs and ICOs after changing an SVG: `node tools/render-assets.mjs --puppeteer <dir with
  puppeteer-core installed>` (uses the installed Chrome).

## Rules that keep the look intact

1. **Green is for one thing at a time.** `accent` is the next action on the screen (one primary
   button), and `ready` is a state. Never a link, a heading, a selected tab, a switch, a decorative
   icon or a background wash.
2. **Three states, no more.** Working is ink in motion, ready is green, problem is brick red. A new
   situation gets reworded into one of these, not a new colour.
3. **Ink by default.** Text, icons and lines are graphite; hierarchy comes from size, weight and the
   three text levels, not from colour.
4. **Paper, not glass.** Flat surfaces, hairlines, and the four elevation levels. No gradients, glows,
   blur, glass, neon, noise or pure black/white.
5. **Two families, the roles as given.** Bricolage Display only for `hero`, `display`, `title`,
   `titleSmall`; Plex Mono only for `mono` and `eyebrow`. Uppercase only in `eyebrow`.
6. **No decoration.** No emoji, sparkles, AI imagery, illustrations of robots, or pills on
   everything. The users' own app icons are the colour on the home screen.
7. **Plain words.** Short sentences, second person, no jargon without a reason in the same sentence.
   No em dashes in any copy.
8. **Values come from `tokens.ts`.** Never paste a hex code or a pixel size into a component; if a
   value is missing, add a token here and regenerate.

## Swapping in another direction

Everything a direction changes is a value in `tokens.ts`: colours (including the component
aliases such as `bubbleBg` and `tileBorder`), font files and roles, sizes, radii, border widths,
type case (`type.*.transform`) and the `look` switches (`thinkingFontStyle`, `tileAlign`,
`tileElevation`, ...). `tools/pages/directions.css` holds the full value sets of Almanac and Signal
as CSS. Two of their signatures would need one more switch each if ever chosen: Almanac's ruled grid
(hairlines between tiles instead of cards) and Signal's highlighted "ready" label.
