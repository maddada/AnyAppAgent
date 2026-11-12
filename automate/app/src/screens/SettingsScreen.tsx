import { Alert, StyleSheet, Switch, Text } from 'react-native';

import { NEED_LABEL } from '@/automate/card';
import { needReady, openPowerSettings, STRONG_POWERS } from '@/automate/needs';
import { setLocksOff, statusOf, useAutomate } from '@/automate/runtime';
import { Label, List, Row } from '@/components/Bits';
import { ThisAppSection } from '@/components/ChangeThisApp';
import { Screen } from '@/components/Screen';
import { spacing, type, useColors } from '@/theme';

/** Settings. Put the app's own settings above "This app", which stays last (see AGENTS.md). */
export function SettingsScreen() {
  const colors = useColors();
  const { state, list } = useAutomate();
  // Powers Android allows now, with the automations that are on and use them.
  const powers = STRONG_POWERS.filter(needReady).map((n) => ({
    need: n,
    users: list.filter((l) => statusOf(l, state) === 'on' && l.needs.includes(n)).map((l) => l.name),
  }));

  const toggle = (wantOff: boolean) => {
    if (!wantOff) {
      void setLocksOff(false);
      return;
    }
    Alert.alert(
      'Turn the safety locks off?',
      'Automations could then run as often as they like, send things from this phone without asking you, keep Do Not Disturb on for good, and turn on without a card. A wrong automation can do real harm. The run log and Stop all keep working.',
      [
        { text: 'Keep them on', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => void setLocksOff(true) },
      ],
    );
  };

  return (
    <Screen>
      <Text style={[type.title, styles.title, { color: colors.text }]}>Settings</Text>

      {powers.length ? (
        <>
          <Label>Powers</Label>
          <List>
            {powers.map((p, i) => (
              <Row
                key={p.need}
                first={i === 0}
                title={NEED_LABEL[p.need].title}
                detail={p.users.length ? `Used by ${p.users.join(', ')}` : 'No automation uses it now: you can switch it off'}
                tone={p.users.length ? undefined : 'accent'}
                testID={`power-${p.need}`}
                onPress={() => void openPowerSettings(p.need)}
                right={<Text style={[type.small, { color: colors.textFaint }]}>{p.users.length ? 'Open' : 'Switch off'}</Text>}
              />
            ))}
          </List>
        </>
      ) : null}

      <Label>Advanced</Label>
      <List>
        <Row
          first
          title="Safety locks"
          detail={
            state.locksOff
              ? 'Off: no hard limits, no asking before sending, no card before an automation turns on.'
              : 'On: hard limits, asking before anything is sent, and a card before any automation turns on.'
          }
          tone={state.locksOff ? 'danger' : undefined}
          testID="safety-locks"
          right={
            <Switch
              testID="safety-locks-switch"
              value={!state.locksOff}
              onValueChange={(on) => toggle(!on)}
              trackColor={{ true: colors.accent, false: colors.danger }}
            />
          }
        />
      </List>
      <Text style={[type.small, styles.note, { color: colors.textFaint }]}>
        For power users. Keep them on unless you know exactly what your automations do.
      </Text>

      <ThisAppSection />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.sm },
  note: { marginTop: spacing.sm },
});
