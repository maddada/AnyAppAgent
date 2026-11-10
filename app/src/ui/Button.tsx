import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { T } from "./Text";
import { radius, useTheme, space } from "./theme";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon: Icon,
  disabled,
  busy,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: "sm" | "md" | "lg" | "xl";
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const height = size === "xl" ? 64 : size === "lg" ? 52 : size === "md" ? 40 : 32;
  const bg =
    variant === "primary" ? t.primary : variant === "secondary" ? t.secondary : variant === "danger" ? t.destructiveSurface : "transparent";
  const fg = variant === "primary" ? t.primaryForeground : variant === "danger" ? t.destructiveText : t.foreground;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={disabled || busy ? undefined : onPress}
      style={({ pressed }) => [
        {
          height,
          borderRadius: size === "sm" ? radius.md : size === "md" ? radius.lg : radius.xl,
          backgroundColor: bg,
          borderWidth: variant === "outline" ? 1 : 0,
          borderColor: t.input,
          paddingHorizontal: size === "sm" ? 12 : 18,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : Icon ? (
        <View>
          <Icon size={size === "sm" ? 14 : size === "xl" ? 22 : 18} color={fg} strokeWidth={2} />
        </View>
      ) : null}
      <T size={size === "sm" ? "xs" : size === "xl" ? "lg" : size === "lg" ? "base" : "sm"} weight={size === "sm" ? "medium" : "semibold"} style={{ color: fg }}>
        {label}
      </T>
    </Pressable>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  label,
  size = 40,
  color,
  testID,
}: {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  size?: number;
  color?: string;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.hover : "transparent",
      })}
    >
      <Icon size={22} color={color ?? t.foreground} strokeWidth={1.75} />
    </Pressable>
  );
}
