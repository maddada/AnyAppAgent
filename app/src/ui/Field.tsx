import { forwardRef, useState } from "react";
import { TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { T } from "./Text";
import { border, radius, size, space, typeStyle, useTheme } from "./theme";

type Props = React.ComponentProps<typeof TextInput> & {
  label?: string;
  help?: string;
  problem?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

/**
 * Text field (COMPONENTS.md 2): label above, fieldBg box with a fieldBorder line, an accent line
 * while focused, a help line under it; a problem turns the line and the help line problem-red.
 */
export const Field = forwardRef<React.ComponentRef<typeof TextInput>, Props>(function Field(
  { label, help, problem, multiline, containerStyle, inputStyle, ...input },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const body = typeStyle("body");
  const line = body.lineHeight ?? 0;
  const lineColor = problem ? t.problem : focused ? t.accent : t.fieldBorder;
  return (
    <View style={containerStyle}>
      {label ? (
        <T variant="label" style={{ marginBottom: space.sm }}>
          {label}
        </T>
      ) : null}
      <TextInput
        ref={ref}
        {...input}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        placeholderTextColor={t.textTertiary}
        cursorColor={t.accent}
        selectionColor={t.accent}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          {
            ...body,
            color: t.text,
            backgroundColor: t.fieldBg,
            borderWidth: focused || problem ? border.focusWidth : border.width,
            borderColor: lineColor,
            borderRadius: radius.field,
            paddingHorizontal: space.lg,
          },
          multiline ? { paddingVertical: space.md, minHeight: line * 3 + space.md * 2, maxHeight: line * 8 + space.md * 2 } : { height: size.fieldHeight },
          inputStyle,
        ]}
      />
      {problem || help ? (
        <T variant="caption" color={problem ? "problem" : "textSecondary"} style={{ marginTop: space.sm }}>
          {problem ?? help}
        </T>
      ) : null}
    </View>
  );
});
