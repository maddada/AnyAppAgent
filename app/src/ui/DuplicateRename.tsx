// Duplicate and Rename (an app's options, next to Pin to top, Hide and Delete; shared/protocol.ts).
// Both are panels inside the app's sheet. Design rule (AGENTS.md): the words keep the full width;
// the buttons sit below them, on the right.
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import type { App } from "@/lib/protocol";
import { duplicateApp, renameApp } from "@/lib/manage";
import { Button } from "./Button";
import { Field } from "./Field";
import { T } from "./Text";
import { border, size, space, useTheme } from "./theme";

/** The name a duplicate gets by default: "Tea Timer 2", within the 50 characters a name may have. */
export function copyName(name: string): string {
  return `${name.slice(0, 48).trim()} 2`;
}

export function DuplicatePanel({ app, onDone, onCancel }: { app: App; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(() => copyName(app.name));
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = name.trim().length > 0 && name.trim().length <= 50;
  const run = async () => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      await duplicateApp(app, name, change);
      onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID="duplicate-panel">
      <T variant="heading">{`Duplicate ${app.name}`}</T>
      <T variant="callout" color="textSecondary" style={{ marginTop: space.xs, marginBottom: space.lg }}>
        {`A second, separate app next to ${app.name}. Changes to one never reach the other. What ${app.name} saved on this phone stays in it.`}
      </T>
      <Field testID="duplicate-name" label="Name" value={name} onChangeText={setName} maxLength={50} autoCapitalize="words" />
      <Field
        testID="duplicate-change"
        label="What should be different? (optional)"
        placeholder="Leave empty for an exact copy"
        value={change}
        onChangeText={setChange}
        multiline
        maxLength={4000}
        containerStyle={{ marginTop: space.lg }}
      />
      {problem ? (
        <T variant="callout" color="problem" style={{ marginTop: space.md }} testID="duplicate-problem">
          {problem}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.xl }}>
        <Button testID="duplicate-cancel" label="Cancel" variant="quiet" small onPress={onCancel} />
        <Button testID="duplicate-confirm" label="Duplicate" small busy={busy} disabled={!ready} onPress={run} />
      </View>
    </View>
  );
}

export function RenamePanel({ app, onDone, onCancel }: { app: App; onDone: () => void; onCancel: () => void }) {
  const t = useTheme();
  const [name, setName] = useState(app.name);
  const [newApp, setNewApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const clean = name.trim();
  const ready = clean.length > 0 && clean.length <= 50 && (clean !== app.name || newApp);
  const shared = !!app.sharing?.shared;
  const run = async () => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      await renameApp(app, clean, newApp);
      onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID="rename-panel">
      <T variant="heading">{`Rename ${app.name}`}</T>
      <T variant="callout" color="textSecondary" style={{ marginTop: space.xs, marginBottom: space.lg }}>
        The new name shows on your phone with the next version, in a few minutes. Its folder and GitHub repo get the new name too.
      </T>
      <Field testID="rename-name" label="New name" value={name} onChangeText={setName} maxLength={50} autoCapitalize="words" selectTextOnFocus />
      <Pressable
        testID="rename-new-app"
        accessibilityRole="switch"
        accessibilityState={{ checked: newApp, disabled: shared }}
        accessibilityLabel="Make it a new app"
        disabled={shared}
        onPress={() => setNewApp((v) => !v)}
        style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.rowHeight, paddingVertical: space.sm, marginTop: space.lg, borderTopWidth: border.width, borderColor: t.border }}
      >
        <View style={{ flex: 1, gap: space.hair }}>
          <T variant="label" color={shared ? "textTertiary" : "text"}>
            Make it a new app
          </T>
          <T variant="caption" color="textSecondary">
            {shared ? "Not while it's shared with others." : "Off: it stays the same app and keeps updating."}
          </T>
        </View>
        <Switch
          value={newApp}
          disabled={shared}
          onValueChange={setNewApp}
          trackColor={{ false: t.borderStrong, true: t.accent }}
          thumbColor={t.surfaceOverlay}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </Pressable>
      {newApp ? (
        <T variant="callout" color="textSecondary" testID="rename-new-app-help" style={{ marginTop: space.xs }}>
          {`Your phone gets it as a new app, next to the old one. The old ${app.name} stops getting updates, and what it saved stays in it. Good for a fresh start, for example before you share it with others.`}
        </T>
      ) : null}
      {problem ? (
        <T variant="callout" color="problem" style={{ marginTop: space.md }} testID="rename-problem">
          {problem}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.xl }}>
        <Button testID="rename-cancel" label="Cancel" variant="quiet" small onPress={onCancel} />
        <Button testID="rename-confirm" label={newApp ? "Make the new app" : "Rename"} small busy={busy} disabled={!ready} onPress={run} />
      </View>
    </View>
  );
}
