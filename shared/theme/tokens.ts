// AnyAppAgent theme tokens: the single source of truth for the Android app (React Native) and the
// desktop app (Electron renderer, through the generated theme.css).
// Plain objects only: no imports, no platform APIs. Direction: "Workbench".
// Units: numbers are density-independent pixels (dp on Android, CSS px on desktop).
// letterSpacing is in px too (React Native has no em), already multiplied out for each size.
// After changing anything here run `node tools/gen-theme-css.mjs` and `node --test tools/`.

export const themeName = "Workbench";

// ---------------------------------------------------------------------------------------------
// Colour. Semantic first; the component group at the end only aliases or tunes semantic values.
// Contrast (WCAG 2.1, checked by tools/theme.test.mjs): text, textSecondary, textTertiary, ready
// and problem are at least 4.5:1 on bg, surface and surfaceSunken; onAccent on accent at least 4.5:1.
// ---------------------------------------------------------------------------------------------

export const color = {
  light: {
    bg: "#F3EFE7", // the page: warm paper
    surface: "#FBF9F4", // tiles, cards, sheets, the composer: lighter paper laid on the page
    surfaceSunken: "#E9E3D7", // pressed into the page: user bubble, badges, progress track, disabled send
    surfaceOverlay: "#FDFCF8", // dialogs, sheets and toasts that float above everything
    scrim: "rgba(31, 27, 22, 0.42)", // behind a sheet or dialog

    text: "#1F1B16", // graphite ink: titles, body, anything the user must read
    textSecondary: "#575046", // supporting copy, sub-lines, inactive navigation
    textTertiary: "#696155", // hints, timestamps, placeholders, quiet icons

    border: "#DED6C8", // hairlines between rows, card edges
    borderStrong: "#C2B7A5", // quiet button outline, empty slot, text field at rest

    accent: "#1D6A4A", // bottle green: the one next action on a screen. Nothing else.
    accentPressed: "#165A3D",
    onAccent: "#F7F4EC",

    working: "#575046", // the agent or the build is busy: ink with motion, never a colour
    workingSoft: "#E9E3D7",
    ready: "#1D6A4A", // a new version is ready / connected / done
    readySoft: "#DCE8DE",
    problem: "#A63A21", // brick red: could not build, could not connect
    problemSoft: "#F3DDD3",
    onProblem: "#FBF5F0",
    attention: "#E3A72F", // mustard yellow: the alert sign on an app that is behind ("Keep my apps healthy"). A filled badge, never text
    onAttention: "#2B2006", // the "!" on the attention badge
    attentionText: "#7A5300", // words next to the badge ("Needs an update"): readable ochre

    focus: "#1D6A4A", // keyboard focus ring (desktop), 2px outside the element

    tileBg: "#FBF9F4",
    tileBorder: "transparent",
    tileNewBg: "transparent",
    tileNewBorder: "#B3A893",
    bubbleBg: "#E9E3D7",
    bubbleBorder: "transparent",
    bubbleText: "#1F1B16",
    fieldBg: "#FBF9F4",
    fieldBorder: "#DED6C8",
    railBg: "#ECE7DD", // desktop sidebar and onboarding step rail
    selectedBg: "#E2DBCE", // current step, active navigation item, pressed list row
    listBg: "#FBF9F4",
    qrBg: "#FBF9F4",
    qrFg: "#1F1B16",
    markBg: "#1D6A4A",
    markFg: "#F7F4EC",
    codeBg: "#ECE6DB", // inline code and code blocks in assistant markdown
    iconEdge: "rgba(31, 27, 22, 0.08)", // 1px inner line on app icons so pale icons keep their edge
  },
  dark: {
    bg: "#181613", // the bench at night: warm brown-black, never pure black
    surface: "#211E1A",
    surfaceSunken: "#2C2824",
    surfaceOverlay: "#28241F",
    scrim: "rgba(0, 0, 0, 0.55)",

    text: "#EEE8DD",
    textSecondary: "#BDB3A5",
    textTertiary: "#9B9184",

    border: "#332F29",
    borderStrong: "#4B443B",

    accent: "#6DBB8F", // lighter and a touch softer than in light, so it does not glow
    accentPressed: "#5DA87E",
    onAccent: "#0E2117",

    working: "#BDB3A5",
    workingSoft: "#2C2824",
    ready: "#86CDA5",
    readySoft: "#1E3328",
    problem: "#EE8466",
    problemSoft: "#3A2219",
    onProblem: "#1F0E08",
    attention: "#E6B24A",
    onAttention: "#241A05",
    attentionText: "#E6B85C",

    focus: "#86CDA5",

    tileBg: "#211E1A",
    tileBorder: "#2B2722",
    tileNewBg: "transparent",
    tileNewBorder: "#564E44",
    bubbleBg: "#2E2A25",
    bubbleBorder: "transparent",
    bubbleText: "#EEE8DD",
    fieldBg: "#211E1A",
    fieldBorder: "#4B443B",
    railBg: "#1D1A17",
    selectedBg: "#2C2824",
    listBg: "#211E1A",
    qrBg: "#EEE8DD", // a QR code always scans dark on light
    qrFg: "#181613",
    markBg: "#6DBB8F",
    markFg: "#0E2117",
    codeBg: "#2A2622",
    iconEdge: "rgba(238, 232, 221, 0.08)",
  },
} as const;

