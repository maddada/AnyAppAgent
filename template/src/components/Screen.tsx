import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, useColors } from '@/theme';

type Props = {
  children: ReactNode;
  /** false for screens that manage their own scrolling (e.g. a FlatList). */
  scroll?: boolean;
  style?: ViewStyle;
};

/** A full screen with the app background, safe-area padding and (by default) scrolling. */
export function Screen({ children, scroll = true, style }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const padding: ViewStyle = {
    paddingTop: insets.top + spacing.md,
    paddingBottom: insets.bottom + spacing.lg,
    paddingHorizontal: spacing.lg,
  };
  if (!scroll) {
    return <View style={[styles.fill, { backgroundColor: colors.background }, padding, style]}>{children}</View>;
  }
  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: colors.background }]}
      contentContainerStyle={[padding, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
