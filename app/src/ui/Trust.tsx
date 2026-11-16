// The phone side of docs/TRUST.md: the calm update suggestion inside an app's chat (Update, Dismiss),
// the monthly reminder, the usage under each message, the heads-up before a big job, and the plan
// and backup lines in Settings. Words and numbers come from shared/chat/trust.ts (same as the PC).
import { useState } from "react";
import { View } from "react-native";
import { Gauge, TriangleAlert } from "lucide-react-native";
import { UPDATING_LABEL, cacheLine, formatTokens, headsUp, type HeadsUp, newTokens, planUnknown, planLines, reminderText, showsUpdateSuggestion, updateSuggestion, usageLine } from "@shared/chat/index";
import type { App, CareState, ChatItem } from "@/lib/protocol";
import { upsertApp, useClientFor, useOnlineFor, useStore } from "@/lib/store";
import { Button } from "./Button";
import { StateLine } from "./StateLine";
import { T } from "./Text";
import { border, icon, radius, size, space, useTheme } from "./theme";

/**
 * Inside an app's chat while a newer template is available (docs/TRUST.md): a calm, optional
 * suggestion, never a warning. "Dismiss" hides it for this update on every phone and the PC; a newer
 * update shows it again. "Update" asks once (the heads-up), then sends the update message. While
 * the update runs (AppHealth.updating) one calm line takes its place.
 */
export function UpdateSuggestion({ app }: { app: App }) {
  const t = useTheme();
  const client = useClientFor(app.id);
  const online = useOnlineFor(app.id);
  const care = useStore((s) => s.care);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"update" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!app.health?.behind) return null;
  const card = { gap: space.xs, padding: space.lg, borderRadius: radius.card, backgroundColor: t.surface, borderWidth: border.width, borderColor: t.border, marginHorizontal: space.md, marginTop: space.sm };
  if (app.health.updating) {
    return (
      <View testID="health-updating" style={card}>
        <StateLine kind="working" label={UPDATING_LABEL} lines={0} />
      </View>
    );
  }
  if (!showsUpdateSuggestion(app)) return null;
  const words = updateSuggestion(app.name);
  const h = headsUp({ text: "", keepHealthy: true, usage: care?.usage, appUsage: app.usage })!;
  const run = async (what: "update" | "dismiss") => {
    if (!client) return;
    setBusy(what);
    setError(null);
    try {
      if (what === "update") {
        await client.keepHealthy(app.id);
        setAsking(false);
      } else upsertApp(await client.dismissUpdate(app.id));
    } catch (e) {
      setError((e as Error).message || "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <View testID="update-suggestion" style={card}>
      <T variant="body">{words.title}</T>
      <T variant="label" color="textSecondary">
        {asking ? h.body : words.body}
      </T>
      {error ? (
        <T variant="label" color="problem">
          {error}
        </T>
      ) : null}
      {/* Design rule (AGENTS.md): the words take the full width; the buttons sit below, on the right. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, marginTop: space.sm }}>
        {asking ? (
          <>
            <Button label="Not now" variant="quiet" small onPress={() => setAsking(false)} />
            <Button testID="keep-healthy-send" label={h.send} small busy={busy === "update"} disabled={!online} onPress={() => void run("update")} />
          </>
        ) : (
          <>
            <Button testID="update-dismiss" label="Dismiss" variant="quiet" small busy={busy === "dismiss"} disabled={!online} onPress={() => void run("dismiss")} />
            <Button testID="keep-healthy" label="Update" small disabled={!online || app.status === "creating"} onPress={() => setAsking(true)} />
          </>
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
      <T variant="body">{words.title}</T>
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

function costLine(c: NonNullable<ChatItem["cost"]>): string | null {
  const n = (m: number) => {
    const x = Math.round(m / 100) / 10;
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  };
  if (c.ownKey) return c.millicredits > 0 ? `Used ${n(c.millicredits)} credits of machine time` : "On your own Claude key";
  if (c.running) return c.millicredits > 0 ? `Using credits: ${n(c.millicredits)} so far` : null;
  const est = c.estimateMillicredits ? ` (est. ${n(c.estimateMillicredits)})` : "";
  return `Used ${n(c.millicredits)} ${c.millicredits === 1000 ? "credit" : "credits"}${est}`;
}

/** Under a message from the person: what its work used. */
export function UsageNote({ item }: { item: ChatItem }) {
  const t = useTheme();
  // The cloud shows credits, never tokens (docs/CLOUD.md section 2): "Used 2.2 credits (est. 2)".
  const line = item.cost ? costLine(item.cost) : usageLine(item.usage);
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
          {planUnknown(care.usage)}
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