export type ColorMode = keyof typeof color;
export type ColorToken = keyof (typeof color)["light"];

// ---------------------------------------------------------------------------------------------
// Type. Two families: Bricolage Grotesque (cut at two optical sizes: "display" for big headings,
// "text" for everything else) and IBM Plex Mono. Files and licences live in fonts/.
// React Native: use `native` as fontFamily and do not set fontWeight (each weight is its own file).
// `native` is always the file name without .ttf, because Expo's font config plugin registers an
// embedded font under its file name; load with useFonts under the same names.
// ---------------------------------------------------------------------------------------------

export const fontFamily = {
  display: {
    css: '"AA Display", "AA Text", "Segoe UI", system-ui, sans-serif',
    native: { 700: "BricolageGrotesque-Display-Bold", 800: "BricolageGrotesque-Display-ExtraBold" },
  },
  text: {
    css: '"AA Text", "Segoe UI", system-ui, sans-serif',
    native: { 400: "BricolageGrotesque-Text-Regular", 500: "BricolageGrotesque-Text-Medium", 600: "BricolageGrotesque-Text-SemiBold", 700: "BricolageGrotesque-Text-Bold" },
  },
  mono: {
    css: '"AA Mono", ui-monospace, "Cascadia Mono", Consolas, monospace',
    native: { 400: "IBMPlexMono-Regular", 500: "IBMPlexMono-Medium" },
  },
} as const;

// Every font file, the CSS family it is declared under and the name React Native loads it as.
export const fontFiles = [
  { file: "BricolageGrotesque-Display-Bold.ttf", cssFamily: "AA Display", weight: 700, native: "BricolageGrotesque-Display-Bold" },
  { file: "BricolageGrotesque-Display-ExtraBold.ttf", cssFamily: "AA Display", weight: 800, native: "BricolageGrotesque-Display-ExtraBold" },
  { file: "BricolageGrotesque-Text-Regular.ttf", cssFamily: "AA Text", weight: 400, native: "BricolageGrotesque-Text-Regular" },
  { file: "BricolageGrotesque-Text-Medium.ttf", cssFamily: "AA Text", weight: 500, native: "BricolageGrotesque-Text-Medium" },
  { file: "BricolageGrotesque-Text-SemiBold.ttf", cssFamily: "AA Text", weight: 600, native: "BricolageGrotesque-Text-SemiBold" },
  { file: "BricolageGrotesque-Text-Bold.ttf", cssFamily: "AA Text", weight: 700, native: "BricolageGrotesque-Text-Bold" },
  { file: "IBMPlexMono-Regular.ttf", cssFamily: "AA Mono", weight: 400, native: "IBMPlexMono-Regular" },
  { file: "IBMPlexMono-Medium.ttf", cssFamily: "AA Mono", weight: 500, native: "IBMPlexMono-Medium" },
] as const;

export type FontRole = keyof typeof fontFamily;

export interface TypeStyle {
  family: FontRole;
  native: string; // React Native fontFamily for this exact weight
  size: number;
  lineHeight: number;
  weight: 400 | 500 | 600 | 700 | 800;
  letterSpacing: number;
  transform: "none" | "uppercase";
}

