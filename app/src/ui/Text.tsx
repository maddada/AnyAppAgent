import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { font, type, useTheme } from "./theme";

type Size = keyof typeof type;
type Weight = "regular" | "medium" | "semibold" | "bold";
type Tone = "foreground" | "muted" | "subtle" | "destructive" | "success" | "inverse";

export function T({
  size = "sm",
  weight = "regular",
  tone = "foreground",
  mono,
  style,
  ...rest
}: TextProps & { size?: Size; weight?: Weight; tone?: Tone; mono?: boolean }) {
  const t = useTheme();
  const color =
    tone === "muted"
      ? t.mutedForeground
      : tone === "subtle"
        ? t.subtleForeground
        : tone === "destructive"
          ? t.destructiveText
          : tone === "success"
            ? t.successText
            : tone === "inverse"
              ? t.primaryForeground
              : t.foreground;
  const base: TextStyle = { ...type[size], color, fontFamily: mono ? font.mono : font[weight] };
  return <RNText {...rest} style={[base, style]} />;
}
