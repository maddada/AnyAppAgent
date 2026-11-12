// The card: what the person checks before an automation turns on (and again after it changes).
// "When" and "It will" come from the automation itself (its triggers, and the power calls the
// fence found in its code); "You asked for" is the agent's sentence, labelled as such.
import { useFocusEffect, useNavigation, type StaticScreenProps } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import * as Native from '../../modules/automate';
import { NEED_LABEL, type Need } from '@/automate/card';
import { LIMIT_LINES } from '@/automate/limits';
import { ajmanClock } from '@/automate/prayer';
import { approve, changesOf, pretendBefore, statusOf, tryNow, turnOff, useAutomate } from '@/automate/runtime';
import { nextOf } from '@/automate/triggers';
import { Label, List, Row, StatusPill, useNow, when } from '@/components/Bits';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { ensureNotificationPermission } from '@/lib/notifications';
import { radius, spacing, type, useColors } from '@/theme';

type Props = StaticScreenProps<{ id: string }>;

function needReady(n: Need): boolean {
  if (n === 'dnd') return Native.dnd.hasAccess();
  if (n === 'notifications') return Native.canNotify();
  return Native.canExact();
}

export function AutomationScreen({ route }: Props) {
  const colors = useColors();
  const navigation = useNavigation();
  const { list, state, log, stopped } = useAutomate();
  const [, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const now = useNow();
  const l = list.find((x) => x.id === route.params.id);

  // Back from Android's Settings: look at the permissions again.
  useFocusEffect(useCallback(() => setRefresh((n) => n + 1), []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setRefresh((n) => n + 1));
    return () => sub.remove();
  }, []);

  if (!l) {
    return (
      <Screen>
        <Text style={[type.title, { color: colors.text }]}>Not found</Text>
        <Text style={[type.body, { color: colors.textMuted }]}>This automation is no longer in the app.</Text>
      </Screen>
    );
  }

  const status = statusOf(l, state);
  const { added, removed } = status === 'changed' ? changesOf(l) : { added: [], removed: [] };
  const needs = l.needs.filter((n) => n !== 'exact' || !Native.canExact());
  const missing = l.needs.filter((n) => !needReady(n));
  const next = status === 'on' ? nextOf(l.triggers, now) : null;
  const runs = log.filter((e) => e.automation === l.id && ['ran', 'error', 'stop', 'blocked', 'skipped'].includes(e.kind)).slice(0, 3);

  const allow = async (n: Need) => {
    if (n === 'dnd') await Native.dnd.openSettings();
    if (n === 'notifications') await ensureNotificationPermission();
    setRefresh((x) => x + 1);
  };
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <StatusPill status={status} />
      <Text style={[type.title, styles.title, { color: colors.text }]}>{l.name}</Text>
      {status === 'changed' ? (
        <Text style={[type.small, { color: colors.warning }]}>This automation changed. It does not run until you check this version.</Text>
      ) : status === 'new' ? (
        <Text style={[type.small, { color: colors.textMuted }]}>Nothing runs until you turn it on.</Text>
      ) : null}
      {l.error ? <Text style={[type.body, { color: colors.danger }]}>{l.error}</Text> : null}

      <Label>When</Label>
      {l.when.map((w) => (
        <Text key={w} style={[type.body, { color: colors.text }]}>{w}</Text>
      ))}
      {next ? <Text style={[type.small, type.numeric, { color: colors.textFaint }]}>{`Next: ${when(next.due)} (${ajmanClock(next.due)} in Ajman)`}</Text> : null}

      <Label>It will</Label>
      <View style={styles.lines}>
        {l.lines.map((line) => {
          const isNew = added.includes(line);
          return (
            <View key={line} style={styles.lineRow}>
              <View style={[styles.dot, { backgroundColor: isNew ? colors.warning : colors.accent }]} />
              <Text style={[type.body, styles.grow, { color: colors.text }]}>
                {line}
                {isNew ? <Text style={[type.small, { color: colors.warning }]}>{'  new'}</Text> : null}
              </Text>
            </View>
          );
        })}
        {removed.map((line) => (
          <View key={`gone-${line}`} style={styles.lineRow}>
            <View style={[styles.dot, { backgroundColor: colors.textFaint }]} />
            <Text style={[type.body, styles.grow, styles.gone, { color: colors.textFaint }]}>{line}</Text>
          </View>
        ))}
        {l.lines.length === 0 ? <Text style={[type.small, { color: colors.textMuted }]}>Nothing that needs a power: it only keeps notes.</Text> : null}
      </View>
      <Text style={[type.small, { color: colors.textFaint }]}>Read from the automation itself.</Text>

      {l.says ? (
        <>
          <Label>You asked for</Label>
          <View style={[styles.quote, { borderColor: colors.border }]}>
            <Text style={[type.body, { color: colors.textMuted }]}>{l.says}</Text>
          </View>
        </>
      ) : null}

      {needs.length ? (
        <>
          <Label>It needs</Label>
          <List>
            {needs.map((n, i) => {
              const ok = needReady(n);
              return (
                <Row
                  key={n}
                  first={i === 0}
                  title={NEED_LABEL[n].title}
                  detail={NEED_LABEL[n].why}
                  testID={`need-${n}`}
                  onPress={ok ? undefined : () => void allow(n)}
                  right={<Text style={[type.bodyStrong, { color: ok ? colors.accent : colors.warning }]}>{ok ? 'Ready' : 'Allow'}</Text>}
                />
              );
            })}
          </List>
        </>
      ) : null}

      <Label>Hard limits</Label>
      {state.locksOff ? (
        <Text style={[type.small, { color: colors.danger }]}>The safety locks are off (Settings, Advanced). Nothing below applies.</Text>
      ) : null}
      {LIMIT_LINES.map((x) => (
        <Text key={x} style={[type.small, { color: state.locksOff ? colors.textFaint : colors.textMuted }]}>{x}</Text>
      ))}

      <View style={styles.actions}>
        {status === 'on' ? (
          <>
            <Button title="Try it now" variant="secondary" disabled={busy || stopped} onPress={run(() => tryNow(l.id))} />
            <Button
              title="Test with a pretend clock"
              variant="secondary"
              disabled={busy || stopped || !!state.pretend}
              onPress={run(async () => {
                await pretendBefore(l.id);
                navigation.goBack();
              })}
            />
            <Button title="Turn off" variant="secondary" disabled={busy} onPress={run(() => turnOff(l.id))} />
          </>
        ) : status !== 'broken' ? (
          <>
            <Button
              title={missing.length ? 'Allow what it needs first' : status === 'changed' ? 'Keep it on with this version' : 'Turn it on'}
              disabled={busy || missing.length > 0}
              onPress={run(async () => {
                await approve(l.id);
                navigation.goBack();
              })}
            />
            <Button title="Not now" variant="secondary" onPress={() => navigation.goBack()} />
          </>
        ) : null}
      </View>

      {runs.length ? (
        <>
          <Label>Last runs</Label>
          {runs.map((e) => (
            <View key={e.id} style={styles.run}>
              <Text style={[type.small, type.numeric, { color: colors.textFaint }]}>{when(e.at)}</Text>
              <Text style={[type.small, { color: e.kind === 'ran' ? colors.text : colors.danger }]}>{e.title}</Text>
              {(e.lines ?? []).map((x, i) => (
                <Text key={i} style={[type.small, { color: colors.textMuted }]}>{x}</Text>
              ))}
            </View>
          ))}
        </>
      ) : null}

      <Label>The automation</Label>
      <Button title={showCode ? 'Hide the script' : 'Show the script'} variant="secondary" onPress={() => setShowCode((v) => !v)} />
      {showCode ? (
        <View style={[styles.code, { backgroundColor: colors.surfaceMuted }]}>
          <Text selectable style={[type.mono, { color: colors.text }]}>{l.source}</Text>
        </View>
      ) : null}
      <Text style={[type.small, styles.foot, { color: colors.textFaint }]}>{`automations/${l.id}.ts · version ${l.hash.slice(0, 7)}`}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  grow: { flex: 1 },
  lines: { gap: spacing.sm, marginBottom: spacing.xs },
  lineRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  gone: { textDecorationLine: 'line-through' },
  quote: { borderLeftWidth: 3, paddingLeft: spacing.md, paddingVertical: spacing.xs },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  run: { marginBottom: spacing.sm, gap: 1 },
  code: { borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  foot: { marginTop: spacing.md },
});
