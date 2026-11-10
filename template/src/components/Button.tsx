import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { radius, spacing, type, useColors } from '@/theme';

type Props = {
  title: string;
  onPress: () => void;
  /** primary: the one main action on a screen. secondary: everything else. */
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
};

/** A large, calm button with a light haptic tap. */
export function Button({ title, onPress, variant = 'primary', disabled, style }: Props) {
  const colors = useColors();
  const bg = variant === 'primary' ? colors.accent : variant === 'danger' ? colors.danger : colors.surfaceMuted;
  const fg = variant === 'secondary' ? colors.text : colors.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <Text style={[type.bodyStrong, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
