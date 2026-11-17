// Ready apps, the gallery (docs/GALLERY.md): a card per official app, the Home tile next to Make a
// kiwi, and the Home section shown while the person has no apps yet. Design rule (AGENTS.md): a
// card's words take its full width; its buttons go below them, on the right.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { BadgeCheck, Copy, Download, LayoutGrid, Play, RefreshCw } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { galleryStateLine, OFFICIAL_BADGE, showsBadge, formatGallerySize } from "@shared/chat/gallery";
import { installFromGallery, openGalleryApp, useGallery, useGalleryState, type GalleryInstall } from "@/lib/gallery";
import type { GalleryApp } from "@/lib/protocol";
import { useStore } from "@/lib/store";
import { Button } from "./Button";
import { StateLine } from "./StateLine";
import { T } from "./Text";
import { border, elevation, icon, look, radius, size, space, useTheme } from "./theme";

const CARD_ICON = 48;

export function GalleryIcon({ app, px = CARD_ICON }: { app: GalleryApp; px?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const r = (px * radius.appIcon) / size.appIcon;
  if (!app.icon || failed) {
    return (
      <View style={{ width: px, height: px, borderRadius: r, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
        <T variant="heading" style={{ color: t.onAccent }}>
          {app.name.charAt(0).toUpperCase()}
        </T>
      </View>
    );
  }
  return <Image source={{ uri: app.icon }} style={{ width: px, height: px, borderRadius: r }} contentFit="cover" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />;
}

/** "Official Kiwimake App" with its check, in the ready colour. */
export function OfficialBadge({ testID }: { testID?: string }) {
  const t = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }} accessibilityLabel={OFFICIAL_BADGE}>
      <BadgeCheck size={icon.size.sm} color={t.ready} strokeWidth={icon.stroke} absoluteStrokeWidth />
      <T variant="caption" style={{ color: t.ready }}>
        {OFFICIAL_BADGE}
      </T>
    </View>
  );
}

function installWords(install: GalleryInstall | undefined): { text: string; kind: "working" | "problem" } | null {
  if (!install) return null;
  if (install.phase === "downloading") return { kind: "working", text: install.total > 0 ? `Downloading ${formatGallerySize(install.bytes)} of ${formatGallerySize(install.total)}` : "Getting it from GitHub" };
  if (install.phase === "checking") return { kind: "working", text: "Checking it is Kiwimake's" };
  if (install.phase === "installing") return { kind: "working", text: "Installing" };
  return { kind: "problem", text: install.message };
}

/** One official app: icon, name, the badge, its line, then its buttons below on the right. */
export function GalleryCard({ app, compact }: { app: GalleryApp; compact?: boolean }) {
  const t = useTheme();
  const state = useGalleryState(app);
  const install = useGallery((s) => s.installs[app.package]);
  const pairing = useStore((s) => !!s.pairing);
  const own = useStore((s) => Object.values(s.apps).some((a) => a.packageName === app.package));
  const maker = useGallery((s) => s.list?.maker ?? "Kiwimake");
  const busy = install !== undefined && install.phase !== "failed";
  const line = galleryStateLine(app, state);
  const working = installWords(install);
  const makeItMine = () => {
    const q = new URLSearchParams({ package: app.package, name: app.name, owner: maker, repo: app.repo, start: "own" });
    router.push(`/change?${q.toString()}`);
  };
  const primary =
    state === "open" || state === "unknown"
      ? { label: "Open", icon: Play, onPress: () => openGalleryApp(app) }
      : state === "update"
        ? { label: "Update", icon: RefreshCw, onPress: () => void installFromGallery(app) }
        : state === "install"
          ? { label: "Install", icon: Download, onPress: () => void installFromGallery(app) }
          : null;
  return (
    <View
      testID={`gallery-card-${app.package}`}
      style={{ padding: space.lg, gap: space.md, borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface }}
    >
      <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
        <GalleryIcon app={app} />
        <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
          <T variant="name" numberOfLines={2}>
            {app.name}
          </T>
          {showsBadge(state) ? <OfficialBadge testID={`gallery-badge-${app.package}`} /> : null}
        </View>
      </View>
      {app.line && !compact ? (
        <T variant="callout" color="textSecondary">
          {app.line}
        </T>
      ) : app.line ? (
        <T variant="caption" color="textSecondary" numberOfLines={2}>
          {app.line}
        </T>
      ) : null}
      {working ? <StateLine testID={`gallery-state-${app.package}`} kind={working.kind} label={working.text} role="caption" lines={0} /> : line ? <StateLine testID={`gallery-state-${app.package}`} kind={line.kind} label={line.text} role="caption" lines={0} /> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: space.sm }}>
        {install?.phase === "failed" && install.permission ? (
          <Button small variant="quiet" label="Allow installs" onPress={() => AnyAppNative?.openInstallPermissionSettings()} />
        ) : null}
        {state === "notOfficial" ? <Button small variant="quiet" label="Remove it" onPress={() => AnyAppNative?.requestUninstall(app.package)} /> : null}
        {pairing && !own && state !== "notOfficial" ? <Button testID={`gallery-mine-${app.package}`} small variant="quiet" label="Make it mine" icon={Copy} onPress={makeItMine} /> : null}
        {primary ? <Button testID={`gallery-primary-${app.package}`} small label={primary.label} icon={primary.icon} busy={busy} disabled={busy} onPress={primary.onPress} /> : null}
      </View>
    </View>
  );
}

/** The Home tile next to Make a kiwi: opens Ready apps. */
export function GalleryTile({ width, count }: { width: number; count: number }) {
  const t = useTheme();
  return (
    <Pressable
      testID="gallery-tile"
      accessibilityRole="button"
      accessibilityLabel="Ready apps"
      onPress={() => router.push("/gallery")}
      style={({ pressed }) => ({
        width,
        minHeight: size.tileMinHeight,
        borderRadius: radius.tile,
        backgroundColor: t.tileBg,
        borderWidth: border.width,
        borderColor: t.tileBorder,
        padding: look.tilePadding,
        alignItems: look.tileAlign,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...elevation(t.mode, look.tileElevation as 1),
      })}
    >
      <View style={{ width: size.appIcon, height: size.appIcon, borderRadius: radius.appIcon, backgroundColor: t.selectedBg, alignItems: "center", justifyContent: "center" }}>
        <LayoutGrid size={28} color={t.ready} strokeWidth={icon.stroke} absoluteStrokeWidth />
      </View>
      <T variant="name" style={{ marginTop: space.md }}>
        Ready apps
      </T>
      <View style={{ flex: 1, minHeight: space.xs }} />
      <T variant="label" color="textSecondary" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
        {count === 1 ? "1 app to install or start from" : `${count} apps to install or start from`}
      </T>
    </Pressable>
  );
}

/** Home while the person has no apps yet: the ready apps, to try one in a minute. */
export function GallerySection() {
  const list = useGallery((s) => s.list);
  if (!list || list.apps.length === 0) return null;
  return (
    <View testID="gallery-section" style={{ marginTop: space["2xl"], gap: space.md }}>
      <T variant="eyebrow" color="textTertiary" style={{ paddingHorizontal: space.xs }}>
        Start from a ready app
      </T>
      {list.apps.slice(0, 4).map((app) => (
        <GalleryCard key={app.package} app={app} compact />
      ))}
      {list.apps.length > 4 ? <Button variant="text" label={`See all ${list.apps.length}`} onPress={() => router.push("/gallery")} /> : null}
    </View>
  );
}
