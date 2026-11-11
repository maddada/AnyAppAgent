// "Change this app" (AnyAppAgent docs/CHANGE-THIS-APP.md): the "This app" group every app has in its
// settings. Built in: keep it in the app's Settings screen (or wherever its settings live).
// The row opens AnyAppAgent at this app: the person who made the app lands in its chat; anyone else
// can suggest a change or make their own version. Without AnyAppAgent it explains, in the app.
// It hides itself on other people's phones when the owner switched "Show Change this app to
// others" off in AnyAppAgent.
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { changeOwner, changeVisible, openChange } from '../../modules/updates';
import { spacing, type, useColors } from '@/theme';

const version = Constants.expoConfig?.version ?? '';

/** The "Change this app" row alone, for a settings list of the app's own design. */
export function ChangeThisAppRow({ screen = 'settings' }: { screen?: string }) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let live = true;
    changeVisible()
      .then((v) => live && setVisible(v))
      .catch(() => live && setVisible(false));
    return () => {
      live = false;
    };
  }, []);
  if (!visible) return null;
  return (
    <Pressable
      accessibilityRole="button"
      testID="change-this-app"
      onPress={() => openChange(screen)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' }]}
    >
      <View style={styles.grow}>
        <Text style={[type.bodyStrong, { color: colors.text }]}>Change this app</Text>
        <Text style={[type.small, { color: colors.textMuted }]}>Ask for a change in plain words</Text>
      </View>
      <Text style={[type.heading, { color: colors.textFaint }]}>{'›'}</Text>
    </Pressable>
  );
}

/** The whole "This app" group: Change this app, the version, and who made it. */
export function ThisAppSection({ screen = 'settings' }: { screen?: string }) {
  const colors = useColors();
  const owner = safeOwner();
  return (
    <View style={styles.section}>
      <Text style={[type.label, styles.heading, { color: colors.textFaint }]}>THIS APP</Text>
      <View style={[styles.list, { borderColor: colors.border }]}>
        <ChangeThisAppRow screen={screen} />
        <View style={[styles.row, styles.line, { borderColor: colors.border }]}>
          <Text style={[type.body, styles.grow, { color: colors.text }]}>Version</Text>
          <Text style={[type.small, type.numeric, { color: colors.textMuted }]}>{version}</Text>
        </View>
        <View style={[styles.row, styles.line, { borderColor: colors.border }]}>
          <Text style={[type.body, styles.grow, { color: colors.text }]}>{owner ? `Made by ${owner}` : 'Made'}</Text>
          <Text style={[type.small, { color: colors.textMuted }]}>with AnyAppAgent</Text>
        </View>
      </View>
    </View>
  );
}

function safeOwner(): string {
  try {
    return changeOwner();
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl },
  heading: { marginBottom: spacing.sm },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 56 },
  line: { borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, gap: 2 },
});
