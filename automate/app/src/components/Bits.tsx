// Small shared pieces of Appwin Automate's screens: section labels, status pills, plain rows.
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { Status } from '@/automate/runtime';
import { radius, spacing, type, useColors } from '@/theme';

export function Label({ children, style }: { children: string; style?: ViewStyle }) {
  const colors = useColors();
  return <Text style={[type.label, styles.label, { color: colors.textFaint }, style]}>{children.toUpperCase()}</Text>;
}

const STATUS_TEXT: Record<Status, string> = {
  on: 'On',
  off: 'Off',
  new: 'Check it',
  changed: 'Changed: check it',
  broken: 'Problem',
};

export function StatusPill({ status }: { status: Status }) {
  const colors = useColors();
  const tone =
    status === 'on'
      ? { bg: colors.accentSoft, fg: colors.accent }
      : status === 'off'
        ? { bg: colors.surfaceMuted, fg: colors.textMuted }
        : status === 'broken'
          ? { bg: colors.surfaceMuted, fg: colors.danger }
          : { bg: colors.surfaceMuted, fg: colors.warning };
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[type.label, { color: tone.fg, letterSpacing: 0.4 }]}>{STATUS_TEXT[status]}</Text>
    </View>
  );
}

/** A hairline list of rows. */
export function List({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[styles.list, { borderColor: colors.border }]}>{children}</View>;
}

export function Row({
  title,
  detail,
  right,
  onPress,
  first,
  testID,
  tone,
}: {
  title: string;
  detail?: string;
  right?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  testID?: string;
  tone?: 'danger' | 'accent';
}) {
  const colors = useColors();
  const color = tone === 'danger' ? colors.danger : tone === 'accent' ? colors.accent : colors.text;
  const body = (
    <>
      <View style={styles.grow}>
        <Text style={[type.bodyStrong, { color }]}>{title}</Text>
        {detail ? <Text style={[type.small, { color: colors.textMuted }]}>{detail}</Text> : null}
      </View>
      {right}
    </>
  );
  const rowStyle = [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }];
  if (!onPress) return <View style={rowStyle}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      {body}
    </Pressable>
  );
}

/** "17:32" or "Tue 17:32" or "12 Nov 17:32". */
export function when(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `today ${hm}`;
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${hm}`;
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${hm}`;
}

const styles = StyleSheet.create({
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 3, alignSelf: 'flex-start' },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 56 },
  grow: { flex: 1, gap: 2 },
});

/** The time now, refreshed every `everyMs`. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
