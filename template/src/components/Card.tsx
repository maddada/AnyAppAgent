import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, spacing, useColors } from '@/theme';

/** A plain surface with a hairline border. No shadows, no gradients. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md + 4,
    gap: spacing.sm,
  },
});
