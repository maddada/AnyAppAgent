import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, RefreshControl, ScrollView, Switch, TextInput, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, CircleUser, Download, EllipsisVertical, Globe, HousePlus, Inbox, ListTodo, MessageCircle, Pencil, Plus, Send, Settings, Share2, Smartphone } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { actionLabel, describeApp, hasOldCopyInTheWay, REMOVE_OLD_AND_INSTALL, tileState } from "@/lib/describe";
import { installLabel, headsUp as bigJobHeadsUp } from "@shared/chat/index";
import { installApp, installFromLink, launchApp, removeOldAndInstall, updateFromLink } from "@/lib/installer";
import type { App, AppPreset } from "@/lib/protocol";
import { PRESET_CHOICES as PRESETS, type PresetChoice } from "@shared/presets";
import { useDictation } from "@/lib/dictation";
import { askForNotificationsOnce, reconnectNow, unpair } from "@/lib/session";
import { cloudAvailable } from "@/lib/cloud";
import { takeShare } from "@/lib/sharedIn";
import { SendAppPanel } from "@/ui/SendApp";
import { appAction, getState, placeOf, useStore } from "@/lib/store";
import { canPin, dropPin, homeSections, slotAt, type Rect } from "@/lib/pins";
import { deleteApp, pinApp, setHidden, setPinned, unpinApp } from "@/lib/manage";
import { AppCredits, AppSigning, credits, PlaceMark } from "@/ui/CloudBits";
import { AppIcon } from "@/ui/AppIcon";
import { Button, IconButton } from "@/ui/Button";
import { DuplicatePanel, RenamePanel } from "@/ui/DuplicateRename";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { BrandLockup } from "@/ui/Brand";
import { ReminderBanner } from "@/ui/Trust";
import { UpdateNotice } from "@/ui/Updates";
import { LinkAskBanner } from "@/ui/LinkAsk";
import { MoveButton, moveLine } from "@/ui/Move";
import { GallerySection, GalleryTile } from "@/ui/Gallery";
import { loadGallery, useGallery } from "@/lib/gallery";
import { addToHomeScreen, canAddToHomeScreen, isWebOnly, openWebApp, shareAddress } from "@/lib/web";
import { border, elevation, icon, look, radius, size, space, useTheme } from "@/ui/theme";

/** COMPONENTS.md 3 and 4: the New app plus is 28, the sheet head icon 56 (no icon-size token for either). */
const NEW_TILE_PLUS = 28;
const SHEET_ICON = 56;
/** Large text settings grow the tile names up to this, then they shrink to fit. */
const TILE_TEXT_MAX_SCALE = 1.6;
/** The chat and options buttons on a tile: 48 dp, a bigger target than the 44 dp minimum. */
const TILE_BUTTON = 48;
/** A web app's globe mark on its icon, and the globe in it (no token this small). */
const WEB_MARK = 22;
const WEB_MARK_GLYPH = 13;

export default function Home() {
  const pairing = useStore((s) => s.pairing);
  const authLost = useStore((s) => s.authLost);
  const cloudAuth = useStore((s) => s.cloudAuth);
  const params = useLocalSearchParams<{ install?: string; update?: string; crash?: string; chat?: string }>();
  const apps = useStore((s) => s.apps);

  // Tapped "ready to install" notification: anyappagent://?install=<appId>
  useEffect(() => {
    if (params.install) {
      installFromLink(String(params.install));
      router.setParams({ install: undefined });
    }
  }, [params.install]);

  // An app's Reload popup (docs/FAST-LANE.md): anyappagent://?update=<its package>
  useEffect(() => {
    if (params.update) {
      updateFromLink(String(params.update));
      router.setParams({ update: undefined });
    }
  }, [params.update]);

  // Tapped "<app> crashed. Fix it?" (docs/VERSIONS.md): anyappagent://?crash=<package name> opens its chat.
  useEffect(() => {
    if (!params.crash) return;
    const app = Object.values(apps).find((a) => a.packageName === params.crash);
    if (!app) return;
    router.setParams({ crash: undefined });
    router.push(`/chat/${app.id}`);
  }, [params.crash, apps]);

  // An app's feedback screen ("Open chat") or its waiting-feedback notification:
  // anyappagent://?chat=<package name> opens that app's chat (waiting feedback is sent on the way in).
  useEffect(() => {
    if (!params.chat) return;
    const app = Object.values(apps).find((a) => a.packageName === params.chat);
    if (!app) return;
    router.setParams({ chat: undefined });
    router.push(`/chat/${app.id}`);
  }, [params.chat, apps]);

  // Shared into Kiwimake from another app ("Like this, but mine"): opens its screen.
  useEffect(() => {
    void takeShare();
  }, []);

  // First run (docs/CLOUD.md, "The phone app"): on a PC, in the cloud, or sign in. A phone with
  // only the PC sees today's screens; a build without a cloud goes straight to pairing.
  if (!pairing && cloudAuth === "loading") return null;
  if (!pairing && cloudAuth !== "signedIn") return <Redirect href={cloudAvailable ? "/welcome" : "/connect"} />;
  if (pairing && authLost && cloudAuth !== "signedIn") return <AuthLost />;
  return <AppGrid />;
}

/** One app being dragged (Pin, hide and delete): where it came from and where it would land. */
interface Drag {
  app: App;
  from: "pinned" | "rest";
  grabX: number; // the finger's place inside the tile
  grabY: number;
  height: number;
  target: { section: "pinned" | "rest"; index: number };
}

/** Held and not moved yet: a lift of the finger opens the options sheet; a move starts the drag. */
interface Armed {
  app: App;
  from: "pinned" | "rest";
  grabX: number;
  grabY: number;
  height: number;
  moved: boolean;
}

/** How close to the top or bottom edge a dragged tile scrolls the grid, and how fast. */
const EDGE = 72;
const EDGE_SPEED = 14;

