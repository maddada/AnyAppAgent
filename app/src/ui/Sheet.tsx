import { useEffect, useState } from "react";
import { Animated, Easing, Keyboard, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, useTheme, space } from "./theme";

/** A bottom sheet: slides up over a dimmed screen, tap outside or back to close. */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [slide] = useState(() => new Animated.Value(0));
  const keyboard = useKeyboardHeight();
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      Animated.timing(slide, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(slide, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible, mounted, slide]);

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: t.scrim, opacity: slide }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: keyboard,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }],
        }}
      >
        <View
          style={{
            backgroundColor: t.background,
            borderTopLeftRadius: radius.xxl + 8,
            borderTopRightRadius: radius.xxl + 8,
            borderWidth: t.dark ? 1 : 0,
            borderColor: t.border,
            paddingHorizontal: space.xl,
            paddingTop: space.sm,
            paddingBottom: (keyboard > 0 ? 12 : insets.bottom) + 16,
          }}
        >
          <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: t.muted, marginBottom: space.md }} />
          {children}
        </View>
      </Animated.View>
    </Modal>
  );
}

export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
