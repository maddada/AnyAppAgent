// "My PC is off, do this change in the cloud" (docs/CLOUD.md section 3, cloud milestone 9). In a PC
// app's chat while its PC is off: when the app is kept ready in the cloud (the switch "Use the
// cloud when my PC is off" is on and the PC has pushed it), the chat offers "Do it in the cloud"
// with its estimate next to "Wait for my PC". The change runs on the PC app's package and key; it
// comes back to the PC when the PC is on. The text takes the full width, the buttons go below it.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api, cloudMessage } from "@/lib/cloud";
import type { App, CreditEstimate } from "@/lib/protocol";
import { upsertApp, useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { estimateText } from "@/ui/CloudBits";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, radius, space, useTheme } from "@/ui/theme";

type Offer = { ready: false; switchOn: boolean } | { ready: true; switchOn: boolean; appId: string; estimate: CreditEstimate; pcOff: { since: number } | null } | null;

function WaitLine() {
  return (
    <View testID="pc-off-line" style={{ paddingHorizontal: space.xs, paddingBottom: space.sm }}>
      <StateLine kind="idle" label="Your PC is off. Your message goes when it is back on." role="caption" lines={2} />
    </View>
  );
}

export function PcOffOffer({ app, text, onSent }: { app: App; text: string; onSent: () => void }) {
  const t = useTheme();
  const signedIn = useStore((s) => s.cloudAuth === "signedIn");
  if (!signedIn) return <WaitLine />;
  return <Signed app={app} text={text} onSent={onSent} t={t} />;
}

function Signed({ app, text, onSent, t }: { app: App; text: string; onSent: () => void; t: ReturnType<typeof useTheme> }) {
  const offer = useQuery(api.pcoff.offer, { packageName: app.packageName }) as Offer | undefined;
  const change = useMutation(api.pcoff.change);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!offer?.ready || waiting) return <WaitLine />;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await change({ packageName: app.packageName, text });
      onSent();
      router.push(`/chat/${offer.appId}`);
    } catch (e) {
      setError(cloudMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID="pc-off-offer" style={{ gap: space.sm, padding: space.lg, marginBottom: space.sm, borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface }}>
      <T>
        {offer.pcOff
          ? "Your PC is off, and a change made in the cloud is waiting to go back to it. You can do another one in the cloud."
          : "Your PC is off. Do this change in the cloud? It uses credits, and it comes back to your PC when your PC is on."}
      </T>
      <T variant="caption" color="textSecondary" testID="pc-off-estimate">
        {estimateText(offer.estimate)}
      </T>
      {!text.trim() ? <T variant="caption" color="textSecondary">Write the change below first.</T> : null}
      {error ? <T color="problem">{error}</T> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
        <Button small variant="text" label="Wait for my PC" onPress={() => setWaiting(true)} testID="pc-off-wait" />
        <Button small label="Do it in the cloud" busy={busy} disabled={!text.trim()} onPress={go} testID="pc-off-go" />
      </View>
    </View>
  );
}

/**
 * The cloud's row of a PC app (a change made while the PC is off): not in the cloud's list, so its
 * chat screen loads it by id and keeps it in the store while it is open.
 */
export function CloudRowLoader({ appId }: { appId: string }) {
  const row = useQuery(api.apps.get, { appId }) as App | undefined;
  useEffect(() => {
    if (row) upsertApp(row);
  }, [row]);
  return null;
}
