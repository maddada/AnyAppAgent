// The phone side of docs/TRUST.md: the yellow sign on an app that is behind and its "Update it",
// the monthly reminder, the usage under each message, the heads-up before a big job, and the plan
// and backup lines in Settings. Words and numbers come from shared/chat/trust.ts (same as the PC).
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Gauge, TriangleAlert } from "lucide-react-native";
import { BEHIND_LABEL, UPDATING_LABEL, cacheLine, formatTokens, headsUp, type HeadsUp, newTokens, PLAN_UNKNOWN, planLines, reminderText, usageLine } from "@shared/chat/index";
import type { App, CareState, ChatItem } from "@/lib/protocol";
import { useStore } from "@/lib/store";
import { Button } from "./Button";
import { StateLine } from "./StateLine";
import { T } from "./Text";
import { border, icon, radius, size, space, useTheme } from "./theme";

const BADGE = 22;

/** The yellow sign on an app's icon while it is behind the newest template; a tap opens its sheet. */
export function HealthBadge({ app, big, onPress }: { app: App; big?: boolean; onPress?: () => void }) {
  const t = useTheme();
  if (!app.health?.behind) return null;
  const d = big ? BADGE + 6 : BADGE;
  return (
    <Pressable
      testID={`behind-${app.slug}`}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={BEHIND_LABEL}
      disabled={!onPress}
      onPress={onPress}
      hitSlop={12}
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: t.attention,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: big ? 0 : 2,
        borderColor: t.tileBg,
      }}
    >
      <T variant="label" style={{ color: t.onAttention, fontWeight: "700", lineHeight: undefined }} maxFontSizeMultiplier={1.2}>
        !
      </T>
    </Pressable>
  );
}

/**
 * In an app's sheet while it is behind: what is behind, and "Update it" after a heads-up. While the
 * update runs (AppHealth.updating) one calm line instead; still behind afterwards, the card is back.
 */
export function HealthCard({ app, onSent }: { app: App; onSent: () => void }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const care = useStore((s) => s.care);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!app.health?.behind) return null;
  if (app.health.updating) {
    return (
      <View testID="health-updating" style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: t.surfaceSunken, marginBottom: space.md }}>
        <StateLine kind="working" label={UPDATING_LABEL} lines={0} />
      </View>
    );
  }
  const h = headsUp({ text: "", keepHealthy: true, usage: care?.usage, appUsage: app.usage })!;
  const send = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await client.keepHealthy(app.id);
      setAsking(false);
      onSent();
    } catch (e) {
      setError((e as Error).message || "That didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      testID="health-card"
      style={{ gap: space.xs, padding: space.lg, borderRadius: radius.card, backgroundColor: t.surfaceSunken, marginBottom: space.md, borderLeftWidth: 3, borderLeftColor: t.attention }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <HealthBadge app={app} big />
        <T variant="body" style={{ flex: 1 }}>
          Behind the newest template
        </T>
      </View>
      {app.health.reasons.map((r) => (
        <T key={r} variant="label" color="textSecondary">
          {r}
        </T>
      ))}
      {asking ? (
        <T variant="label" style={{ marginTop: space.xs }}>
          {h.body}
        </T>
      ) : null}
      {error ? (
        <T variant="label" color="problem">
          {error}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, marginTop: space.sm }}>
        {asking ? (
          <>
            <Button label="Not now" variant="quiet" small onPress={() => setAsking(false)} />
            <Button testID="keep-healthy-send" label={h.send} small busy={busy} onPress={() => void send()} />
          </>
        ) : (
          <Button testID="keep-healthy" label="Update it" small onPress={() => setAsking(true)} />
        )}
      </View>
    </View>
  );
}

/** The monthly reminder, above the app grid. */
export function ReminderBanner() {
  const t = useTheme();
  const care = useStore((s) => s.care);
  const client = useStore((s) => s.client);
  const words = reminderText(care?.health);
  if (!words) return null;
  return (
    <View
      testID="health-reminder"
      style={{ gap: space.xs, padding: space.lg, borderRadius: radius.card, backgroundColor: t.surface, borderWidth: border.width, borderColor: t.border, marginBottom: space.md }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={{ width: BADGE, height: BADGE, borderRadius: BADGE / 2, backgroundColor: t.attention, alignItems: "center", justifyContent: "center" }}>
          <T variant="label" style={{ color: t.onAttention, fontWeight: "700", lineHeight: undefined }} maxFontSizeMultiplier={1.2}>
            !
          </T>
        </View>
        <T variant="body" style={{ flex: 1 }}>
          {words.title}
        </T>
      </View>
      <T variant="label" color="textSecondary">
        {words.body}
      </T>
      <Button
        testID="reminder-dismiss"
        label="Got it"
        variant="quiet"
        small
        style={{ alignSelf: "flex-end", marginTop: space.sm }}
        onPress={() => {
          if (!client) return;
          void client.dismissReminder().then(
            (next) => useStore.setState({ care: next }),
            () => {},
          );
        }}
      />
    </View>
  );
}

/** Under a message from the person: what its work used. */
export function UsageNote({ item }: { item: ChatItem }) {
  const t = useTheme();
  const line = usageLine(item.usage);
  if (!line) return null;
  return (
    <View
      testID="usage-note"
      accessibilityHint={cacheLine(item.usage) ?? undefined}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.xs, paddingHorizontal: space.xs }}
    >
      <Gauge size={size.stateIcon} color={t.textTertiary} strokeWidth={icon.stroke} absoluteStrokeWidth />
      <T variant="caption" color="textTertiary">
        {line}
      </T>
    </View>
  );
}

