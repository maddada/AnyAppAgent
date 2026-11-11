import { StyleSheet, Text } from 'react-native';

import { ThisAppSection } from '@/components/ChangeThisApp';
import { Screen } from '@/components/Screen';
import { spacing, type, useColors } from '@/theme';

/** Settings. Put the app's own settings above "This app", which stays last (see AGENTS.md). */
export function SettingsScreen() {
  const colors = useColors();
  return (
    <Screen>
      <Text style={[type.title, styles.title, { color: colors.text }]}>Settings</Text>
      <ThisAppSection />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.sm },
});
