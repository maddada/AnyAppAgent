import { useColorScheme, type TextStyle } from "react-native";
import { theme as tokens, type ColorMode, type ColorToken, type TypeRole } from "@shared/theme/tokens";
import { useStore } from "@/lib/store";

/**
 * The app's only theme module. Every colour, font, size, radius, spacing, elevation and motion
 * value comes from the shared tokens (shared/theme/tokens.ts, the single source of truth for the
 * phone and the desktop). Nothing here is a value of its own, so another direction is a swap of
 * that file only. Rules: shared/theme/README.md; component specs: shared/theme/COMPONENTS.md.
 */

export const { space, size, radius, border, look, motion, icon, strongWeight } = tokens;
export const typeRoles = tokens.type;
export type { TypeRole, ColorToken, ColorMode };

/** The colour set for one mode. Literal hex types differ per mode, so widen to strings. */
export type Colors = Record<ColorToken, string> & { mode: ColorMode; dark: boolean };

const palettes: Record<ColorMode, Colors> = {
  light: { ...tokens.color.light, mode: "light", dark: false },
  dark: { ...tokens.color.dark, mode: "dark", dark: true },
};

export function useColorMode(): ColorMode {
  const pref = useStore((s) => s.prefs.theme);
  const system = useColorScheme();
  return pref === "system" ? (system === "dark" ? "dark" : "light") : pref;
}

export function useTheme(): Colors {
  return palettes[useColorMode()];
}

/** A type role as a React Native text style (fontFamily per weight file; never fontWeight). */
export function typeStyle(role: TypeRole): TextStyle {
  const r = tokens.type[role];
  return {
    fontFamily: r.native,
    fontSize: r.size,
    lineHeight: r.lineHeight,
    letterSpacing: r.letterSpacing,
    textTransform: r.transform,
  };
}

/** Shadow for an elevation level (0 to 3) in the current mode. */
export function elevation(mode: ColorMode, level: 0 | 1 | 2 | 3) {
  return tokens.elevation[mode][level].native;
}

export const fonts = {
  strong: tokens.strongWeight.native,
  mono: tokens.fontFamily.mono.native[400],
  monoMedium: tokens.fontFamily.mono.native[500],
  textMedium: tokens.fontFamily.text.native[500],
};

/** Lucide icon props from the tokens: stroke 1.75, absolute, at the role's size. */
export function iconProps(sizeRole: keyof typeof tokens.icon.size, color: string) {
  return { size: tokens.icon.size[sizeRole], color, strokeWidth: tokens.icon.stroke, absoluteStrokeWidth: tokens.icon.absoluteStrokeWidth };
}

export function easing(name: keyof typeof tokens.motion.easing) {
  return tokens.motion.easing[name] as unknown as [number, number, number, number];
}
