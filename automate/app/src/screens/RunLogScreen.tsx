// The run log: everything that ran, failed, was blocked by a safety lock, changed, or was stopped.
import { StyleSheet, Text, View } from 'react-native';

import type { LogEntry } from '@/automate/store';
import { useAutomate } from '@/automate/runtime';
import { when } from '@/components/Bits';
import { Screen } from '@/components/Screen';
import { spacing, type, useColors, type Colors } from '@/theme';

function tone(kind: LogEntry['kind'], colors: Colors) {
  if (kind === 'ran' || kind === 'on' || kind === 'resume') return colors.accent;
  if (kind === 'error' || kind === 'stop' || kind === 'blocked' || kind === 'locks') return colors.danger;
  if (kind === 'changed' || kind === 'pretend' || kind === 'asked') return colors.warning;
  return colors.textFaint;
}

export function RunLogScreen() {
  const colors = useColors();
  const { log } = useAutomate();
  return (
    <Screen>
      <Text style={[type.title, { color: colors.text }]}>Run log</Text>
      <Text style={[type.small, styles.sub, { color: colors.textMuted }]}>What ran, when and why. It stays on this phone.</Text>
      {log.length === 0 ? <Text style={[type.body, { color: colors.textMuted }]}>Nothing yet.</Text> : null}
      {log.map((e, i) => (
        <View key={e.id} testID={`log-${i}`} style={[styles.entry, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}>
          <View style={[styles.bar, { backgroundColor: tone(e.kind, colors) }]} />
          <View style={styles.grow}>
            <Text style={[type.small, type.numeric, { color: colors.textFaint }]}>
              {when(e.at)}
              {e.test ? '  ·  test' : ''}
              {e.count && e.count > 1 ? `  ·  ${e.count} times` : ''}
            </Text>
            <Text style={[type.bodyStrong, { color: colors.text }]}>{e.title}</Text>
            {(e.lines ?? []).map((x, j) => (
              <Text key={j} style={[type.small, { color: colors.textMuted }]}>{x}</Text>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { marginBottom: spacing.md },
  entry: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  bar: { width: 3, borderRadius: 2 },
  grow: { flex: 1, gap: 2 },
});
