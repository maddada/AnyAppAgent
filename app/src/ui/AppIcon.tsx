import { View } from "react-native";
import { Image } from "expo-image";
import type { App } from "@/lib/protocol";
import { useStore } from "@/lib/store";
import { T } from "./Text";
import { border, radius, size as sizes, typeStyle, useTheme } from "./theme";

/**
 * The app's own launcher icon from the PC (GET /icon), cached per iconVersion. Corner radius is
 * size / 4 (radius.appIcon at size.appIcon), with a 1px inner line in iconEdge so pale icons keep
 * their edge. Until it loads, the first letter on surfaceSunken (users' icons are the only colour).
 */
export function AppIcon({ app, size }: { app: App; size: number }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const r = (size * radius.appIcon) / sizes.appIcon;
  return (
    <View style={{ width: size, height: size, borderRadius: r, overflow: "hidden", backgroundColor: t.surfaceSunken }}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <T style={{ ...typeStyle("titleSmall"), color: t.textSecondary, fontSize: size * 0.42, lineHeight: size * 0.52 }}>
          {(app.name.trim()[0] ?? "?").toUpperCase()}
        </T>
      </View>
      {client ? (
        <Image
          source={{ uri: `${client.iconUrl(app.id)}?v=${app.iconVersion}`, headers: client.authHeaders(), cacheKey: `${app.id}-${app.iconVersion}` }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          recyclingKey={`${app.id}-${app.iconVersion}`}
        />
      ) : null}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: r, borderWidth: border.width, borderColor: t.iconEdge }} />
    </View>
  );
}
