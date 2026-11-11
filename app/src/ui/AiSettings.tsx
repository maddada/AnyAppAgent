// "AI for your apps" in Settings: one field for the AI key (Claude or OpenRouter), the model,
// a test, and one row per app with its usage and an on/off switch. The key is stored by the
// native side (modules/anyapp-ai, encrypted with the Android Keystore) and never read back here.
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, Switch, View } from "react-native";
import { AppWindow, Cpu, FlaskConical, KeyRound } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { AnyAppAi, type AiAppUsage, type AiConfig, type AiProvider, type AiTestResult } from "anyapp-ai";
import { Button } from "./Button";
import { Field } from "./Field";
import { Sheet } from "./Sheet";
import { StateLine } from "./StateLine";
import { T } from "./Text";
import { border, radius, size, space, useTheme } from "./theme";

type RowProps = {
  icon: LucideIcon;
  label: string;
  sub?: string;
  value?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
};

const NAMES: Record<AiProvider, string> = { anthropic: "Claude", openrouter: "OpenRouter" };

export function AiSettingsGroup({
  Group,
  Row,
  Divider,
}: {
  Group: (p: { title: string; children: React.ReactNode }) => React.ReactNode;
  Row: (p: RowProps) => React.ReactNode;
  Divider: () => React.ReactNode;
}) {
  const t = useTheme();
  const [cfg, setCfg] = useState<AiConfig | null>(() => AnyAppAi?.getConfig() ?? null);
  const [apps, setApps] = useState<AiAppUsage[]>(() => AnyAppAi?.apps() ?? []);
  const [key, setKey] = useState("");
  const [picked, setPicked] = useState<AiProvider | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = useCallback(() => {
    setCfg(AnyAppAi?.getConfig() ?? null);
    setApps(AnyAppAi?.apps() ?? []);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    const timer = setInterval(refresh, 5000); // usage changes while apps run
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  if (!AnyAppAi) return null;
  const ai = AnyAppAi;
  const detected = key.trim() ? ai.detectProvider(key.trim()) : null;
  const provider = picked ?? detected;

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await ai.test());
    } finally {
      setTesting(false);
      refresh();
    }
  };

  const save = async () => {
    setProblem(null);
    if (!provider) {
      setProblem("Choose Claude or OpenRouter.");
      return;
    }
    try {
      ai.save(key.trim(), provider, null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That key could not be saved.");
      return;
    }
    setKey("");
    setPicked(null);
    refresh();
    await test();
  };

  return (
    <Group title="AI for your apps">
      {cfg ? (
        <>
          <Row
            testID="ai-key-row"
            icon={KeyRound}
            label={`${NAMES[cfg.provider]} key`}
            sub={`Ends in ${cfg.hint}. Apps you make here can use it; the key stays in AnyAppAgent.`}
            trailing={<Button testID="ai-remove" label="Remove" small variant="quiet" onPress={() => setConfirmRemove(true)} />}
          />
          <Divider />
          <Row
            testID="ai-model"
            icon={Cpu}
            label="Model"
            value={cfg.model}
            onPress={() => {
              setModel(cfg.model);
              setModelOpen(true);
            }}
          />
          <Divider />
          <Row
            icon={FlaskConical}
            label="Test the key"
            sub={
              result && !result.ok
                ? result.message
                : cfg.testServer
                  ? "Using the local test server (development)."
                  : undefined
            }
            trailing={
              testing ? (
                <StateLine kind="working" label="Testing" />
              ) : result?.ok ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <StateLine testID="ai-test-ok" kind="ready" label="Works" />
                  <Button testID="ai-test" label="Test" small variant="quiet" onPress={test} />
                </View>
              ) : result ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <StateLine kind="problem" label="Failed" />
                  <Button testID="ai-test" label="Test" small variant="quiet" onPress={test} />
                </View>
              ) : (
                <Button testID="ai-test" label="Test" small variant="quiet" onPress={test} />
              )
            }
          />
          {apps.map((a) => (
            <View key={a.packageName}>
              <Divider />
              <Row
                testID={`ai-app-${a.packageName}`}
                icon={AppWindow}
                label={a.label}
                sub={usageLine(a)}
                trailing={
                  <Switch
                    testID={`ai-app-switch-${a.packageName}`}
                    accessibilityLabel={`AI for ${a.label}`}
                    value={a.enabled}
                    onValueChange={(on) => {
                      ai.setAppEnabled(a.packageName, on);
                      refresh();
                    }}
                    trackColor={{ false: t.borderStrong, true: t.accent }}
                    thumbColor={t.dark ? t.text : t.surface}
                  />
                }
              />
            </View>
          ))}
          {apps.length === 0 ? (
            <>
              <Divider />
              <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
                <T variant="caption" color="textSecondary">
                  No app has used AI yet. Ask for an AI feature in the chat of one of your apps and it shows up here, with an on/off switch.
                </T>
              </View>
            </>
          ) : null}
        </>
      ) : (
        <View style={{ padding: space.lg, gap: space.md }}>
          <T variant="callout" color="textSecondary">
            Paste a Claude or OpenRouter key and the apps you make here can use AI. The key stays in AnyAppAgent; apps never see it.
          </T>
          <Field
            testID="ai-key-field"
            value={key}
            onChangeText={(v) => {
              setKey(v);
              setProblem(null);
              setPicked(null);
            }}
            placeholder="AI key (sk-ant-... or sk-or-...)"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            problem={problem}
            onSubmitEditing={() => key.trim() && void save()}
          />
          {key.trim() ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
              <T variant="label" color="textSecondary">
                {detected ? "Key from" : "Which is it?"}
              </T>
              {(["anthropic", "openrouter"] as AiProvider[]).map((p) => (
                <Choice key={p} testID={`ai-provider-${p}`} label={NAMES[p]} on={provider === p} onPress={() => setPicked(p)} />
              ))}
            </View>
          ) : null}
          <Button testID="ai-save" label="Save and test" small disabled={!key.trim()} onPress={() => void save()} style={{ alignSelf: "flex-start" }} />
        </View>
      )}

      <Sheet visible={modelOpen} onClose={() => setModelOpen(false)}>
        <T variant="titleSmall">Model</T>
        <T variant="callout" color="textSecondary" style={{ marginTop: space.sm }}>
          Which {cfg ? NAMES[cfg.provider] : ""} model your apps use. The default is {cfg?.defaultModel}.
        </T>
        <Field
          testID="ai-model-field"
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={{ marginTop: space.lg }}
        />
        <View style={{ gap: space.sm, marginTop: space["2xl"] }}>
          <Button
            testID="ai-model-save"
            label="Use this model"
            disabled={!model.trim()}
            onPress={() => {
              ai.setModel(model.trim());
              setModelOpen(false);
              setResult(null);
              refresh();
            }}
          />
          <Button
            label="Back to the default"
            variant="quiet"
            onPress={() => {
              ai.setModel(null);
              setModelOpen(false);
              setResult(null);
              refresh();
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={confirmRemove} onClose={() => setConfirmRemove(false)}>
        <T variant="titleSmall">Remove the AI key?</T>
        <T variant="callout" color="textSecondary" style={{ marginTop: space.sm }}>
          Your apps stop using AI until you add a key again. Nothing else changes.
        </T>
        <View style={{ gap: space.sm, marginTop: space["2xl"] }}>
          <Button
            testID="ai-confirm-remove"
            label="Remove"
            variant="problem"
            onPress={() => {
              ai.remove();
              setConfirmRemove(false);
              setResult(null);
              refresh();
            }}
          />
          <Button label="Keep it" variant="quiet" onPress={() => setConfirmRemove(false)} />
        </View>
      </Sheet>
    </Group>
  );
}

function Choice({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: space.md,
        minHeight: size.buttonHeightSmall,
        justifyContent: "center",
        borderRadius: radius.field,
        borderWidth: on ? border.focusWidth : border.width,
        borderColor: on ? t.accent : t.border,
        backgroundColor: pressed ? t.selectedBg : on ? t.selectedBg : "transparent",
      })}
    >
      <T variant="label" style={{ color: on ? t.text : t.textSecondary }}>
        {label}
      </T>
    </Pressable>
  );
}

function usageLine(a: AiAppUsage): string {
  if (!a.enabled) return a.refused > 0 ? `Switched off. ${a.refused} ${a.refused === 1 ? "try" : "tries"} stopped.` : "Switched off.";
  if (a.calls === 0) return "Not used yet.";
  const tokens = a.inputTokens + a.outputTokens;
  return `${a.calls} ${a.calls === 1 ? "call" : "calls"}, ${short(tokens)} tokens`;
}

function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