function AppGrid() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const apps = useStore((s) => s.apps);
  const [selected, setSelected] = useState<{ id: string; manage: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [armed, setArmedState] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const armedRef = useRef<Armed | null>(null);
  const [pos] = useState(() => new Animated.ValueXY());
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const rootRef = useRef<React.ComponentRef<typeof View>>(null);
  const frame = useRef({ rootTop: 0, svTop: 0, svHeight: 0 });
  // Content coordinates of the sections and of each slot (index order), from onLayout.
  const layout = useRef({ pinnedY: 0, boundaryY: Number.POSITIVE_INFINITY, pinnedSlots: [] as Rect[] });
  const finger = useRef({ x: 0, y: 0 });
  // The PanResponder is made once: it reads the current Pinned section through this ref.
  const pinnedRef = useRef<string[]>([]);
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const { pinned, rest } = useMemo(() => homeSections(apps), [apps]);
  // Ready apps (docs/GALLERY.md): a tile next to Make a kiwi, and the apps themselves while Home is empty.
  const galleryCount = useGallery((s) => s.list?.apps.length ?? 0);
  const online = useStore((s) => s.connection === "online");
  useEffect(() => {
    void loadGallery();
  }, [online]);
  const pinnedNow = pinned.map((a) => a.id);
  // While dragging, the dragged tile stays where it is (dimmed: the view under the finger must stay
  // mounted, or Android drops the rest of the touch) and a dashed slot shows where it would land.
  const fromIndex = drag && drag.from === "pinned" ? pinnedNow.indexOf(drag.app.id) : -1;
  const at = drag && drag.target.section === "pinned" ? drag.target.index : -1;
  const landing = at < 0 || (fromIndex >= 0 && (at === fromIndex || at === fromIndex + 1)) ? -1 : at;
  const showPinned = pinned.length > 0 || !!drag;
  useLayoutEffect(() => {
    if (!showPinned) layout.current.boundaryY = Number.POSITIVE_INFINITY;
    // The pinned slots are read as they were when the drag started, so the landing slot moving
    // tiles around never changes the target under a still finger.
    if (!dragRef.current) layout.current.pinnedSlots.length = Math.max(pinned.length, 1);
    pinnedRef.current = pinnedNow;
  });
  const tileWidth = (width - size.screenGutter * 2 - size.gridGap) / 2;

  /** The target under the finger (window coordinates). */
  const targetAt = (pageX: number, pageY: number): Drag["target"] => {
    const contentY = pageY - frame.current.svTop + scrollY.current;
    const L = layout.current;
    if (contentY >= L.boundaryY) return { section: "rest", index: 0 };
    const slots = L.pinnedSlots.filter(Boolean).map((r) => ({ ...r, x: r.x + size.screenGutter, y: r.y + L.pinnedY }));
    const index = slotAt(slots, pageX, contentY);
    return { section: "pinned", index: Math.max(0, index) };
  };

  const follow = (pageX: number, pageY: number) => {
    finger.current = { x: pageX, y: pageY };
    const d = dragRef.current;
    if (!d) return;
    pos.setValue({ x: pageX - d.grabX, y: pageY - d.grabY - frame.current.rootTop });
    const target = targetAt(pageX, pageY);
    if (target.section !== d.target.section || target.index !== d.target.index) setDrag({ ...d, target });
  };

  const stopEdge = () => {
    if (edgeTimer.current) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };
  const edgeScroll = (pageY: number) => {
    const { svTop, svHeight } = frame.current;
    const dir = pageY < svTop + EDGE ? -1 : pageY > svTop + svHeight - EDGE ? 1 : 0;
    if (dir === 0) return stopEdge();
    if (edgeTimer.current) return;
    edgeTimer.current = setInterval(() => {
      const next = Math.max(0, scrollY.current + dir * EDGE_SPEED);
      scrollRef.current?.scrollTo({ y: next, animated: false });
      scrollY.current = next;
      follow(finger.current.x, finger.current.y);
      const y = finger.current.y;
      if (!(y < svTop + EDGE || y > svTop + svHeight - EDGE)) stopEdge();
    }, 16);
  };

  const finish = (commit: boolean) => {
    stopEdge();
    const d = dragRef.current;
    armedRef.current = null;
    setArmedState(false);
    setDrag(null);
    if (!commit || !d) return;
    const now = pinnedRef.current;
    const next = d.target.section === "pinned" ? dropPin(now, d.app.id, d.target.index) : d.from === "pinned" ? dropPin(now, d.app.id, null) : now;
    if (next.join() === now.join()) return;
    AnyAppNative?.haptic?.();
    void setPinned(next).catch(() => undefined);
  };

  // Made once. Its handlers only read refs when a touch moves, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      // After a long press, the first real move takes the touch from the tile and starts the drag.
      onMoveShouldSetPanResponderCapture: (e) => {
        const a = armedRef.current;
        if (!a || dragRef.current) return !!dragRef.current;
        const { pageX, pageY } = e.nativeEvent;
        if (Math.hypot(pageX - finger.current.x, pageY - finger.current.y) < 6) return false;
        a.moved = true;
        setDrag({ app: a.app, from: a.from, grabX: a.grabX, grabY: a.grabY, height: a.height, target: { section: a.from, index: a.from === "pinned" ? Math.max(0, pinnedRef.current.indexOf(a.app.id)) : 0 } });
        follow(pageX, pageY);
        return true;
      },
      onPanResponderMove: (e) => {
        follow(e.nativeEvent.pageX, e.nativeEvent.pageY);
        edgeScroll(e.nativeEvent.pageY);
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => finish(true),
      onPanResponderTerminate: () => finish(false),
    }),
  );

  /**
   * One tap: open the app when it is on this phone. Not on it yet but built: start the install
   * (the tile says "Tap to install", then shows the download). Anything else (busy installing,
   * failed, no version yet, can't be launched, an old copy in the way): the options sheet, which
   * says why and what to do.
   */
  const tapApp = (app: App) => {
    // A web app (docs/WEB-APPS.md): never installed; it opens in Kiwimake once it has a version.
    if (isWebOnly(app)) {
      if (appAction(app, undefined) === "open") openWebApp(app);
      else setSelected({ id: app.id, manage: false });
      return;
    }
    const s = getState();
    const install = s.installs[app.id];
    const pkg = s.packages[app.packageName];
    const busy = !!install && ["waiting", "downloading", "checking", "installing", "confirm"].includes(install.phase);
    // An old copy signed with another key: the sheet says why and offers to remove it, instead
    // of opening the old copy as if all were well.
    if (pkg && !install?.conflict && launchApp(app)) return;
    if (!pkg && !busy && install?.phase !== "failed" && appAction(app, pkg) === "install") {
      void installApp(app);
      return;
    }
    setSelected({ id: app.id, manage: false });
  };

  /** Hold: pinnable apps can then be dragged; lifting the finger without moving opens the options. */
  const hold = (app: App, from: "pinned" | "rest", e: GestureResponderEvent | undefined, height: number) => {
    AnyAppNative?.haptic?.();
    if (!e || !canPin(app) || !getState().client) {
      setSelected({ id: app.id, manage: false });
      return;
    }
    const { pageX, pageY, locationX, locationY } = e.nativeEvent;
    finger.current = { x: pageX, y: pageY };
    armedRef.current = { app, from, grabX: locationX, grabY: locationY, height, moved: false };
    setArmedState(true); // the grid stops scrolling, so the move reaches the drag
  };
  const release = (app: App) => {
    const a = armedRef.current;
    if (!a || a.app.id !== app.id || a.moved) return;
    armedRef.current = null;
    setArmedState(false);
    setSelected({ id: app.id, manage: false });
  };

  const tileHeights = useRef<Record<string, number>>({});
  const renderTile = (app: App, from: "pinned" | "rest", index: number) => {
    const onLayout = (e: LayoutChangeEvent) => {
      const l = e.nativeEvent.layout;
      tileHeights.current[app.id] = l.height;
      if (from === "pinned" && !dragRef.current) layout.current.pinnedSlots[index] = { x: l.x, y: l.y, width: l.width, height: l.height };
    };
    return (
      <View key={app.id} onLayout={onLayout} style={{ width: tileWidth, opacity: drag?.app.id === app.id ? 0.35 : 1 }}>
        <AppTile
          app={app}
          width={tileWidth}
          pinned={from === "pinned"}
          onPress={() => tapApp(app)}
          onLongPress={(e) => hold(app, from, e, tileHeights.current[app.id] ?? size.tileMinHeight)}
          onPressOut={() => release(app)}
          onOptions={() => setSelected({ id: app.id, manage: false })}
          onChat={() => router.push(`/chat/${app.id}`)}
        />
      </View>
    );
  };

  return (
    <View
      ref={rootRef}
      style={{ flex: 1, paddingTop: insets.top }}
      onLayout={() => rootRef.current?.measureInWindow((_x, y) => (frame.current.rootTop = y))}
      {...pan.panHandlers}
    >
      <ScrollView
        ref={scrollRef}
        scrollEnabled={!armed && !drag}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        onLayout={(e) => {
          frame.current.svHeight = e.nativeEvent.layout.height;
          scrollRef.current?.measureInWindow?.((_x, y) => (frame.current.svTop = y));
        }}
        contentContainerStyle={{ paddingHorizontal: size.screenGutter, paddingBottom: insets.bottom + space["2xl"] }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reconnectNow} colors={[t.text]} progressBackgroundColor={t.surface} />}
      >
        <Header />
        <UpdateNotice />
        <ReminderBanner />
        <LinkAskBanner />
        {showPinned ? <SectionLabel testID="pinned-label">Pinned</SectionLabel> : null}
        {showPinned ? (
          <View testID="pinned-section" onLayout={(e) => (layout.current.pinnedY = e.nativeEvent.layout.y)} style={{ flexDirection: "row", flexWrap: "wrap", gap: size.gridGap }}>
            {pinned.length > 0 ? (
              withLanding(
                pinned.map((app, i) => renderTile(app, "pinned", i)),
                landing,
                <Slot key="landing" width={tileWidth} height={drag?.height ?? size.tileMinHeight} />,
              )
            ) : (
              <Slot
                width={tileWidth}
                height={drag?.height ?? size.tileMinHeight}
                label="Drop here to pin"
                onLayout={(e) => {
                  const l = e.nativeEvent.layout;
                  layout.current.pinnedSlots[0] = { x: l.x, y: l.y, width: l.width, height: l.height };
                }}
              />
            )}
          </View>
        ) : null}
        {showPinned ? (
          <SectionLabel testID="all-apps-label" onLayout={(e) => (layout.current.boundaryY = e.nativeEvent.layout.y)} top>
            All apps
          </SectionLabel>
        ) : null}
        <View testID="apps-section" style={{ flexDirection: "row", flexWrap: "wrap", gap: size.gridGap }}>
          {rest.map((app, i) => renderTile(app, "rest", i))}
          <NewTile width={tileWidth} onPress={() => setCreating(true)} />
          {galleryCount > 0 ? <GalleryTile width={tileWidth} count={galleryCount} /> : null}
        </View>
        {pinned.length + rest.length === 0 ? <GallerySection /> : null}
      </ScrollView>
      {drag ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, top: 0, width: tileWidth, transform: [{ translateX: pos.x }, { translateY: pos.y }, { scale: 1.04 }], ...elevation(t.mode, 3), opacity: 0.97 }}
        >
          <AppTile app={drag.app} width={tileWidth} pinned={drag.target.section === "pinned"} onPress={() => {}} onLongPress={() => {}} onOptions={() => {}} onChat={() => {}} />
        </Animated.View>
      ) : null}
      <AppSheet selection={selected} onClose={() => setSelected(null)} />
      <NewAppSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

