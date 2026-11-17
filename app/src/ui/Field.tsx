import { forwardRef, useState } from "react";
import { TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useDictation, type Dictation } from "@/lib/dictation";
import { DictationNote, MicButton } from "./MicButton";
import { T } from "./Text";
import { border, radius, size, space, typeStyle, useTheme } from "./theme";

type Props = React.ComponentProps<typeof TextInput> & {
  label?: string;
  help?: string;
  problem?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  /** A button inside the box, at its bottom right (the dictation mic); the text keeps clear of it. */
  trailing?: React.ReactNode;
  /**
   * The dictation mic (lib/dictation.ts) in the box, with its note under it. On by default in a
   * multi-line box (where people write long text); `false` for one that holds a code or a key.
   */
  voice?: boolean;
  /** A dictation the screen keeps itself (to show "Listening" its own way); implies `voice`. */
  dictation?: Dictation;
  /** The mic's test id (default: the box's test id with "-mic"). */
  micTestID?: string;
};

/**
 * Text field (COMPONENTS.md 2): label above, fieldBg box with a fieldBorder line, an accent line
 * while focused, a help line under it; a problem turns the line and the help line problem-red.
 * Multi-line boxes have the dictation mic: the words go in at the caret.
 */
export const Field = forwardRef<React.ComponentRef<typeof TextInput>, Props>(function Field(props, ref) {
  const { voice, dictation } = props;
  if (dictation) return <DictatedField {...props} dictation={dictation} ref={ref} />;
  if (voice ?? !!props.multiline) return <VoiceField {...props} ref={ref} />;
  return <PlainField {...props} ref={ref} />;
});

/** A field with its own dictation. */
const VoiceField = forwardRef<React.ComponentRef<typeof TextInput>, Props>(function VoiceField(props, ref) {
  const { value, onChangeText } = props;
  const dictation = useDictation({ value: value ?? "", onChange: (text) => onChangeText?.(text) });
  return <DictatedField {...props} dictation={dictation} ref={ref} />;
});

/** A field wired to a dictation: the mic in the box, the caret tracked, the note under it. */
const DictatedField = forwardRef<React.ComponentRef<typeof TextInput>, Props & { dictation: Dictation }>(function DictatedField(
  { dictation, micTestID, trailing, onFocus, onBlur, onSelectionChange, ...props },
  ref,
) {
  const { track } = dictation;
  const off = props.editable === false || !dictation.available;
  return (
    <View style={props.containerStyle}>
      <PlainField
        {...props}
        ref={ref}
        containerStyle={undefined}
        onFocus={(e) => {
          track.onFocus(e);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          track.onBlur(e);
          onBlur?.(e);
        }}
        onSelectionChange={(e) => {
          track.onSelectionChange(e);
          onSelectionChange?.(e);
        }}
        trailing={trailing ?? (off ? undefined : <MicButton dictation={dictation} testID={micTestID ?? `${props.testID ?? "field"}-mic`} />)}
      />
      <DictationNote dictation={dictation} style={{ marginTop: space.sm }} />
    </View>
  );
});

const PlainField = forwardRef<React.ComponentRef<typeof TextInput>, Props>(function PlainField(
  { label, help, problem, multiline, containerStyle, inputStyle, trailing, voice: _voice, dictation: _dictation, micTestID: _micTestID, ...input },
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
      <View>
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
            trailing ? { paddingRight: space.lg + size.sendButton } : null,
            inputStyle,
          ]}
        />
        {trailing ? <View style={{ position: "absolute", right: space.xs, bottom: multiline ? space.xs : (size.fieldHeight - size.sendButton) / 2 }}>{trailing}</View> : null}
      </View>
      {problem || help ? (
        <T variant="caption" color={problem ? "problem" : "textSecondary"} style={{ marginTop: space.sm }}>
          {problem ?? help}
        </T>
      ) : null}
    </View>
  );
});
