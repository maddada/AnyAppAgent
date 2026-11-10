// App root: navigation, theme and one-time setup. Add screens to `RootStack` below.
import { DarkTheme, DefaultTheme, createStaticNavigation, type StaticParamList } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { setupNotifications } from '@/lib/notifications';
import { HomeScreen } from '@/screens/HomeScreen';
import { useColors, useIsDark } from '@/theme';

const RootStack = createNativeStackNavigator({
  screens: {
    Home: { screen: HomeScreen, options: { headerShown: false } },
    // Settings: { screen: SettingsScreen, options: { title: 'Settings' } },
  },
});

export type RootStackParamList = StaticParamList<typeof RootStack>;

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

const Navigation = createStaticNavigation(RootStack);

export default function App() {
  const isDark = useIsDark();
  const colors = useColors();
  const base = isDark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };

  useEffect(() => {
    setupNotifications();
  }, []);

  return (
    <SafeAreaProvider>
      <Navigation theme={theme} />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
