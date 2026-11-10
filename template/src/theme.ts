// The app's look in one place: colours (light and dark), type, spacing and radii.
// Screens use these tokens instead of hard-coded values so dark mode and redesigns stay easy.
// To give an app its own character, change `accent` (and maybe `background`) here first.
import { useColorScheme } from 'react-native';

const light = {
  /** Screen background: a quiet, slightly warm neutral. */
  background: '#F5F5F2',
  /** Cards, sheets, inputs. */
  surface: '#FFFFFF',
  /** Pressed rows, chips, secondary buttons, icon wells. */
  surfaceMuted: '#ECECE8',
  /** Hairlines and outlines. */
  border: '#DFDFDA',
  /** Main text. */
  text: '#18191B',
  /** Secondary text. */
  textMuted: '#5E6167',
  /** Hints, captions, disabled text. */
  textFaint: '#8D9096',
  /** The one accent colour: primary buttons, links, selected states. Use it sparingly. */
  accent: '#2C4F9E',
  /** Text and icons on top of `accent`. */
  onAccent: '#FFFFFF',
  /** A pale tint of the accent for selected rows and badges. */
  accentSoft: '#E6EBF5',
  success: '#1F7A4D',
  warning: '#A86400',
  danger: '#C2362F',
};

const dark: typeof light = {
  background: '#111214',
  surface: '#1A1B1E',
  surfaceMuted: '#232428',
  border: '#2D2E33',
  text: '#ECECEA',
  textMuted: '#A2A5AB',
  textFaint: '#6F7278',
  accent: '#8DA8E8',
  onAccent: '#0F1114',
  accentSoft: '#1D2433',
  success: '#55C08A',
  warning: '#E0A443',
  danger: '#EE7A72',
};

export type Colors = typeof light;

/** Spacing scale (dp). Prefer these to one-off numbers. */
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64 } as const;

export const radius = { sm: 6, md: 12, lg: 18, pill: 999 } as const;

/**
 * Type scale (system font: Roboto on Android). Weights and tracking do the work:
 * one large title per screen, then headings, body and small labels.
 */
export const type = {
  display: { fontSize: 40, lineHeight: 46, fontWeight: '700' as const, letterSpacing: -1 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  /** Uppercase section labels: pair with `textTransform: 'uppercase'`. */
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 1.2 },
  /** Numbers that line up (times, counters). */
  numeric: { fontVariant: ['tabular-nums' as const] },
};

/** The current palette (follows the phone's light/dark setting). */
export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