export const type = {
  // Desktop onboarding headline only.
  hero: { family: "display", native: "BricolageGrotesque-Display-ExtraBold", size: 50, lineHeight: 52, weight: 800, letterSpacing: -1.5, transform: "none" },
  // The one big title of a phone screen ("Your apps").
  display: { family: "display", native: "BricolageGrotesque-Display-ExtraBold", size: 38, lineHeight: 42, weight: 800, letterSpacing: -1.1, transform: "none" },
  // Desktop page titles.
  title: { family: "display", native: "BricolageGrotesque-Display-ExtraBold", size: 28, lineHeight: 34, weight: 800, letterSpacing: -0.7, transform: "none" },
  // Sheet and dialog titles.
  titleSmall: { family: "display", native: "BricolageGrotesque-Display-ExtraBold", size: 22, lineHeight: 28, weight: 800, letterSpacing: -0.45, transform: "none" },
  // Card titles, the chat header, "Your app is ready".
  heading: { family: "text", native: "BricolageGrotesque-Text-SemiBold", size: 17, lineHeight: 22, weight: 600, letterSpacing: -0.1, transform: "none" },
  // App names under icons and in lists.
  name: { family: "text", native: "BricolageGrotesque-Text-SemiBold", size: 16, lineHeight: 21, weight: 600, letterSpacing: -0.08, transform: "none" },
  body: { family: "text", native: "BricolageGrotesque-Text-Regular", size: 16, lineHeight: 24, weight: 400, letterSpacing: 0, transform: "none" },
  // Assistant markdown. Same as body today; its own role so a direction can give the agent a voice.
  prose: { family: "text", native: "BricolageGrotesque-Text-Regular", size: 16, lineHeight: 24, weight: 400, letterSpacing: 0, transform: "none" },
  lede: { family: "text", native: "BricolageGrotesque-Text-Regular", size: 18, lineHeight: 28, weight: 400, letterSpacing: 0, transform: "none" },
  callout: { family: "text", native: "BricolageGrotesque-Text-Regular", size: 15, lineHeight: 21, weight: 400, letterSpacing: 0, transform: "none" },
  // States, tool-row titles, list meta, small buttons.
  label: { family: "text", native: "BricolageGrotesque-Text-Medium", size: 14, lineHeight: 19, weight: 500, letterSpacing: 0, transform: "none" },
  // Chat rows at rest: thinking, tool calls, plan items, build sub-lines, errors.
  row: { family: "text", native: "BricolageGrotesque-Text-Regular", size: 14, lineHeight: 20, weight: 400, letterSpacing: 0, transform: "none" },
  caption: { family: "text", native: "BricolageGrotesque-Text-Regular", size: 13, lineHeight: 17, weight: 400, letterSpacing: 0, transform: "none" },
  button: { family: "text", native: "BricolageGrotesque-Text-SemiBold", size: 16, lineHeight: 20, weight: 600, letterSpacing: 0, transform: "none" },
  buttonSmall: { family: "text", native: "BricolageGrotesque-Text-SemiBold", size: 14, lineHeight: 18, weight: 600, letterSpacing: 0, transform: "none" },
  // Tool-call details, diffs, file names, times in logs.
  mono: { family: "mono", native: "IBMPlexMono-Regular", size: 13, lineHeight: 18, weight: 400, letterSpacing: 0, transform: "none" },
  // "STEP 3 OF 4", panel labels: the workshop drawer label.
  eyebrow: { family: "mono", native: "IBMPlexMono-Medium", size: 11, lineHeight: 14, weight: 500, letterSpacing: 0.9, transform: "uppercase" },
} as const satisfies Record<string, TypeStyle>;

export type TypeRole = keyof typeof type;

// Bold inside running text (assistant markdown **strong**).
export const strongWeight = { weight: 600, native: "BricolageGrotesque-Text-SemiBold" } as const;

// ---------------------------------------------------------------------------------------------
// Space, size and shape
// ---------------------------------------------------------------------------------------------

export const space = {
  none: 0,
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  "6xl": 64,
  "7xl": 80,
} as const;

export const size = {
  touch: 44, // smallest tappable thing on the phone
  buttonHeight: 48,
  buttonHeightSmall: 36,
  fieldHeight: 52,
  composerMinHeight: 52,
  sendButton: 40,
  appIcon: 64, // home tile
  appIconMedium: 44, // desktop list
  appIconSmall: 36, // chat header
  badge: 40, // round-cornered square holding an icon inside a card
  tileMinHeight: 172,
  screenGutter: 20, // phone left/right padding
  gridGap: 12,
  railWidth: 300, // desktop onboarding step rail
  sidebarWidth: 240, // desktop main window
  readingWidth: 640, // longest line of running text on desktop
  progressHeight: 6,
  dot: 8, // state dot
  spinner: 13,
  stateIcon: 15, // the problem mark in a state line
  rowHeight: 56, // settings list row
  appRowHeight: 72, // desktop app list row
  toolRowHeight: 32, // chat tool-call row (hit area padded to `touch`)
  chatHeaderHeight: 60,
  stepBadge: 26, // onboarding step number
  dialogWidth: 440,
  qr: 136, // QR modules area; never below 120
  toastMaxWidth: 420,
  bubbleMaxWidthPercent: 85, // user bubble on the phone (70 on desktop, as in bb)
} as const;

