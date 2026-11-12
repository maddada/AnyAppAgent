import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import type { App } from "@/lib/protocol";
import { useStore, useClientFor } from "@/lib/store";
import { T } from "./Text";
import { border, radius, size as sizes, typeStyle, useTheme } from "./theme";

/**
 * Icon loading shared by every place that shows an app's icon (tile, sheet, chat header, build
 * card): one entry per app and iconVersion. A failed load retries everywhere at once (2, 5, 10,
 * then every 30 s), and a load that succeeds anywhere refreshes the places that had failed, so one
 * screen never shows the letter while another shows the icon. expo-image keeps the files under a
 * cache key per app and iconVersion, so a new iconVersion fetches the new icon.
 */
type IconState = { attempt: number; failed: boolean; timer: ReturnType<typeof setTimeout> | null };
const icons = new Map<string, IconState>();
const listeners = new Set<() => void>();
const RETRY_MS = [2000, 5000, 10000, 30000];

function iconState(key: string): IconState {
  let s = icons.get(key);
  if (!s) {
    s = { attempt: 0, failed: false, timer: null };
    icons.set(key, s);
  }
  return s;
}

function changed(key: string, next: Partial<IconState>) {
  icons.set(key, { ...iconState(key), ...next });
  for (const l of listeners) l();
}

function onIconError(key: string) {
  const s = iconState(key);
  if (s.timer) return; // a retry is already on its way for every place showing this icon
  const delay = RETRY_MS[Math.min(s.attempt, RETRY_MS.length - 1)];
  const timer = setTimeout(() => changed(key, { attempt: iconState(key).attempt + 1, failed: false, timer: null }), delay);
  changed(key, { failed: true, timer });
}

function onIconLoad(key: string) {
  const s = iconState(key);
  if (s.timer) clearTimeout(s.timer);
  // Places that failed reload now (from the cache this load just filled).
  if (s.failed || s.timer) changed(key, { attempt: s.attempt + 1, failed: false, timer: null });
}

function useIcon(key: string): IconState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => iconState(key),
  );
}

/** The app's own launcher icon from the PC (GET /icon). */
export function AppIcon({ app, size }: { app: App; size: number }) {
  const t = useTheme();
  const client = useClientFor(app.id);
  const key = `${app.id}-${app.iconVersion}`;
  const state = useIcon(key);
  const r = (size * radius.appIcon) / sizes.appIcon;
  return (
    <View style={{ width: size, height: size, borderRadius: r, overflow: "hidden", backgroundColor: t.surfaceSunken }}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <T style={{ ...typeStyle("titleSmall"), color: t.textSecondary, fontSize: size * 0.42, lineHeight: size * 0.52 }}>
          {(app.name.trim()[0] ?? "?").toUpperCase()}
        </T>
      </View>
      {client && client.iconUrl(app.id) ? (
        <Image
          // The URL changes per retry so the image view really asks again; the cache key does not.
          source={{ uri: `${client.iconUrl(app.id)}?v=${app.iconVersion}&try=${state.attempt}`, headers: client.authHeaders(), cacheKey: key }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          recyclingKey={key}
          onError={() => onIconError(key)}
          onLoad={() => onIconLoad(key)}
        />
      ) : null}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: r, borderWidth: border.width, borderColor: t.iconEdge }} />
    </View>
  );
}