/** The tiles with the landing slot put in at its place (none when index is -1). */
function withLanding(tiles: React.ReactNode[], index: number, slot: React.ReactNode): React.ReactNode[] {
  if (index < 0) return tiles;
  const at = Math.min(index, tiles.length);
  return [...tiles.slice(0, at), slot, ...tiles.slice(at)];
}

/** "Pinned" and "All apps" over the two parts of the grid. */
function SectionLabel({ children, top, testID, onLayout }: { children: string; top?: boolean; testID?: string; onLayout?: (e: LayoutChangeEvent) => void }) {
  return (
    <T testID={testID} variant="eyebrow" color="textTertiary" onLayout={onLayout} style={{ marginTop: top ? space["2xl"] : 0, marginBottom: space.md, paddingHorizontal: space.xs }}>
      {children}
    </T>
  );
}

/** Where a dragged app would land (or the empty Pinned section): a dashed slot of a tile's size. */
function Slot({ width, height, label, onLayout }: { width: number; height: number; label?: string; onLayout?: (e: LayoutChangeEvent) => void }) {
  const t = useTheme();
  return (
    <View
      onLayout={onLayout}
      style={{ width, height, borderRadius: radius.tile, borderWidth: border.tileWidth, borderStyle: "dashed", borderColor: t.tileNewBorder, alignItems: "center", justifyContent: "center", padding: look.tilePadding }}
    >
      {label ? (
        <T variant="label" color="textSecondary" style={{ textAlign: "center" }}>
          {label}
        </T>
      ) : null}
    </View>
  );
}

