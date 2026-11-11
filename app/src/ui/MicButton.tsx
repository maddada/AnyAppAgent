import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, View } from "react-native";
import { Mic, Settings, X } from "lucide-react-native";
import { MIC_REASON, type Dictation } from "@/lib/dictation";
import { Spinner } from "./Spinner";
import { StateLine } from "./StateLine";
import { T } from "./Text";
import { icon, radius, size, space, useTheme } from "./theme";

/**
 * The mic beside a prompt box (like the desktop composer's): tap to dictate, tap again to stop.
 * While listening it fills brick red (the desktop's recording colour) and a soft ring breathes
 * with the voice level. Hidden when the phone has no speech recognition.
 */
export function MicButton({ dictation, testID = "composer-mic" }: { dictation: Dictation; testID?: string }) {
  const t = useTheme();
  const { phase, level } = dictation;
  const listening = phase === "listening";
  const busy = phase === "asking" || phase === "starting";

  // The ring: a slow breath, plus the voice level on top.
  const [breath] = useState(() => new Animated.Value(0));
  const [voice] = useState(() => new Animated.Value(0));
  // "Remove animations" on the phone: the ring stays still (the red fill still says "listening").
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
  }, []);
  useEffect(() => {
    if (!listening || reduce) {
      breath.stopAnimation();
      breath.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, reduce, breath]);
  useEffect(() => {
    Animated.timing(voice, { toValue: listening && !reduce ? level : 0, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [listening, reduce, level, voice]);
  const scale = useMemo(
    () => Animated.add(breath.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1.18] }), voice.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] })),
    [breath, voice],
  );

  if (!dictation.available) return null;
  return (
    <View style={{ width: size.sendButton, height: size.sendButton }}>
      {listening ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, left: 0, width: size.sendButton, height: size.sendButton, borderRadius: radius.full, backgroundColor: t.problemSoft, transform: [{ scale }] }}
        />
      ) : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={listening ? "Stop dictating" : "Dictate"}
        accessibilityState={{ busy }}
        hitSlop={(size.touch - size.sendButton) / 2 + space.xs}
        onPress={dictation.toggle}
        style={({ pressed }) => ({
          width: size.sendButton,
          height: size.sendButton,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: listening ? t.problem : pressed ? t.selectedBg : "transparent",
        })}
      >
        {busy ? <Spinner color={t.textSecondary} /> : <Mic size={icon.size.md} color={listening ? t.onProblem : t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />}
      </Pressable>
    </View>
  );
}

/** The line above or under a prompt box: the reason while Android asks, "Listening", or a problem. */
export function DictationNote({ dictation, style }: { dictation: Dictation; style?: object }) {
  const t = useTheme();
  if (!dictation.available) return null;
  if (dictation.phase === "asking") {
    return (
      <View style={style}>
        <T testID="dictation-reason" variant="caption" color="textSecondary">
          {MIC_REASON}
        </T>
      </View>
    );
  }
  if (dictation.phase === "listening") {
    return (
      <View testID="dictation-listening" style={[{ flexDirection: "row", alignItems: "center", gap: space.sm }, style]}>
        <View style={{ width: size.dot, height: size.dot, borderRadius: size.dot / 2, backgroundColor: t.problem }} />
        <T variant="caption" color="textSecondary">
          Listening. Tap the mic when you are done.
        </T>
      </View>
    );
  }
  if (!dictation.error) return null;
  return (
    <View testID="dictation-error" style={[{ flexDirection: "row", alignItems: "center", gap: space.sm }, style]}>
      <View style={{ flex: 1 }}>
        <StateLine kind="problem" label={dictation.error} role="caption" lines={0} />
      </View>
      {dictation.needsSettings ? (
        <Pressable testID="dictation-settings" accessibilityRole="button" accessibilityLabel="Open settings" hitSlop={space.sm} onPress={dictation.openSettings} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Settings size={icon.size.sm} color={t.accent} strokeWidth={icon.stroke} absoluteStrokeWidth />
          <T variant="caption" color="accent">
            Settings
          </T>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={space.sm} onPress={dictation.dismiss}>
        <X size={icon.size.sm} color={t.textTertiary} strokeWidth={icon.stroke} absoluteStrokeWidth />
      </Pressable>
    </View>
  );
}
