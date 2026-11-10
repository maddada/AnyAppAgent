import { useColorScheme } from "react-native";
import { useStore } from "@/lib/store";

/**
 * THE theme module: every colour, font, size, radius and spacing value the app uses lives here,
 * under semantic names, so the shared design tokens (shared/theme/) can replace these values
 * in one place.
 *
 * Colours and type copied from bb's theme (apps/app/src/components/ui/theme.css, MIT), oklch
 * converted to hex. Names follow bb's tokens so the chat components read like bb's.
 */
const light = {
  dark: false,
  background: "#ffffff",
  foreground: "#333333",
  primary: "#262626",
  primaryForeground: "#ffffff",
  secondary: "#ededed",
  muted: "#e6e6e6",
  mutedForeground: "#525252",
  subtleForeground: "#636363",
  border: "#dfdfdf",
  seam: "#e9e9e9",
  input: "#bdbdbd",
  recessed: "#f1f1f1",
  raised: "#f9f9f9",
  card: "#ffffff",
  hover: "#f2f2f2",
  active: "#e4e4e4",
  inlineCode: "#eeeeee",
  destructive: "#a5000f",
  destructiveText: "#a5000f",
  destructiveSurface: "rgba(165,0,15,0.06)",
  attention: "#dc9e12",
  attentionSurface: "rgba(220,158,18,0.18)",
  warning: "#eb7c33",
  success: "#3bb974",
  successText: "#008246",
  accentBlue: "#4075aa",
  diffAdded: "#005c32",
  diffRemoved: "#8d0000",
  shadow: "rgba(51,51,51,0.07)",
  shadowColor: "#000000",
  scrim: "rgba(0,0,0,0.32)",
  placeholder: "rgba(99,99,99,0.8)",
  quoteBorder: "rgba(38,38,38,0.35)",
  activeRow: "rgba(230,230,230,0.7)",
  onColor: "#ffffff", // text and glyphs on a coloured or photo background
  cameraBackdrop: "#000000",
  cameraFrame: "rgba(255,255,255,0.9)",
  cameraButton: "rgba(0,0,0,0.45)",
  /** Background of an app's letter tile while its icon loads (picked per app). */
  appColors: ["#5b7cfa", "#22a06b", "#e2711d", "#c2410c", "#7c3aed", "#0e7490", "#be185d", "#4d7c0f"],
};

const dark: typeof light = {
  dark: true,
  background: "#151515",
  foreground: "#c1c1c1",
  primary: "#c4c4c4",
  primaryForeground: "#1a1a1a",
  secondary: "#282828",
  muted: "#2c2c2c",
  mutedForeground: "#b7b7b7",
  subtleForeground: "#989898",
  border: "#313131",
  seam: "#252525",
  input: "#464646",
  recessed: "#1d1d1d",
  raised: "#181818",
  card: "#151515",
  hover: "#292929",
  active: "#363636",
  inlineCode: "#252525",
  destructive: "#cc323d",
  destructiveText: "#e06062",
  destructiveSurface: "rgba(204,50,61,0.10)",
  attention: "#f0b135",
  attentionSurface: "rgba(240,177,53,0.18)",
  warning: "#fc8c45",
  success: "#4bc680",
  successText: "#4bc680",
  accentBlue: "#79a9db",
  diffAdded: "#00d594",
  diffRemoved: "#ff696d",
  shadow: "rgba(0,0,0,0.26)",
  shadowColor: "#000000",
  scrim: "rgba(0,0,0,0.55)",
  placeholder: "rgba(152,152,152,0.8)",
  quoteBorder: "rgba(196,196,196,0.35)",
  activeRow: "rgba(44,44,44,0.7)",
  onColor: "#ffffff",
  cameraBackdrop: "#000000",
  cameraFrame: "rgba(255,255,255,0.9)",
  cameraButton: "rgba(0,0,0,0.45)",
  appColors: ["#5b7cfa", "#22a06b", "#e2711d", "#c2410c", "#7c3aed", "#0e7490", "#be185d", "#4d7c0f"],
};

export type Theme = typeof light;

export function useTheme(): Theme {
  const pref = useStore((s) => s.prefs.theme);
  const system = useColorScheme();
  const mode = pref === "system" ? (system === "dark" ? "dark" : "light") : pref;
  return mode === "dark" ? dark : light;
}

/** Inter, embedded at build time (expo-font plugin). Android picks weights by family name. */
export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  mono: "monospace",
};

/** bb's phone ("coarse pointer") type scale. */
export const type = {
  xs: { fontSize: 14, lineHeight: 20 },
  sm: { fontSize: 15, lineHeight: 22 },
  base: { fontSize: 16, lineHeight: 24 },
  lg: { fontSize: 18, lineHeight: 28 },
  xl: { fontSize: 22, lineHeight: 30 },
  xxl: { fontSize: 28, lineHeight: 36 },
  mono: { fontSize: 13, lineHeight: 19 },
};

export const radius = { sm: 4, md: 6, lg: 8, xl: 12, xxl: 16, sheet: 24, tile: 22, pill: 999 };

/** Spacing scale (dp). `page` is the side margin of every screen. */
export const space = { none: 0, xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40, hero: 80, page: 16, gap: 12 };

/** Fixed sizes of recurring things. */
export const sizes = {
  tileIcon: 76,
  sheetIcon: 60,
  headerIcon: 34,
  buildIcon: 44,
  composerButton: 36,
  buttonHeight: { sm: 32, md: 40, lg: 52, xl: 64 },
  maxContent: 760,
  rowDividerInset: 46, // settings rows: divider starts under the text, past the icon
  composerTrailing: 56, // room for the send button inside the composer
};
