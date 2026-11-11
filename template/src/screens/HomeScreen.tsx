import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { radius, spacing, type, useColors } from '@/theme';

const appName = Constants.expoConfig?.name ?? 'My App';
const version = Constants.expoConfig?.version ?? '1.0.0';

const steps = [
  { title: 'Describe it', text: 'Tell AnyAppAgent what this app should do, in your own words.' },
  { title: 'It gets built', text: 'Your PC makes the new version while you wait.' },
  { title: 'It updates here', text: 'The new version installs over this one. Nothing to set up.' },
];

/** The starter screen. Replace it with the app's real first screen. */
export function HomeScreen() {
  const colors = useColors();
  const navigation = useNavigation();
  return (
    <Screen style={styles.page}>
      <Image source={require('../../assets/icon.png')} style={[styles.icon, { borderColor: colors.border }]} />

      <Text style={[type.display, styles.name, { color: colors.text }]}>{appName}</Text>
      <Text style={[type.body, { color: colors.textMuted }]}>Ready for its first idea.</Text>

      <Text style={[type.label, styles.section, { color: colors.textFaint }]}>WHAT HAPPENS NEXT</Text>
      <View style={[styles.list, { borderColor: colors.border }]}>
        {steps.map((s, i) => (
          <View
            key={s.title}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}
          >
            <Text style={[type.bodyStrong, type.numeric, styles.number, { color: colors.accent }]}>{i + 1}</Text>
            <View style={styles.rowText}>
              <Text style={[type.bodyStrong, { color: colors.text }]}>{s.title}</Text>
              <Text style={[type.small, { color: colors.textMuted }]}>{s.text}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.spacer} />
      <Pressable accessibilityRole="button" testID="open-settings" onPress={() => navigation.navigate('Settings')} style={styles.settings}>
        <Text style={[type.bodyStrong, { color: colors.accent }]}>Settings</Text>
      </Pressable>
      <Text style={[type.small, type.numeric, { color: colors.textFaint }]}>Version {version}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  name: { marginBottom: spacing.sm },
  section: { marginTop: spacing.xxl + spacing.md, marginBottom: spacing.sm },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md + 2 },
  number: { width: 20 },
  rowText: { flex: 1, gap: 2 },
  spacer: { flex: 1, minHeight: spacing.xxl },
  settings: { paddingVertical: spacing.md, marginBottom: spacing.sm, alignSelf: 'flex-start' },
});
