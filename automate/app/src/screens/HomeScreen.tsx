// Automate's first screen: the automations, Stop all, today's prayer times in Ajman, and
// the way to make a new automation (Change this app: the one place to type).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useEffect } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { openChange } from '../../modules/updates';
import { APP_NAME } from '@/automate/brand';
import { ajmanClock, ajmanDay, PRAYER_KEYS, PRAYER_LABEL, prayerTimesFor } from '@/automate/prayer';
import { addLog, getLog } from '@/automate/store';
import { cancelPretend, resumeEverything, statusOf, stopEverything, sync, useAutomate } from '@/automate/runtime';
import { Label, StatusPill, useNow, when } from '@/components/Bits';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { radius, spacing, type, useColors } from '@/theme';

export function HomeScreen() {
  const colors = useColors();
  const navigation = useNavigation();
  const { list, state, log, stopped } = useAutomate();
  const tick = useNow(state.pretend ? 1000 : 30_000);

  useEffect(() => {
    void sync();
  }, []);
  // Stop all pressed in a notification while the app was closed: put it in the log too.
  useEffect(() => {
    if (stopped && getLog()[0]?.kind !== 'stop') void addLog({ kind: 'stop', title: 'Stop all', lines: ['From a notification', 'Nothing runs until you resume'] });
  }, [stopped]);

  const times = prayerTimesFor(ajmanDay(tick));
  const nextPrayer = PRAYER_KEYS.find((k) => times[k] > tick);

  const confirmStop = () =>
    Alert.alert('Stop all automations?', 'Nothing runs until you resume. Do Not Disturb that this app turned on goes off now.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop all', style: 'destructive', onPress: () => void stopEverything() },
    ]);

  const lastRun = (id: string) => log.find((e) => e.automation === id && (e.kind === 'ran' || e.kind === 'error' || e.kind === 'stop'));

  return (
    <Screen>
      <View style={styles.top}>
        <View style={styles.grow}>
          <Text style={[type.label, { color: colors.accent }]}>{APP_NAME.toUpperCase()}</Text>
          <Text style={[type.title, { color: colors.text }]}>Automations</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" testID="open-settings" onPress={() => navigation.navigate('Settings')} hitSlop={12} style={styles.iconButton}>
          <MaterialCommunityIcons name="cog-outline" size={24} color={colors.textMuted} />
        </Pressable>
      </View>

      {stopped ? (
        <Card style={{ borderColor: colors.danger, marginTop: spacing.md }}>
          <Text style={[type.bodyStrong, { color: colors.danger }]}>Everything is stopped</Text>
          <Text style={[type.small, { color: colors.textMuted }]}>No automation runs until you resume.</Text>
          <Button title="Resume" variant="secondary" onPress={() => void resumeEverything()} />
        </Card>
      ) : null}

      {state.pretend ? (
        <Card style={{ borderColor: colors.accent, marginTop: spacing.md }}>
          <Text style={[type.bodyStrong, { color: colors.accent }]}>Pretend clock</Text>
          <Text style={[type.small, type.numeric, { color: colors.textMuted }]}>
            {`For ${list.find((l) => l.id === state.pretend?.automation)?.name ?? 'an automation'} it is ${ajmanClock(tick + state.pretend.offset)} in Ajman. It runs in ${Math.max(0, Math.round((state.pretend.due - state.pretend.offset - tick) / 1000))} s.`}
          </Text>
          <Button title="Cancel the test" variant="secondary" onPress={() => void cancelPretend()} />
        </Card>
      ) : null}

      <View style={[styles.times, { borderColor: colors.border }]}>
        {PRAYER_KEYS.filter((k) => k !== 'sunrise').map((k) => (
          <View key={k} style={styles.time}>
            <Text style={[type.small, { color: k === nextPrayer ? colors.accent : colors.textFaint }]}>{PRAYER_LABEL[k]}</Text>
            <Text style={[type.bodyStrong, type.numeric, { color: k === nextPrayer ? colors.accent : colors.text }]}>{ajmanClock(times[k])}</Text>
          </View>
        ))}
      </View>
      <Text style={[type.small, { color: colors.textFaint }]}>Today in Ajman</Text>

      <Label>Your automations</Label>
      {list.length === 0 ? (
        <Card>
          <Text style={[type.bodyStrong, { color: colors.text }]}>No automations yet</Text>
          <Text style={[type.small, { color: colors.textMuted }]}>
            {'Say what should happen and when, in plain words. For example: "At Maghrib, turn on Do Not Disturb for 20 minutes and say Maghrib time."'}
          </Text>
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {list.map((l) => {
            const status = statusOf(l, state);
            const last = lastRun(l.id);
            return (
              <Pressable
                key={l.id}
                accessibilityRole="button"
                testID={`automation-${l.id}`}
                onPress={() => navigation.navigate('Automation', { id: l.id })}
                style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: status === 'new' || status === 'changed' ? colors.warning : colors.border }]}
              >
                <View style={styles.itemTop}>
                  <Text style={[type.heading, styles.grow, { color: colors.text }]}>{l.name}</Text>
                  <StatusPill status={status} />
                </View>
                <Text style={[type.small, { color: colors.textMuted }]}>{l.error ?? l.when.join(' · ')}</Text>
                <Text style={[type.small, { color: colors.textFaint }]}>
                  {last ? `${last.kind === 'ran' ? 'Ran' : last.kind === 'stop' ? 'Stopped' : 'Failed'} ${when(last.at)}${last.test ? ' (test)' : ''}` : 'Never ran'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.actions}>
        <Button title="New automation" onPress={() => openChange('home')} />
        <Text style={[type.small, { color: colors.textFaint }]}>
          You type it in Change this app. The agent writes the automation, and you check its card here before it runs.
        </Text>
        <View style={styles.pair}>
          <Button title="Run log" variant="secondary" style={styles.grow} onPress={() => navigation.navigate('RunLog')} />
          <Button title="Stop all" variant="danger" style={styles.grow} disabled={stopped} onPress={confirmStop} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  grow: { flex: 1 },
  iconButton: { padding: spacing.xs, marginBottom: spacing.xs },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.xs,
  },
  time: { alignItems: 'center', gap: 2 },
  item: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md + 4, gap: spacing.xs },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  pair: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
