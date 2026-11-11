import { View } from "react-native";
import type { StateKind } from "@shared/chat/index";
import { CircleAlert } from "lucide-react-native";
import { T } from "./Text";
import { Spinner } from "./Spinner";
import { icon, size, space, useTheme, type TypeRole } from "./theme";

/** The four states and nothing else (COMPONENTS.md 8; README rule 2). Defined in shared/chat/state.ts. */
export type { StateKind };

export function StateLine({
  kind,
  label,
  role = "label",
  quietText,
  lines = 1,
  fit,
  testID,
}: {
  kind: StateKind;
  label: string;
  role?: TypeRole;
  /** Keep the words in textSecondary and colour only the mark (the home "Connected" line). */
  quietText?: boolean;
  /** Lines before the words are cut (default one; sentences such as errors pass 0 for all). */
  lines?: number;
  /** One line that shrinks its letters rather than being cut (a half-width tile at large text sizes). */
  fit?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const color = kind === "working" ? t.working : kind === "ready" ? t.ready : kind === "problem" ? t.problem : t.textTertiary;
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: lines === 1 ? "center" : "flex-start", gap: space.sm }}>
      {kind === "working" ? <Spinner color={color} /> : null}
      {kind === "ready" ? <View style={{ width: size.dot, height: size.dot, borderRadius: size.dot / 2, backgroundColor: color }} /> : null}
      {kind === "problem" ? <CircleAlert size={size.stateIcon} color={color} strokeWidth={icon.stroke} absoluteStrokeWidth /> : null}
      <T variant={role} numberOfLines={fit ? 1 : lines || undefined} adjustsFontSizeToFit={fit} minimumFontScale={fit ? 0.5 : undefined} style={{ color: quietText ? t.textSecondary : color, flexShrink: 1 }}>
        {label}
      </T>
    </View>
  );
}
