import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { font, radius, spacing, useColors } from '@/theme';

const appName = Constants.expoConfig?.name ?? 'My App';

const steps = [
  { icon: 'message-text-outline', text: 'Tell AnyAppAgent what this app should do.' },
  { icon: 'hammer-wrench', text: 'Your PC builds it while you wait.' },
  { icon: 'cellphone-arrow-down', text: 'The new version installs over this one.' },
] as const;

export function HomeScreen() {
  const colors = useColors();
  return (
    <Screen>
      <LinearGradient
        colors={[colors.primary, colors.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <Image source={require('../../assets/icon.png')} style={styles.icon} />
        <Text style={styles.heroTitle}>{appName}</Text>
        <Text style={styles.heroSubtitle}>Your new app is ready.</Text>
      </LinearGradient>

      <Card style={styles.card}>
        <Text style={[font.heading, { color: colors.text }]}>What happens next</Text>
        {steps.map((s) => (
          <View key={s.icon} style={styles.step}>
            <View style={[styles.stepIcon, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name={s.icon} size={20} color={colors.primary} />
            </View>
            <Text style={[font.body, styles.stepText, { color: colors.textMuted }]}>{s.text}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.lg,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  icon: {
    width: 88,
    height: 88,
    borderRadius: 24,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  heroTitle: { ...font.title, color: '#FFFFFF', textAlign: 'center' },
  heroSubtitle: { ...font.body, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  card: { marginTop: spacing.lg },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  stepIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },
});
