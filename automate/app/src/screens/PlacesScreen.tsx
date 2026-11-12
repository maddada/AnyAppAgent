// Places: where arrive() and leave() look up a place by its name. Saved on this phone only.
import * as Location from 'expo-location';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { plan, useAutomate } from '@/automate/runtime';
import { update } from '@/automate/store';
import { Label, List, Row } from '@/components/Bits';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { radius, spacing, type, useColors } from '@/theme';

export function PlacesScreen() {
  const colors = useColors();
  const { state } = useAutomate();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const places = state.places ?? [];

  const saveHere = async () => {
    const n = name.trim();
    if (!n) return setProblem('Give the place a name first, like Mosque or Work.');
    setBusy(true);
    setProblem('');
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) return setProblem('Location is needed to save where you are.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const id = n.toLowerCase();
      await update((s) => ({
        ...s,
        places: [...(s.places ?? []).filter((p) => p.id !== id), { id, name: n, lat: pos.coords.latitude, lon: pos.coords.longitude, radius: 150 }],
      }));
      setName('');
      await plan();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string, n: string) =>
    Alert.alert(`Remove ${n}?`, 'Automations that use it stop until you save it again.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await update((s) => ({ ...s, places: (s.places ?? []).filter((p) => p.id !== id) }));
          await plan();
        },
      },
    ]);

  return (
    <Screen>
      <Text style={[type.title, { color: colors.text }]}>Places</Text>
      <Text style={[type.small, styles.sub, { color: colors.textMuted }]}>
        Automations can start when you arrive at or leave one of these. They stay on this phone.
      </Text>

      <Label>Save where you are now</Label>
      <TextInput
        testID="place-name"
        value={name}
        onChangeText={setName}
        placeholder="Name, like Mosque"
        placeholderTextColor={colors.textFaint}
        style={[type.body, styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
      />
      {problem ? <Text style={[type.small, { color: colors.danger }]}>{problem}</Text> : null}
      <Button title={busy ? 'Finding where you are...' : 'Save this place'} disabled={busy} onPress={() => void saveHere()} style={styles.button} />

      <Label>Saved</Label>
      {places.length === 0 ? (
        <Text style={[type.body, { color: colors.textMuted }]}>No places yet.</Text>
      ) : (
        <List>
          {places.map((p, i) => (
            <Row
              key={p.id}
              first={i === 0}
              title={p.name}
              detail={`${p.lat.toFixed(4)}, ${p.lon.toFixed(4)} · within ${p.radius} m`}
              onPress={() => remove(p.id, p.name)}
              right={<Text style={[type.small, { color: colors.textFaint }]}>Remove</Text>}
            />
          ))}
        </List>
      )}
      <View style={styles.gap} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { marginBottom: spacing.sm },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  button: { marginTop: spacing.sm },
  gap: { height: spacing.xl },
});