export const radius = {
  window: 10,
  button: 12,
  field: 14,
  appIcon: 16, // at 64; scale with the icon: radius = size / 4
  tile: 20,
  card: 16,
  badge: 12,
  sheet: 24, // top corners of a bottom sheet, all corners of a dialog
  toast: 14,
  composer: 26,
  send: 20,
  step: 8,
  progress: 3,
  code: 6, // inline code
  full: 999,
  // The user's bubble keeps one tight corner on the side it speaks from.
  bubble: { topLeft: 18, topRight: 18, bottomRight: 6, bottomLeft: 18 },
} as const;

export const border = {
  width: 1,
  tileWidth: 1.5, // the dashed "new app" slot
  listWidth: 1,
  focusWidth: 2,
  tileNewStyle: "dashed",
} as const;

// Look switches a direction may flip. Workbench keeps them all quiet.
export const look = {
  displayTransform: "none", // "uppercase" in Signal
  buttonTransform: "none",
  thinkingFontStyle: "normal", // "italic" in Almanac
  tileAlign: "flex-start", // "center" in Almanac
  tileTextAlign: "left",
  tilePadding: 16,
  tileElevation: 1, // which elevation level a tile sits at
  wordmarkWeight: 800,
  wordmarkLetterSpacing: -0.025, // em, wordmark only (drawn, never set by RN)
} as const;

// ---------------------------------------------------------------------------------------------
// Elevation. Workbench is mostly flat paper: level 1 is a sheet of paper on the bench, 2 is a
// floating composer or toast, 3 is a dialog. `native` is for React Native (Android uses
// `elevation`, the shadow* keys are for parity on other platforms).
// ---------------------------------------------------------------------------------------------

export const elevation = {
  light: {
    0: { css: "none", native: { elevation: 0, shadowColor: "#462E14", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } } },
    1: { css: "0 1px 1px rgb(70 50 20 / 0.06), 0 2px 6px -2px rgb(70 50 20 / 0.10)", native: { elevation: 1, shadowColor: "#462E14", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } } },
    2: { css: "0 2px 4px rgb(70 50 20 / 0.06), 0 8px 20px -6px rgb(70 50 20 / 0.16)", native: { elevation: 4, shadowColor: "#462E14", shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } } },
    3: { css: "0 4px 8px rgb(70 50 20 / 0.08), 0 24px 48px -12px rgb(70 50 20 / 0.28)", native: { elevation: 12, shadowColor: "#462E14", shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } } },
  },
  dark: {
    0: { css: "none", native: { elevation: 0, shadowColor: "#000000", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } } },
    1: { css: "0 1px 0 rgb(0 0 0 / 0.25)", native: { elevation: 1, shadowColor: "#000000", shadowOpacity: 0.3, shadowRadius: 1, shadowOffset: { width: 0, height: 1 } } },
    2: { css: "0 2px 4px rgb(0 0 0 / 0.3), 0 10px 24px -6px rgb(0 0 0 / 0.45)", native: { elevation: 4, shadowColor: "#000000", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } } },
    3: { css: "0 4px 10px rgb(0 0 0 / 0.35), 0 28px 56px -12px rgb(0 0 0 / 0.6)", native: { elevation: 12, shadowColor: "#000000", shadowOpacity: 0.55, shadowRadius: 28, shadowOffset: { width: 0, height: 12 } } },
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Motion. Calm and short. Easing values are cubic-bezier control points, usable as
// Easing.bezier(...easing.standard) in React Native and cubic-bezier() in CSS.
// Respect "reduce motion": drop translations, keep opacity fades at `fast`.
// ---------------------------------------------------------------------------------------------

export const motion = {
  duration: {
    instant: 80, // press feedback
    fast: 140, // colour and opacity changes, chevrons
    base: 220, // rows expanding, a build row turning into "ready"
    slow: 360, // sheets and dialogs entering
    spinner: 900, // one turn of the working spinner
    progressSweep: 1600, // indeterminate progress, one pass
  },
  easing: {
    standard: [0.2, 0, 0, 1],
    enter: [0, 0, 0, 1],
    exit: [0.3, 0, 1, 1],
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Icons: Lucide (ISC). lucide-react-native on the phone, lucide-react on the desktop.
// Always strokeWidth={icon.stroke} with absoluteStrokeWidth, so a 16px icon is as heavy as a 24px one.
// ---------------------------------------------------------------------------------------------

export const icon = {
  set: "lucide",
  stroke: 1.75,
  absoluteStrokeWidth: true,
  size: { sm: 16, button: 18, md: 20, lg: 24 },
} as const;

export const theme = { themeName, color, fontFamily, fontFiles, type, strongWeight, space, size, radius, border, look, elevation, motion, icon } as const;
export type Theme = typeof theme;
export default theme;
