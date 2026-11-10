import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { T } from "./Text";
import { border, icon, radius, size, space, useTheme } from "./theme";

/**
 * Buttons (COMPONENTS.md 1). primary: the one next action on a screen (green). quiet: everything
 * else (outlined ink). problem: confirms losing data or a connection. text: an escape hatch.
 * `small` is the in-card / header size. At most one primary per screen.
 */
export type ButtonVariant = "primary" | "quiet" | "problem" | "text";

export function Button({
  label,
  onPress,
  variant = "primary",
  small,
  icon: Icon,
  disabled,
  busy,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  small?: boolean;
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const off = disabled && !busy;
  const fg = off
    ? t.textTertiary
    : variant === "primary"
      ? t.onAccent
      : variant === "problem"
        ? t.onProblem
        : t.text;
  const fill = (pressed: boolean) =>
    off
      ? t.surfaceSunken
      : variant === "primary"
        ? pressed
          ? t.accentPressed
          : t.accent
        : variant === "problem"
          ? t.problem
          : pressed
            ? t.selectedBg
            : "transparent";
  if (variant === "text") {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={off ? undefined : onPress} hitSlop={space.md} style={style}>
        <T variant={small ? "buttonSmall" : "button"} style={{ color: fg, textDecorationLine: "underline", textDecorationColor: t.borderStrong }}>
          {label}
        </T>
      </Pressable>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off || busy ? undefined : onPress}
      style={({ pressed }) => [
        {
          minHeight: small ? size.buttonHeightSmall : size.buttonHeight,
          paddingHorizontal: small ? space.lg : space.xl,
          borderRadius: radius.button,
          backgroundColor: fill(pressed),
          borderWidth: variant === "quiet" && !off ? border.width : 0,
          borderColor: t.borderStrong,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : Icon ? (
        <View>
          <Icon size={icon.size.button} color={fg} strokeWidth={icon.stroke} absoluteStrokeWidth />
        </View>
      ) : null}
      <T variant={small ? "buttonSmall" : "button"} style={{ color: fg }}>
        {label}
      </T>
    </Pressable>
  );
}

/** Icon-only button for the universal icons (back, settings, close). Hit area: size.touch. */
export function IconButton({
  icon: Icon,
  onPress,
  label,
  color,
  iconSize = icon.size.lg,
  testID,
}: {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  color?: string;
  iconSize?: number;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size.touch,
        height: size.touch,
        borderRadius: radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.selectedBg : "transparent",
      })}
    >
      <Icon size={iconSize} color={color ?? t.text} strokeWidth={icon.stroke} absoluteStrokeWidth />
    </Pressable>
  );
}
