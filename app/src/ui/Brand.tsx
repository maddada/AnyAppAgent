import { Image } from "expo-image";
import { useTheme } from "./theme";

const LIGHT = require("../../../shared/theme/mark/native/lockup.png");
const DARK = require("../../../shared/theme/mark/native/lockup-dark.png");

/** The approved outlined wordmark and Bright Eye mark, with no launcher plate. */
export function BrandLockup({ height = 32 }: { height?: number }) {
  const t = useTheme();
  return <Image source={t.dark ? DARK : LIGHT} contentFit="contain" accessibilityLabel="Kiwimake" style={{ width: height * (413.15 / 106), height }} />;
}
