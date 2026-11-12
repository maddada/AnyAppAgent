// Moving an app between the paired PC and the cloud (docs/CLOUD.md section 3, "Moving an app",
// cloud milestone 8), from the app's sheet. Offered only while the PC is on and linked to the
// account signed in here, and (to the cloud) GitHub is connected. The PC does the work; a move to
// the cloud shows its progress on the PC app, a move here answers once the app is on the PC.
import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Cloud, Monitor } from "lucide-react-native";
import { cloudMessage } from "@/lib/cloud";
import { pcLinkedHere } from "@/lib/pcLink";
import type { App } from "@/lib/protocol";
import { placeOf, upsertApp, useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { T } from "@/ui/Text";
import { border, radius, space, useTheme } from "@/ui/theme";

/** What the move looks like on a PC app (running, stopped, done), or null. */
export function moveLine(app: App): { text: string; problem?: boolean } | null {
  const m = app.move;
  if (!m) return null;
  if (m.state === "running") return { text: `Moving to the cloud: ${m.step ?? "starting"}` };
  if (m.state === "failed") return { text: `The move stopped: ${m.error ?? "something went wrong"}. Move it again to go on.`, problem: true };
  return { text: "Moved to the cloud" };
}

export function MoveButton({ app, onMoved }: { app: App; onMoved: () => void }) {
  const t = useTheme();
  const pc = useStore((s) => s.client);
  const pcOnline = useStore((s) => s.connection === "online");
  const serverName = useStore((s) => s.serverName);
  const account = useStore((s) => s.account);
  const signedIn = useStore((s) => s.cloudAuth === "signedIn");
  const linked = useStore((s) => (s.pcAccount ? pcLinkedHere(s.account?.pcs) : false));
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toCloud = placeOf(app) === "pc";
  if (!signedIn || !account || !pc || !pcOnline) return null;
  if (toCloud && (app.move?.state === "running" || (app.move?.state === "done" && app.move.to === "cloud"))) return null;
  if (toCloud && !app.latestApk) return null;
  const pcName = serverName ?? "your PC";
  const needs = !linked ? `Link ${pcName} to your account first (Account).` : toCloud && !account.cloud.github?.connected ? "Connect GitHub first: the app's code goes to your own GitHub." : null;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (toCloud) {
        upsertApp(await pc.moveToCloud(app.id));
      } else {
        const here = await pc.moveHere(app.id);
        upsertApp(here);
      }
      onMoved();
    } catch (e) {
      setError(cloudMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!asking) {
    return (
      <Button
        testID="app-move"
        label={toCloud ? "Move to the cloud" : `Move to ${pcName}`}
        icon={toCloud ? Cloud : Monitor}
        variant="quiet"
        onPress={() => setAsking(true)}
      />
    );
  }
  return (
    <View testID="move-panel" style={{ gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface }}>
      <T>
        {toCloud
          ? `${app.name} moves to the cloud with its code, chat, to-dos and signing key, so it keeps updating in place on this phone. Changes then use credits. ${pcName} keeps a read-only copy.`
          : `${app.name} moves to ${pcName} with its code, chat, to-dos and signing key, so it keeps updating in place on this phone. Changes then run on your PC with your Claude, no credits.`}
      </T>
      {needs ? <T color="textSecondary">{needs}</T> : null}
      {error ? <T color="problem">{error}</T> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
        <Button small variant="text" label="Not now" onPress={() => setAsking(false)} testID="move-cancel" />
        {needs && !linked ? (
          <Button small label="Account" onPress={() => router.push("/account")} testID="move-account" />
        ) : needs ? (
          <Button small label="Connect GitHub" onPress={() => router.push("/github")} testID="move-github" />
        ) : (
          <Button small label="Move" busy={busy} onPress={go} testID="move-go" />
        )}
      </View>
    </View>
  );
}
