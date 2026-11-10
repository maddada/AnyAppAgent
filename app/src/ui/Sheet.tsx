import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Keyboard, Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { easing, elevation, motion, radius, space, useTheme } from "./theme";

/**
 * Bottom sheet (COMPONENTS.md 4): scrim, surfaceOverlay, top corners radius.sheet, elevation 3,
 * grabber in borderStrong. Slides up over motion.duration.slow; tap the scrim or Back to close.
 */
/** COMPONENTS.md 4: the grabber is 36 x 4 (no size token for it). */
const GRABBER = { width: 36, height: 4 };

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [slide] = useState(() => new Animated.Value(0));
  const keyboard = useKeyboardHeight();
  const { height: screen } = useWindowDimensions();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  if (visible && !mounted) setMounted(true);

  // The sheet sits on top of the keyboard and its content scrolls inside the room left above it,
  // so the field being typed in and the sheet's button below it stay visible.
  const room = screen - keyboard - insets.top - space["3xl"];
  useEffect(() => {
    if (keyboard === 0) return;
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [keyboard]);

  useEffect(() => {
    if (visible) {
      Animated.timing(slide, { toValue: 1, duration: motion.duration.slow, easing: Easing.bezier(...easing("enter")), useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(slide, { toValue: 0, duration: motion.duration.base, easing: Easing.bezier(...easing("exit")), useNativeDriver: true }).start(() =>
        setMounted(false),
      );
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
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }],
        }}
      >
        <View
          style={{
            backgroundColor: t.surfaceOverlay,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            paddingHorizontal: space.xl,
            paddingTop: space.md,
            paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + space["2xl"],
            ...elevation(t.mode, 3),
          }}
        >
          <View style={{ alignSelf: "center", ...GRABBER, borderRadius: radius.full, backgroundColor: t.borderStrong, marginBottom: space.lg }} />
          <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" bounces={false} style={{ maxHeight: room }}>
            {children}
          </ScrollView>
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
