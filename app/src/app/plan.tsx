// "Your plan" (docs/CLOUD.md section 2): credits left and the plan, the plans monthly or yearly,
// extra credit with or without a plan, and the Own key plan with the person's own Anthropic key.
// The person only ever sees credits and prices: never tokens or what anything costs Kiwimake.
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, KeyRound } from "lucide-react-native";
import { api, cloudMessage } from "@/lib/cloud";
import { useStore } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { credits } from "@/ui/CloudBits";
import { Field } from "@/ui/Field";
import { T } from "@/ui/Text";
import { border, icon, radius, size, space, useTheme } from "@/ui/theme";

type PlanRow = { id: "starter" | "pro" | "max" | "ownKey"; name: string; monthCents: number; yearCents: number; credits: number };
type Plans = { plans: PlanRow[]; extra: { cents: number; credits: number; months: number }; free: { credits: number } };

const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);

/** Buying waits for payments (milestone 6 of docs/CLOUD.md); until then the buttons say so. */
const PAYMENTS_READY = false;

function Card({ children, chosen, testID }: { children: React.ReactNode; chosen?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <View testID={testID} style={{ borderRadius: radius.card, borderWidth: border.width, borderColor: chosen ? t.accent : t.border, backgroundColor: t.surface, padding: space.lg, gap: space.sm }}>
      {children}
    </View>
  );
}

function Toggle({ value, onChange }: { value: "month" | "year"; onChange: (v: "month" | "year") => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignSelf: "flex-start", borderRadius: radius.full, borderWidth: border.width, borderColor: t.border, padding: space.hair }}>
      {(["month", "year"] as const).map((v) => (
        <Pressable
          key={v}
          onPress={() => onChange(v)}
          testID={`plan-${v}`}
          style={{ paddingVertical: space.xs, paddingHorizontal: space.lg, borderRadius: radius.full, backgroundColor: value === v ? t.selectedBg : "transparent" }}
        >
          <T variant="buttonSmall" color={value === v ? "text" : "textSecondary"}>
            {v === "month" ? "Monthly" : "Yearly, 2 months free"}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

export default function PlanScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const account = useStore((s) => s.account);
  const plans = useQuery(api.accounts.plans, {}) as Plans | undefined;
  const ownKey = useQuery(api.accounts.ownKey, {}) as { last4: string } | null | undefined;
  const setOwnKey = useMutation(api.accounts.setOwnKey);
  const removeOwnKey = useMutation(api.accounts.removeOwnKey);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = account?.plan.id ?? "free";

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(cloudMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", paddingHorizontal: size.screenGutter, paddingTop: space.sm }}>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: size.screenGutter, paddingBottom: insets.bottom + space["2xl"], gap: space.lg }}>
        <T variant="display">Your plan</T>
        <T variant="lede" color="textSecondary" testID="plan-balance">
          {account ? `${credits(Math.round(account.credits * 1000))} left, on ${account.plan.name}.` : ""} Every change says what it will likely use before it starts.
        </T>
        <T variant="caption" color="textSecondary">
          A credit covers everything a change needs: the AI, the machine, the build and getting it to your phone. You get {plans?.free.credits ?? 3} free credits every month.
        </T>
        <Toggle value={interval} onChange={setInterval} />
        {(plans?.plans ?? [])
          .filter((p) => p.id !== "ownKey")
          .map((p) => (
            <Card key={p.id} chosen={current === p.id} testID={`plan-card-${p.id}`}>
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
                <T variant="heading">{p.name}</T>
                <T variant="heading">
                  {interval === "month" ? `${dollars(p.monthCents)} a month` : `${dollars(p.yearCents)} a year`}
                </T>
              </View>
              <T color="textSecondary">
                {p.credits} credits every month{interval === "year" ? ", given monthly" : ""}. Unused credits roll over one month.
              </T>
              <View style={{ alignItems: "flex-end" }}>
                {current === p.id ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <Check size={icon.size.sm} strokeWidth={1.75} color={t.ready} />
                    <T variant="buttonSmall">Your plan</T>
                  </View>
                ) : (
                  <Button small label={PAYMENTS_READY ? `Choose ${p.name}` : "Coming soon"} disabled={!PAYMENTS_READY} />
                )}
              </View>
            </Card>
          ))}
        {plans ? (
          <Card testID="plan-extra">
            <T variant="heading">Extra credit</T>
            <T color="textSecondary">
              {dollars(plans.extra.cents)} for {plans.extra.credits} credits, with or without a plan. They last {plans.extra.months} months.
            </T>
            <View style={{ alignItems: "flex-end" }}>
              <Button small variant="quiet" label={PAYMENTS_READY ? "Buy extra credit" : "Coming soon"} disabled={!PAYMENTS_READY} />
            </View>
          </Card>
        ) : null}
        {(plans?.plans ?? [])
          .filter((p) => p.id === "ownKey")
          .map((p) => (
            <Card key={p.id} chosen={current === "ownKey"} testID="plan-card-ownKey">
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
                <T variant="heading">Own key</T>
                <T variant="heading">{interval === "month" ? `${dollars(p.monthCents)} a month` : `${dollars(p.yearCents)} a year`}</T>
              </View>
              <T color="textSecondary">Use your own Anthropic API key: changes need no credits, Anthropic bills you for the AI. Fair use: 30 machine hours a month.</T>
              {ownKey ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <KeyRound size={icon.size.sm} strokeWidth={1.75} color={t.textSecondary} />
                  <T style={{ flex: 1 }} testID="own-key-last4">
                    Your key ending in {ownKey.last4}
                  </T>
                </View>
              ) : (
                <Field value={key} onChangeText={setKey} placeholder="sk-ant-..." autoCapitalize="none" autoCorrect={false} secureTextEntry testID="own-key-field" />
              )}
              <View style={{ alignItems: "flex-end" }}>
                {ownKey ? (
                  <Button small variant="text" label="Remove my key" busy={busy === "remove"} onPress={() => run("remove", () => removeOwnKey({}))} testID="own-key-remove" />
                ) : (
                  <Button
                    small
                    variant="quiet"
                    label="Save my key"
                    busy={busy === "key"}
                    disabled={!key.trim()}
                    testID="own-key-save"
                    onPress={() =>
                      run("key", async () => {
                        await setOwnKey({ key });
                        setKey("");
                      })
                    }
                  />
                )}
              </View>
            </Card>
          ))}
        {error ? <T color="problem">{error}</T> : null}
      </ScrollView>
    </View>
  );
}