function Header() {
  const t = useTheme();
  const connection = useStore((s) => s.connection);
  const paired = useStore((s) => !!s.pairing);
  const cloudOn = useStore((s) => s.cloudAuth === "signedIn");
  const loaded = useStore((s) => s.appsLoaded);
  // Don't flash "can't reach" for a quick reconnect.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (connection === "online") return;
    const timer = setTimeout(() => setSlow(true), loaded ? 2500 : 600);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [connection, loaded]);
  return (
    <View style={{ paddingTop: space.md, paddingBottom: space.xl }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginRight: -space.md }}>
        <View style={{ flex: 1 }}><BrandLockup /></View>
        {cloudAvailable ? (
          <IconButton testID="open-account" icon={CircleUser} label="Kiwimake account" iconSize={icon.size.md} color={t.textSecondary} onPress={() => router.push("/account")} />
        ) : null}
        <IconButton testID="open-settings" icon={Settings} label="Settings" iconSize={icon.size.md} color={t.textSecondary} onPress={() => router.push("/settings")} />
      </View>
      <T variant="display" style={{ marginTop: space.xl }}>
        Your apps
      </T>
      <Pressable testID="connection-state" onPress={reconnectNow} style={{ marginTop: space.sm, minHeight: size.touch / 2, justifyContent: "center" }}>
        {!paired ? (
          cloudOn ? <StateLine kind="ready" label="Making apps in the cloud" quietText /> : null
        ) : connection === "online" ? (
          <StateLine kind="ready" label="Connected to your PC" quietText />
        ) : !slow || connection === "connecting" ? (
          <StateLine kind="working" label="Connecting to your PC" quietText />
        ) : (
          <StateLine kind="problem" label="Can't reach your PC. Tap to try again." lines={2} />
        )}
      </Pressable>
    </View>
  );
}

function TileStateLine({ app }: { app: App }) {
  const pkg = useStore((s) => s.packages[app.packageName]);
  const install = useStore((s) => s.installs[app.id]);
  const line = tileState(app, pkg, install);
  return <StateLine testID={`app-state-${app.slug}`} kind={line.kind} label={line.label} attention={line.attention} fit />;
}

/** Tiles: scale to 0.98 while pressed (COMPONENTS.md 3). */
function PressScale({
  onPress,
  onLongPress,
  onPressOut,
  children,
  style,
  testID,
  label,
  hint,
}: {
  onPress: () => void;
  /** No event: TalkBack's "Options" action. */
  onLongPress?: (e?: GestureResponderEvent) => void;
  onPressOut?: () => void;
  children: React.ReactNode;
  style: object;
  testID?: string;
  label: string;
  hint?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityActions={onLongPress ? [{ name: "longpress", label: "Options" }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "longpress") onLongPress?.();
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => {
        setPressed(false);
        onPressOut?.();
      }}
      style={[style, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}

/** A round button on a tile (chat, options): 48 dp, a quiet filled circle so it reads as a button. */
function TileButton({ icon: Icon, label, onPress, testID }: { icon: typeof MessageCircle; label: string; onPress: () => void; testID: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: TILE_BUTTON,
        height: TILE_BUTTON,
        borderRadius: radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.borderStrong : t.surfaceSunken,
      })}
    >
      <Icon size={icon.size.md} color={t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
    </Pressable>
  );
}

function AppTile({
  app,
  width,
  onPress,
  onLongPress,
  onPressOut,
  onOptions,
  onChat,
}: {
  app: App;
  width: number;
  pinned?: boolean;
  onPress: () => void;
  onLongPress: (e?: GestureResponderEvent) => void;
  onPressOut?: () => void;
  onOptions: () => void;
  onChat: () => void;
}) {
  const t = useTheme();
  const webOnly = isWebOnly(app);
  const pkgOnPhone = useStore((s) => s.packages[app.packageName]);
  const pkg = webOnly ? undefined : pkgOnPhone;
  const line = tileState(app, pkg, useStore((s) => s.installs[app.id]));
  const label = webOnly
    ? appAction(app, undefined) === "open" ? `Open ${app.name}, web app, ${line.label}` : `${app.name}, web app, ${line.label}`
    : pkg ? `Open ${app.name}` : line.label === "Tap to install" ? `Install ${app.name}` : `${app.name}, ${line.label}`;
  // Where it is made shows only when the person has both places (docs/CLOUD.md, "One grid").
  const bothPlaces = useStore((s) => !!s.pairing && s.cloudAuth === "signedIn");
  const pcOnline = useStore((s) => s.connection === "online");
  return (
    <PressScale
      testID={`app-tile-${app.slug}`}
      label={label}
      hint={canPin(app) ? "Hold for options, or hold and drag to pin" : "Hold for options"}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      style={{
        width,
        minHeight: size.tileMinHeight,
        borderRadius: radius.tile,
        backgroundColor: t.tileBg,
        borderWidth: border.width,
        borderColor: t.tileBorder,
        padding: look.tilePadding,
        alignItems: look.tileAlign,
        ...elevation(t.mode, look.tileElevation as 1),
      }}
    >
      <View>
        <AppIcon app={app} size={size.appIcon} />
        {webOnly ? <WebMark /> : null}
      </View>
      <T
        variant="name"
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        maxFontSizeMultiplier={TILE_TEXT_MAX_SCALE}
        // Android shrinks the letters, not the fixed line height: let the line follow the letters.
        style={{ marginTop: space.md, textAlign: look.tileTextAlign, lineHeight: undefined }}
      >
        {app.name}
      </T>
      <View style={{ flex: 1, minHeight: space.xs }} />
      {bothPlaces ? <PlaceMark place={placeOf(app)} off={placeOf(app) === "pc" && !pcOnline} /> : null}
      <TileStateLine app={app} />
      {/* Design rule (AGENTS.md): the words keep the tile's full width; its buttons sit below them, on the right. */}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.sm, alignSelf: "stretch" }}>
        <TileButton testID={`app-chat-${app.slug}`} icon={MessageCircle} label={`Chat about ${app.name}`} onPress={onChat} />
        <TileButton testID={`app-options-${app.slug}`} icon={EllipsisVertical} label={`${app.name} options`} onPress={onOptions} />
      </View>
    </PressScale>
  );
}

