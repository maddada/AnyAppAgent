// Small pieces of the cloud's UI (docs/CLOUD.md section 2): credits in words, the estimate under
// the message box and on a plan card, a cloud app's credits this month, and the mark that says
// where an app is made when the person has both a PC and the cloud.
import { View } from "react-native";
import { useQuery } from "convex/react";
import { Cloud, Monitor } from "lucide-react-native";
import { api } from "@/lib/cloud";
import type { CreditEstimate } from "@/lib/protocol";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { icon, space, useTheme } from "@/ui/theme";

/** 1000 -> "1 credit", 2200 -> "2.2 credits", 500 -> "0.5 credits". */
export function credits(millicredits: number): string {
  const n = Math.round(millicredits / 100) / 10;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${s} ${n === 1 ? "credit" : "credits"}`;
}

const number = (m: number) => {
  const n = Math.round(m / 100) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

/** "About 1 credit", "About 3 to 4 credits", or on the Own key plan "About $0.20 on your Claude key". */
export function estimateText(e: CreditEstimate, range = false): string {
  if (e.ownKeyCents !== undefined) return `About $${(e.ownKeyCents / 100).toFixed(2)} on your Claude key`;
  if (range && e.high > e.low) return `About ${number(e.low)} to ${number(e.high)} credits`;
  return `About ${credits(e.millicredits)}`;
}

type Estimates = { next: CreditEstimate; plan: CreditEstimate; month: { usedMillicredits: number; paceMillicredits: number; changes: number }; firstApp: boolean };

export function useEstimates(appId: string | undefined): Estimates | undefined {
  return useQuery(api.estimates.forApp, appId ? { appId } : "skip") as Estimates | undefined;
}

/** Under the message box of a cloud app: what the next change will likely use. */
export function EstimateLine({ appId }: { appId: string }) {
  const e = useEstimates(appId);
  if (!e) return null;
  return (
    <T variant="caption" color="textTertiary" testID="estimate-line" style={{ paddingHorizontal: space.md, paddingTop: space.xs }}>
      {e.firstApp && e.next.ownKeyCents === undefined ? "Your first app uses at most 3 credits" : estimateText(e.next)}
    </T>
  );
}

/** A cloud app's machine waking up or busy elsewhere ("Waking up your app's machine"). */
export function BoxNote({ appId }: { appId: string }) {
  const box = useQuery(api.chat.box, { appId }) as { state: string; note: string | null; busy: boolean } | undefined;
  if (!box?.note) return null;
  return (
    <View testID="box-note" style={{ paddingHorizontal: space.xs, paddingBottom: space.sm }}>
      <StateLine kind="working" label={box.note} role="caption" lines={2} />
    </View>
  );
}

/** On a plan card: the estimate for the whole plan, as a range. */
export function PlanEstimate({ appId }: { appId: string }) {
  const e = useEstimates(appId);
  if (!e) return null;
  return (
    <T variant="caption" color="textSecondary" testID="plan-estimate">
      {estimateText(e.plan, true)}
    </T>
  );
}

/** In a cloud app's sheet: what it used this month and its pace. */
export function AppCredits({ appId }: { appId: string }) {
  const e = useEstimates(appId);
  if (!e) return null;
  const pace = e.month.paceMillicredits;
  return (
    <T variant="caption" color="textSecondary" testID="app-credits">
      {pace > 0 ? `This app: about ${credits(pace)} a month at your pace` : "This app has not used any credits yet"}
      {e.month.usedMillicredits > 0 ? `, ${credits(e.month.usedMillicredits)} so far this month` : ""}
    </T>
  );
}

/** The small mark on a tile saying where it is made (only when the person has both places). */
export function PlaceMark({ place, off }: { place: "pc" | "cloud"; off?: boolean }) {
  const t = useTheme();
  const Icon = place === "cloud" ? Cloud : Monitor;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }} testID={`place-${place}`}>
      <Icon size={icon.size.sm} strokeWidth={1.75} color={t.textTertiary} />
      <T variant="caption" color="textTertiary">
        {place === "cloud" ? "Cloud" : off ? "PC, off" : "PC"}
      </T>
    </View>
  );
}
