import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";
import { motion, size as sizes } from "./theme";

/**
 * The working spinner (COMPONENTS.md 8): a 2px ring with one quarter clear, one turn per
 * motion.duration.spinner, linear. With reduce motion: a still ring at 60% opacity.
 */
export function Spinner({ color, size = sizes.spinner }: { color: string; size?: number }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
  }, []);
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: motion.duration.spinner, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, reduce]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color,
        borderTopColor: "transparent",
        opacity: reduce ? 0.6 : 1,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
      }}
    />
  );
}