/** A web app's small globe on the corner of its icon (docs/WEB-APPS.md). */
function WebMark() {
  const t = useTheme();
  const d = WEB_MARK;
  return (
    <View
      testID="app-web-mark"
      pointerEvents="none"
      style={{ position: "absolute", right: -d / 4, bottom: -d / 4, width: d, height: d, borderRadius: radius.full, backgroundColor: t.surface, borderWidth: border.width, borderColor: t.border, alignItems: "center", justifyContent: "center" }}
    >
      <Globe size={WEB_MARK_GLYPH} color={t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
    </View>
  );
}

function NewTile({ width, onPress }: { width: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <PressScale
      testID="new-app"
      label="Make a kiwi"
      onPress={onPress}
      style={{
        width,
        minHeight: size.tileMinHeight,
        borderRadius: radius.tile,
        borderWidth: border.tileWidth,
        borderStyle: border.tileNewStyle,
        borderColor: t.tileNewBorder,
        backgroundColor: t.tileNewBg,
        padding: look.tilePadding,
        alignItems: look.tileAlign,
      }}
    >
      <View style={{ width: size.appIcon, height: size.appIcon, borderRadius: radius.appIcon, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
        <Plus size={NEW_TILE_PLUS} color={t.onAccent} strokeWidth={icon.stroke} absoluteStrokeWidth />
      </View>
      <T variant="name" style={{ marginTop: space.md }}>
        Make a kiwi
      </T>
      <View style={{ flex: 1, minHeight: space.xs }} />
      <T variant="label" color="textSecondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        Describe your idea
      </T>
    </PressScale>
  );
}

// ---------- tap an app: Install / Open / Change it

function AppSheet({ selection, onClose }: { selection: { id: string; manage: boolean } | null; onClose: () => void }) {
  const t = useTheme();
  const app = useStore((s) => (selection ? s.apps[selection.id] : undefined));
  // A web app (docs/WEB-APPS.md) is never on the phone as a package, whatever its name matches.
  const pkg = useStore((s) => (app && !isWebOnly(app) ? s.packages[app.packageName] : undefined));
  const install = useStore((s) => (app ? s.installs[app.id] : undefined));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [sending, setSending] = useState(false);
  // Duplicate and Rename (an app's options): a panel in place of the buttons.
  const [panel, setPanel] = useState<"duplicate" | "rename" | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const online = useStore((s) => s.connection === "online");
  // Keep showing the app while the sheet slides away; reset the mode for each new selection.
  const [lastApp, setLastApp] = useState<App | undefined>(app);
  if (app && app !== lastApp) setLastApp(app);
  const [lastSelection, setLastSelection] = useState(selection);
  if (selection !== lastSelection) {
    setLastSelection(selection);
    setConfirmRemove(!!selection?.manage);
    setSending(false);
    setPanel(null);
    setProblem(null);
  }
  const shown = app ?? lastApp;

  const action = shown ? appAction(shown, pkg) : "notReady";
  const installing = !!install && ["waiting", "downloading", "checking", "installing", "confirm"].includes(install.phase);
  const oldCopyInTheWay = hasOldCopyInTheWay(install);
  const state = shown ? describeApp(shown, pkg, install) : null;
  const doInstall = () => shown && void installApp(shown);
  const doOpen = () => {
    if (!shown) return;
    onClose();
    if (isWebOnly(shown)) return openWebApp(shown);
    if (!launchApp(shown)) AnyAppNative?.openAppSettings(shown.packageName);
  };
  const webOnly = !!shown && isWebOnly(shown);
  const webAddress = shown?.web?.liveBuild ? shown.web.address : undefined;
  const [pinning, setPinning] = useState(false);
  const doAddToHome = async () => {
    if (!shown) return;
    setPinning(true);
    setProblem(null);
    const trouble = await addToHomeScreen(shown);
    setPinning(false);
    if (trouble) setProblem(trouble);
    else onClose();
  };
  const doChange = () => {
    if (!shown) return;
    onClose();
    router.push(`/chat/${shown.id}`);
  };
  const doTodo = () => {
    if (!shown) return;
    onClose();
    router.push(`/todo/${shown.id}`);
  };
  const todoLabel = shown?.openTodos ? `To-do (${shown.openTodos})` : "To-do";
  const doShare = () => {
    if (!shown) return;
    onClose();
    router.push(`/share/${shown.id}`);
  };
  // "From others" (docs/CHANGE-THIS-APP.md): suggestions people sent about this app.
  const doOthers = () => {
    if (!shown) return;
    onClose();
    router.push(`/suggestions/${shown.id}`);
  };
  const othersLabel = shown?.fromOthers ? `From others (${shown.fromOthers})` : "From others";

  return (
    <Sheet visible={!!selection && !!app} onClose={onClose}>
      {shown ? (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.xl }}>
            <AppIcon app={shown} size={SHEET_ICON} />
            <View style={{ flex: 1, gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <T variant="titleSmall" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {shown.name}
                </T>
                {canPin(shown) && !panel && !confirmRemove && !sending ? (
                  <IconButton testID="app-rename-pencil" icon={Pencil} label={`Rename ${shown.name}`} iconSize={icon.size.sm} color={t.textTertiary} onPress={() => setPanel("rename")} />
                ) : null}
              </View>
              {state ? <StateLine kind={state.kind} label={state.label} /> : null}
              {placeOf(shown) === "cloud" ? <AppCredits appId={shown.id} /> : null}
              {placeOf(shown) === "cloud" ? <AppSigning appId={shown.id} /> : null}
              {moveLine(shown) ? (
                <T variant="caption" color={moveLine(shown)!.problem ? "problem" : "textSecondary"} testID="app-move-line">
                  {moveLine(shown)!.text}
                </T>
              ) : null}
            </View>
          </View>
          {panel === "duplicate" && !confirmRemove ? (
            <DuplicatePanel app={shown} onDone={onClose} onCancel={() => setPanel(null)} />
          ) : panel === "rename" && !confirmRemove ? (
            <RenamePanel app={shown} onDone={onClose} onCancel={() => setPanel(null)} />
          ) : sending && !confirmRemove ? (
            <SendAppPanel app={shown} onDone={onClose} onCancel={() => setSending(false)} />
          ) : confirmRemove ? (
            <DeletePanel app={shown} installed={!!pkg} onDone={onClose} onCancel={() => (selection?.manage ? onClose() : setConfirmRemove(false))} />
          ) : (
            <View style={{ gap: space.sm }}>
              {install?.phase === "failed" && !webOnly ? <InstallFailure message={install.message} /> : null}
              {webOnly ? (
                // A web app: nothing to install; Open runs it in Kiwimake (docs/WEB-APPS.md).
                action === "open" ? (
                  <>
                    <Button testID="app-primary" label="Open" icon={Globe} onPress={doOpen} />
                    <Button testID="app-change" label="Change it" icon={MessageCircle} variant="quiet" onPress={doChange} />
                  </>
                ) : (
                  <Button testID="app-change" label="Change it" icon={MessageCircle} onPress={doChange} />
                )
              ) : oldCopyInTheWay ? (
                <>
                  {/* An old copy with another key in the way: Install would only fail again (describe.ts). */}
                  <Button testID="app-primary" label={REMOVE_OLD_AND_INSTALL} icon={Download} onPress={() => removeOldAndInstall(shown)} />
                  {pkg ? <Button testID="app-open" label="Open" icon={Smartphone} variant="quiet" onPress={doOpen} /> : null}
                  <Button testID="app-change" label="Change it" icon={MessageCircle} variant="quiet" onPress={doChange} />
                </>
              ) : action === "install" || action === "update" || installing ? (
                <>
                  <Button
                    testID="app-primary"
                    label={
                      installing ? (installLabel(install) ?? "Installing") : actionLabel(action, shown.latestApk?.number)
                    }
                    icon={Download}
                    busy={installing}
                    onPress={doInstall}
                  />
                  {pkg ? <Button testID="app-open" label="Open" icon={Smartphone} variant="quiet" onPress={doOpen} /> : null}
                  <Button testID="app-change" label="Change it" icon={MessageCircle} variant="quiet" onPress={doChange} />
                </>
              ) : action === "open" ? (
                <>
                  <Button testID="app-primary" label="Open" icon={Smartphone} onPress={doOpen} />
                  <Button testID="app-change" label="Change it" icon={MessageCircle} variant="quiet" onPress={doChange} />
                </>
              ) : (
                <Button testID="app-change" label="Change it" icon={MessageCircle} onPress={doChange} />
              )}
              <Button testID="app-todo" label={todoLabel} icon={ListTodo} variant="quiet" onPress={doTodo} />
              <Button testID="app-others" label={othersLabel} icon={Inbox} variant="quiet" onPress={doOthers} />
              {pkg && AnyAppNative?.shareApk ? <Button testID="app-send" label="Send app" icon={Send} variant="quiet" onPress={() => setSending(true)} /> : null}
              {shown.latestApk && !webOnly ? <Button testID="app-share" label={shown.sharing?.shared ? "Shared" : "Share"} icon={Share2} variant="quiet" onPress={doShare} /> : null}
              {/* Web apps (docs/WEB-APPS.md): its link, its own icon on the home screen; the web version of an app with both. */}
              {webOnly && webAddress ? <Button testID="app-share-link" label="Share link" icon={Share2} variant="quiet" onPress={() => shareAddress(webAddress, shown.name)} /> : null}
              {webOnly && action === "open" && canAddToHomeScreen() ? (
                <Button testID="app-add-home" label="Add to home screen" icon={HousePlus} variant="quiet" busy={pinning} onPress={() => void doAddToHome()} />
              ) : null}
              {!webOnly && shown.web ? (
                <Button
                  testID="app-open-web"
                  label="Open the web version"
                  icon={Globe}
                  variant="quiet"
                  onPress={() => {
                    onClose();
                    openWebApp(shown);
                  }}
                />
              ) : null}
              {pkg && action === "update" ? (
                <T variant="caption" color="textSecondary" style={{ textAlign: "center", marginTop: space.xs }}>
                  {`Version ${pkg.versionCode} is on this phone.`}
                </T>
              ) : null}
              <MoveButton app={shown} onMoved={onClose} />
              {problem ? (
                <T variant="caption" color="problem" style={{ textAlign: "center" }}>
                  {problem}
                </T>
              ) : null}
              {/* Pin, hide, Duplicate, Rename and Delete: these live on the PC, so cloud apps only get Delete. */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: space.xl, rowGap: space.md, marginTop: space.md }}>
                {canPin(shown) ? (
                  <Button
                    testID="app-pin"
                    label={shown.pin !== undefined ? "Unpin" : "Pin to top"}
                    variant="text"
                    small
                    disabled={!online || pinBusy}
                    onPress={async () => {
                      setPinBusy(true);
                      setProblem(null);
                      try {
                        await (shown.pin !== undefined ? unpinApp(shown) : pinApp(shown));
                        onClose();
                      } catch {
                        setProblem("Your PC couldn't pin it. Update Kiwimake on your PC and try again.");
                      } finally {
                        setPinBusy(false);
                      }
                    }}
                  />
                ) : null}
                {canPin(shown) ? (
                  <Button
                    testID="app-hide"
                    label="Hide"
                    variant="text"
                    small
                    disabled={!online}
                    onPress={async () => {
                      setProblem(null);
                      try {
                        await setHidden(shown, true);
                        onClose();
                      } catch {
                        setProblem("Your PC couldn't hide it. Update Kiwimake on your PC and try again.");
                      }
                    }}
                  />
                ) : null}
                {canPin(shown) ? (
                  <Button testID="app-duplicate" label="Duplicate" variant="text" small disabled={!online || shown.status === "creating"} onPress={() => setPanel("duplicate")} />
                ) : null}
                {canPin(shown) ? <Button testID="app-rename" label="Rename" variant="text" small disabled={!online} onPress={() => setPanel("rename")} /> : null}
                <Button testID="app-remove" label="Delete" variant="text" small onPress={() => setConfirmRemove(true)} />
              </View>
            </View>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

/**
 * Delete (Pin, hide and delete): where it goes from. The app list always; this phone and the PC
 * with GitHub by choice. The first two come back from Recently deleted; the third can't.
 */
function DeletePanel({ app, installed, onDone, onCancel }: { app: App; installed: boolean; onDone: () => void; onCancel: () => void }) {
  const cloud = placeOf(app) === "cloud";
  const [uninstall, setUninstall] = useState(false);
  const [forGood, setForGood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await deleteApp(app, { uninstall: uninstall && installed, forGood: forGood && !cloud });
      if (result?.problem) {
        setProblem(result.problem);
        setFinished(true);
      } else onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID="delete-panel">
      <T variant="heading">{`Delete ${app.name}?`}</T>
      <T variant="callout" color="textSecondary" style={{ marginTop: space.xs, marginBottom: space.md }}>
        {cloud
          ? "Choose where to delete it from. Its code stays on your GitHub."
          : "Choose where to delete it from. The app list and this phone can be restored from Recently deleted in Settings. PC and GitHub can't be undone."}
      </T>
      <DeleteToggle testID="delete-list" label="App list" sub={cloud ? "It leaves your app list." : "It moves to Recently deleted in Settings."} value disabled />
      {/* A web app (docs/WEB-APPS.md) is never installed: nothing to remove from the phone. */}
      {isWebOnly(app) ? null : (
        <DeleteToggle
          testID="delete-phone"
          label="This phone"
          sub={installed ? "Uninstalls it. Android asks you first." : "It's not on this phone."}
          value={uninstall && installed}
          disabled={!installed || finished}
          onChange={setUninstall}
        />
      )}
      {cloud ? null : (
        <DeleteToggle testID="delete-pc" label="PC and GitHub" sub="Deletes its chat, files and code for good." value={forGood} disabled={finished} onChange={setForGood} />
      )}
      {problem ? (
        <T variant="callout" color="problem" style={{ marginTop: space.md }} testID="delete-problem">
          {problem}
        </T>
      ) : null}
      {/* Design rule (AGENTS.md): the words keep the full width; the buttons sit below them, on the right. */}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.xl }}>
        {finished ? (
          <Button testID="delete-close" label="Close" variant="quiet" small onPress={onDone} />
        ) : (
          <>
            <Button testID="delete-cancel" label="Cancel" variant="quiet" small onPress={onCancel} />
            <Button testID="confirm-remove" label={forGood && !cloud ? "Delete for good" : "Delete"} variant="problem" small busy={busy} onPress={run} />
          </>
        )}
      </View>
    </View>
  );
}

function DeleteToggle({ label, sub, value, disabled, onChange, testID }: { label: string; sub: string; value: boolean; disabled?: boolean; onChange?: (v: boolean) => void; testID: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={`${label}. ${sub}`}
      disabled={disabled}
      onPress={() => onChange?.(!value)}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.rowHeight, paddingVertical: space.sm, borderTopWidth: border.width, borderColor: t.border }}
    >
      <View style={{ flex: 1, gap: space.hair }}>
        <T variant="label" color={disabled && !value ? "textTertiary" : "text"}>
          {label}
        </T>
        <T variant="caption" color="textSecondary">
          {sub}
        </T>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: t.borderStrong, true: t.problem }}
        thumbColor={t.surfaceOverlay}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

/** Why the last install failed. An old copy in the way gets its button as the sheet's main action. */
export function InstallFailure({ message }: { message?: string }) {
  const t = useTheme();
  return (
    <View style={{ borderRadius: radius.card, backgroundColor: t.problemSoft, padding: space.md, gap: space.xs, marginBottom: space.xs }}>
      <T variant="row" color="problem">
        {message ?? "It didn't install."}
      </T>
    </View>
  );
}

// ---------- New app

function NewAppSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const pcClient = useStore((s) => s.client);
  const cloudClient = useStore((s) => s.cloudClient);
  const paired = useStore((s) => !!s.pairing);
  const pcOnline = useStore((s) => s.connection === "online");
  const account = useStore((s) => s.account);
  // "Make it on: My PC | Cloud" (docs/CLOUD.md, "One grid"): only when both places exist; the PC
  // when it is on, else the cloud.
  const both = paired && !!cloudClient;
  const [chosenPlace, setChosenPlace] = useState<"pc" | "cloud" | null>(null);
  const place: "pc" | "cloud" = !paired ? "cloud" : !cloudClient ? "pc" : (chosenPlace ?? (pcOnline ? "pc" : "cloud"));
  const client = place === "cloud" ? cloudClient : pcClient;
  const needsGithub = place === "cloud" && !account?.cloud.github?.connected;
  const [name, setName] = useState("");
  const care = useStore((s) => s.care);
  const [prompt, setPrompt] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [preset, setPreset] = useState<AppPreset>("react-native");
  const [askMore, setAskMore] = useState(false);
  const promptRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // Dictation into "What should it do?" (src/lib/dictation.ts); it never makes the app by itself.
  const dictation = useDictation({ value: prompt, onChange: setPrompt });
  const listening = dictation.phase === "listening";
  const { cancel: cancelDictation } = dictation;
  useEffect(() => {
    if (!visible) cancelDictation();
  }, [visible, cancelDictation]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0 && prompt.trim().length > 0;

  const submit = async () => {
    if (!client || !ready) return;
    dictation.cancel();
    setBusy(true);
    setError(null);
    try {
      // The default is left out of the request, so an older PC companion still accepts it.
      if (needsGithub) {
        onClose();
        router.push("/github");
        return;
      }
      const app = await client.createApp({ name: name.trim(), prompt: prompt.trim(), ...(preset !== "react-native" && place === "pc" ? { preset } : {}), ...(askMore ? { askMore: true } : {}) });
      useStore.setState((s) => ({ apps: { ...s.apps, [app.id]: app } }));
      setName("");
      setPrompt("");
      setAdvanced(false);
      setPreset("react-native");
      setAskMore(false);
      onClose();
      void askForNotificationsOnce();
      router.push(`/chat/${app.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T variant="titleSmall" style={{ marginBottom: space.xl }}>
        Make a kiwi
      </T>
      <Field testID="new-app-name" label="Name" value={name} onChangeText={setName} placeholder="For example, Prayer Times" maxLength={40} autoCapitalize="words" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => promptRef.current?.focus()} />
      <Field
        testID="new-app-prompt"
        ref={promptRef}
        label="What should it do?"
        value={prompt}
        onChangeText={setPrompt}
        placeholder={listening ? "Listening..." : "Wake me up for each prayer in Ajman, with a reminder before it."}
        multiline
        containerStyle={{ marginTop: space.lg }}
        inputStyle={listening ? { borderWidth: border.focusWidth, borderColor: t.problem } : undefined}
        dictation={dictation}
        micTestID="new-app-mic"
      />
      {both ? <MakeItOn place={place} onChange={setChosenPlace} pcOnline={pcOnline} /> : null}
      <AskMore value={askMore} onChange={setAskMore} />
      {place === "pc" ? <Advanced open={advanced} onToggle={() => setAdvanced(!advanced)} preset={preset} onPreset={setPreset} /> : null}
      {place === "cloud" ? (
        <T testID="new-app-cloud-note" variant="caption" color="textSecondary" style={{ marginTop: space.lg }}>
          {needsGithub
            ? "Made in the cloud: connect GitHub first, where its code is kept."
            : account?.plan.id === "ownKey"
              ? "Made in the cloud, on your own Claude key."
              : (account?.credits ?? 0) > 0
                ? `Made in the cloud. You have ${credits(Math.round((account?.credits ?? 0) * 1000))}.`
                : "Made in the cloud. Every month starts with 3 free credits, enough for a first app."}
        </T>
      ) : null}
      {error ? (
        <T variant="caption" color="problem" style={{ marginTop: space.sm }}>
          {error}
        </T>
      ) : null}
      {ready && place === "pc" ? (
        <T testID="new-app-heads-up" variant="caption" color="textSecondary" style={{ marginTop: space.lg }}>
          {bigJobHeadsUp({ text: prompt, newApp: true, usage: care?.usage })?.body}
        </T>
      ) : null}
      <Button testID="new-app-submit" label={needsGithub ? "Connect GitHub first" : "Make it"} style={{ marginTop: space.md }} disabled={!ready && !needsGithub} busy={busy} onPress={submit} />
      {!ready ? (
        <T variant="caption" color="textSecondary" style={{ marginTop: space.sm, textAlign: "center" }}>
          Give it a name and say what it should do.
        </T>
      ) : null}
    </Sheet>
  );
}

/** Where a new app is made, when the person has both a PC and the cloud. */
function MakeItOn({ place, onChange, pcOnline }: { place: "pc" | "cloud"; onChange: (p: "pc" | "cloud") => void; pcOnline: boolean }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: space.lg, gap: space.sm }}>
      <T variant="label">Make it on</T>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {(["pc", "cloud"] as const).map((p) => (
          <Pressable
            key={p}
            testID={`new-app-on-${p}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: place === p }}
            onPress={() => onChange(p)}
            style={{
              flex: 1,
              minHeight: size.touch,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.button,
              borderWidth: border.width,
              borderColor: place === p ? t.accent : t.border,
              backgroundColor: place === p ? t.selectedBg : t.surface,
            }}
          >
            <T variant="buttonSmall">{p === "pc" ? (pcOnline ? "My PC" : "My PC (off)") : "Cloud"}</T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** "Ask me more": the agent asks a few questions about the app before it plans it. */
function AskMore({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable
      testID="new-app-ask-more"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel="Ask me more. The agent asks you a few questions about the app before it plans it."
      onPress={() => onChange(!value)}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.lg, minHeight: size.touch }}
    >
      <View style={{ flex: 1, gap: space.hair }}>
        <T variant="label">Ask me more</T>
        <T variant="caption" color="textSecondary">
          The agent asks you a few questions about the app before it plans it
        </T>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: t.borderStrong, true: t.accent }} thumbColor={t.surfaceOverlay} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </Pressable>
  );
}

/** "Advanced", closed by default: which kind of app to make. */
function Advanced({ open, onToggle, preset, onPreset }: { open: boolean; onToggle: () => void; preset: AppPreset; onPreset: (p: AppPreset) => void }) {
  const t = useTheme();
  const chosen = PRESETS.find((p) => p.id === preset);
  return (
    <View style={{ marginTop: space.lg }}>
      <Pressable
        testID="new-app-advanced"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: size.touch }}
      >
        <T variant="label" style={{ flex: 1 }}>
          Advanced
        </T>
        {!open && preset !== "react-native" ? (
          <T variant="caption" color="textSecondary">
            {chosen?.title}
          </T>
        ) : null}
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <ChevronDown size={icon.size.sm} color={t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
        </View>
      </Pressable>
      {open ? (
        <View accessibilityRole="radiogroup" style={{ gap: space.sm, marginTop: space.xs }}>
          {PRESETS.map((p) => (
            <PresetCard key={p.id} preset={p} selected={p.id === preset} onPress={() => onPreset(p.id)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PresetCard({ preset, selected, onPress }: { preset: PresetChoice; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const dot = 20;
  return (
    <Pressable
      testID={`new-app-preset-${preset.id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${preset.title}. ${preset.line}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: space.md,
        // The thicker selected line eats into the padding, so the content never moves.
        padding: space.md - (selected ? border.focusWidth - border.width : 0),
        borderRadius: radius.card,
        borderWidth: selected ? border.focusWidth : border.width,
        borderColor: selected ? t.accent : t.border,
        backgroundColor: pressed ? t.selectedBg : t.fieldBg,
      })}
    >
      <View
        style={{
          width: dot,
          height: dot,
          marginTop: 2,
          borderRadius: dot / 2,
          borderWidth: border.focusWidth,
          borderColor: selected ? t.accent : t.borderStrong,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? <View style={{ width: dot / 2, height: dot / 2, borderRadius: dot / 4, backgroundColor: t.accent }} /> : null}
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <T variant="row">{preset.title}</T>
          {preset.tag ? (
            <T variant="caption" color="textSecondary">
              {preset.tag}
            </T>
          ) : null}
        </View>
        <T variant="caption" color="textSecondary">
          {preset.line}
        </T>
      </View>
    </Pressable>
  );
}

// ---------- the PC forgot this phone

function AuthLost() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top + space["7xl"], paddingHorizontal: size.screenGutter, gap: space.lg }}>
      <T variant="display">Connect again</T>
      <T variant="lede" color="textSecondary">
        Your PC doesn’t recognise this phone any more. This happens if Kiwimake was reset on the PC.
      </T>
      <Button label="Connect your PC" style={{ marginTop: space.lg }} onPress={() => void unpair()} />
    </View>
  );
}
