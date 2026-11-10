import { useEffect, useState } from "react";
import { Animated, Easing, type TextStyle, type StyleProp } from "react-native";

/**
 * bb's "shine" on live labels ("Working…", "Running …"). bb sweeps a gradient mask once a
 * second; here the text breathes between 45% and 100% opacity at the same pace.
 */
export function Shine({ children, style, active = true }: { children: React.ReactNode; style?: StyleProp<TextStyle>; active?: boolean }) {
  const [v] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!active) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.45, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, v]);
  return <Animated.Text style={[style, { opacity: v }]}>{children}</Animated.Text>;
}
