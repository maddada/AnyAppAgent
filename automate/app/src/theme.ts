// The app's look in one place: colours (light and dark), type, spacing and radii.
// Screens use these tokens instead of hard-coded values so dark mode and redesigns stay easy.
// To give an app its own character, change `accent` (and maybe `background`) here first.
import { useColorScheme } from 'react-native';

const light = {
  /** Screen background: warm paper. */
  background: '#F3EFE7',
  /** Cards, sheets, inputs. */
  surface: '#FBF9F4',
  /** Pressed rows, chips, secondary buttons, icon wells. */
  surfaceMuted: '#EAE5DA',
  /** Hairlines and outlines. */
  border: '#DAD3C5',
  /** Main text: graphite. */
  text: '#1E2023',
  /** Secondary text. */
  textMuted: '#57554F',
  /** Hints, captions, disabled text. */
  textFaint: '#8B877E',
  /** The one accent colour: bottle green. Use it sparingly. */
  accent: '#1D6A4A',
  /** Text and icons on top of `accent`. */
  onAccent: '#FFFFFF',
  /** A pale tint of the accent for selected rows and badges. */
  accentSoft: '#DDEAE2',
  success: '#1D6A4A',
  warning: '#9A5B00',
  danger: '#B3362C',
};

const dark: typeof light = {
  background: '#131412',
  surface: '#1B1D1A',
  surfaceMuted: '#252823',
  border: '#31342E',
  text: '#ECE8DF',
  textMuted: '#A9A59B',
  textFaint: '#77736B',
  accent: '#6FBF94',
  onAccent: '#0D1510',
  accentSoft: '#1B2A21',
  success: '#6FBF94',
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
  /** Code and times in the run log. */
  mono: { fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
};

/** The current palette (follows the phone's light/dark setting). */
export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
