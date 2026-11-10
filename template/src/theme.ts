// Colours, spacing and type for the whole app. Change the palette here, not in each screen.
import { useColorScheme } from 'react-native';

const light = {
  background: '#F6F7FB',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF0F6',
  text: '#11131A',
  textMuted: '#5D6475',
  border: '#E3E6EE',
  primary: '#5B4BE5',
  primaryText: '#FFFFFF',
  accent: '#9333EA',
  success: '#12805C',
  danger: '#D93636',
};

const dark: typeof light = {
  background: '#0E1116',
  surface: '#171A21',
  surfaceMuted: '#20242D',
  text: '#F2F4F8',
  textMuted: '#9AA1B2',
  border: '#2A2F3A',
  primary: '#8B7FFF',
  primaryText: '#0E1116',
  accent: '#C084FC',
  success: '#3DD68C',
  danger: '#FF6B6B',
};

export type Colors = typeof light;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;
export const font = {
  title: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5 },
  heading: { fontSize: 20, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
};

/** The current palette (follows the phone's light/dark setting). */
export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
