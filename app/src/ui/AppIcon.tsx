import { View } from "react-native";
import { Image } from "expo-image";
import type { App } from "@/lib/protocol";
import { useStore } from "@/lib/store";
import { T } from "./Text";
import { useTheme } from "./theme";


/** The app's launcher icon from the PC (GET /icon), cached per iconVersion. */
export function AppIcon({ app, size }: { app: App; size: number }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const r = Math.round(size * 0.24);
  const color = t.appColors[Math.abs(hash(app.id)) % t.appColors.length];
  return (
    <View style={{ width: size, height: size, borderRadius: r, overflow: "hidden", backgroundColor: t.recessed }}>
      {/* Letter underneath: shows while the icon loads, or if the PC has none. */}
      <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: color }}>
        <T style={{ color: t.onColor, fontSize: size * 0.42, lineHeight: size * 0.52 }} weight="semibold">
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
    </View>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
