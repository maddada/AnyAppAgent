// App root: navigation, theme and one-time setup. Add screens to `RootStack` below.
// Automate: the automation runtime lives in src/automate (see AGENTS.md, "Automations").
import { DarkTheme, DefaultTheme, createNavigationContainerRef, createStaticNavigation, type StaticParamList } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CrashBoundary } from '@/components/CrashBoundary';
import { installCrashCatcher, setCurrentScreen } from '@/lib/crash';
import { setupNotifications } from '@/lib/notifications';
import { AutomationScreen } from '@/screens/AutomationScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { PlacesScreen } from '@/screens/PlacesScreen';
import { RunLogScreen } from '@/screens/RunLogScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { useColors, useIsDark } from '@/theme';

const RootStack = createNativeStackNavigator({
  screens: {
    Home: { screen: HomeScreen, options: { headerShown: false } },
    // The card of one automation (check it, turn it on, test it).
    Automation: { screen: AutomationScreen, options: { title: '' } },
    RunLog: { screen: RunLogScreen, options: { title: '' } },
    Places: { screen: PlacesScreen, options: { title: '' } },
    // Every app keeps a Settings screen with the "This app" group (Change this app): see AGENTS.md.
    Settings: { screen: SettingsScreen, options: { headerShown: false } },
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
const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Crashes reach Kiwimake, which offers the person a fix (src/lib/crash.ts). Keep this first.
installCrashCatcher();

export default function App() {
  const isDark = useIsDark();
  const colors = useColors();
  const base = isDark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
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
      <CrashBoundary>
        <Navigation
          ref={navigationRef}
          theme={theme}
          onStateChange={() => setCurrentScreen(navigationRef.getCurrentRoute()?.name)}
        />
      </CrashBoundary>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