/** The heads-up before a big job, above the composer. */
export function HeadsUpCard({ h, onSend, onCancel, busy }: { h: HeadsUp; onSend: () => void; onCancel: () => void; busy?: boolean }) {
  const t = useTheme();
  return (
    <View
      testID="heads-up"
      style={{ gap: space.sm, padding: space.lg, borderRadius: radius.card, backgroundColor: t.surface, borderWidth: border.width, borderColor: t.border, marginBottom: space.sm }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <TriangleAlert size={size.stateIcon + 3} color={t.attentionText} strokeWidth={icon.stroke} absoluteStrokeWidth />
        <T variant="body">{h.title}</T>
      </View>
      <T variant="label" color="textSecondary">
        {h.body}
      </T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm }}>
        <Button label="Not now" variant="quiet" small onPress={onCancel} />
        <Button testID="heads-up-send" label={h.send} small busy={busy} onPress={onSend} />
      </View>
    </View>
  );
}

/** Settings: the plan's limits as Claude reported them, this month's use, and the backup. */
export function CareSettings({ care }: { care: CareState | null }) {
  const t = useTheme();
  const apps = useStore((s) => s.apps);
  if (!care) return null;
  const lines = planLines(care.usage);
  const top = Object.values(apps)
    .filter((a) => a.usage && newTokens(a.usage.month) > 0)
    .sort((a, b) => newTokens(b.usage!.month) - newTokens(a.usage!.month))
    .slice(0, 5);
  const b = care.backup;
  const when = b.lastBackupAt ? new Date(b.lastBackupAt) : null;
  const whenText = when ? `${when.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}` : null;
  return (
    <View style={{ gap: space.sm }} testID="care-settings">
      <T variant="label" color="textSecondary">
        USE
      </T>
      {lines.length > 0 ? (
        lines.map((l) => (
          <View key={l.text} style={{ gap: space.xs }}>
            <T variant="callout" color={l.kind === "out" ? "problem" : "text"}>
              {l.text}
            </T>
            {l.percent !== undefined ? (
              <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surfaceSunken, overflow: "hidden" }}>
                <View style={{ width: `${l.percent}%`, height: 6, backgroundColor: l.kind === "ok" ? t.ready : t.attention }} />
              </View>
            ) : null}
          </View>
        ))
      ) : (
        <T variant="label" color="textSecondary">
          {PLAN_UNKNOWN}
        </T>
      )}
      <T variant="callout">{`This month: ${formatTokens(newTokens(care.usage.month))} tokens`}</T>
      {top.map((a) => (
        <View key={a.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <T variant="label" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            {a.name}
          </T>
          <T variant="label" color="textSecondary">{`${formatTokens(newTokens(a.usage!.month))}, ${a.usage!.changes} ${a.usage!.changes === 1 ? "change" : "changes"}`}</T>
        </View>
      ))}
      <T variant="label" color="textSecondary" style={{ marginTop: space.md }}>
        BACKUP
      </T>
      <T variant="callout" testID="backup-line" color={b.lastError ? "problem" : "text"}>
        {b.enabled
          ? b.lastError
            ? b.lastError
            : whenText
              ? `Your apps were backed up ${whenText} (${b.apps} ${b.apps === 1 ? "app" : "apps"}).`
              : "Backups are on; the first one is on its way."
          : 'Not backed up. Turn on "Back up my apps" in Kiwimake\'s Settings on your PC.'}
      </T>
    </View>
  );
}
