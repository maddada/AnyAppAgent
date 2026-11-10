import { Text as RNText, type TextProps } from "react-native";
import { typeStyle, useTheme, type ColorToken, type TypeRole } from "./theme";

/** Text in one type role and one colour token (COMPONENTS.md: never mix two roles). */
export function T({ variant = "body", color = "text", style, ...rest }: TextProps & { variant?: TypeRole; color?: ColorToken }) {
  const t = useTheme();
  return <RNText {...rest} style={[typeStyle(variant), { color: t[color] }, style]} />;
}
