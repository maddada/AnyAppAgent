import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Switch, TextInput, View, useWindowDimensions } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, Download, ListTodo, MessageCircle, Plus, Settings, Smartphone } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { actionLabel, describeApp, tileState } from "@/lib/describe";
import { installLabel } from "@shared/chat/index";
import { installApp, installFromLink, launchApp } from "@/lib/installer";
import type { App, AppPreset } from "@/lib/protocol";
import { PRESET_CHOICES as PRESETS, type PresetChoice } from "@shared/presets";
import { askForNotificationsOnce, reconnectNow, unpair } from "@/lib/session";
import { appAction, getState, removeApp, sortedApps, useStore } from "@/lib/store";
import { AppIcon } from "@/ui/AppIcon";
import { Button, IconButton } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, elevation, icon, look, radius, size, space, useTheme } from "@/ui/theme";

const MARK = require("../../../shared/theme/mark/android/expo/icon.png");
/** COMPONENTS.md 3 and 4: the New app plus is 28, the sheet head icon 56 (no icon-size token for either). */
const NEW_TILE_PLUS = 28;
const SHEET_ICON = 56;
/** Large text settings grow the tile names and the home hint up to this, then they shrink to fit. */
const TILE_TEXT_MAX_SCALE = 1.6;

type Tile = { kind: "new" } | { kind: "app"; app: App };

export default function Home() {
  const pairing = useStore((s) => s.pairing);
  const authLost = useStore((s) => s.authLost);
  const params = useLocalSearchParams<{ install?: string }>();

  // Tapped "ready to install" notification: anyappagent://?install=<appId>
  useEffect(() => {
    if (params.install) {
      installFromLink(String(params.install));
      router.setParams({ install: undefined });
    }
  }, [params.install]);

  if (!pairing) return <Redirect href="/connect" />;
  if (authLost) return <AuthLost />;
  return <AppGrid />;
}

function AppGrid() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const apps = useStore((s) => s.apps);
  const [selected, setSelected] = useState<{ id: string; manage: boolean } | null>(null);
  const [creating, setCreating] = useState(false);

  // The user's apps first, newest first; the New app slot closes the grid (as in the renders).
  const tiles: Tile[] = useMemo(() => [...sortedApps(apps).map((app) => ({ kind: "app" as const, app })), { kind: "new" }], [apps]);
  const tileWidth = (width - size.screenGutter * 2 - size.gridGap) / 2;
  const hasApps = tiles.length > 1;

  /**
   * One tap: open the app when it is on this phone. Not on it yet but built: start the install
   * (the tile says "Tap to install", then shows the download). Anything else (busy installing,
   * failed, no version yet, can't be launched): the options sheet, which says why and what to do.
   */
  const tapApp = (app: App) => {
    const s = getState();
    const install = s.installs[app.id];
    const pkg = s.packages[app.packageName];
    const busy = !!install && ["waiting", "downloading", "checking", "installing", "confirm"].includes(install.phase);
    if (pkg && launchApp(app)) return;
    if (!pkg && !busy && install?.phase !== "failed" && appAction(app, pkg) === "install") {
      void installApp(app);
      return;
    }
    setSelected({ id: app.id, manage: false });
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <FlatList
        data={tiles}
        keyExtractor={(item) => (item.kind === "new" ? "new" : item.app.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: size.gridGap }}
        contentContainerStyle={{ paddingHorizontal: size.screenGutter, gap: size.gridGap, paddingBottom: hasApps ? space["2xl"] : insets.bottom + space["2xl"] }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reconnectNow} colors={[t.text]} progressBackgroundColor={t.surface} />}
        ListHeaderComponent={<Header />}
        renderItem={({ item }) =>
          item.kind === "new" ? (
            <NewTile width={tileWidth} onPress={() => setCreating(true)} />
          ) : (
            <AppTile
              app={item.app}
              width={tileWidth}
              onPress={() => tapApp(item.app)}
              onLongPress={() => {
                AnyAppNative?.haptic?.();
                setSelected({ id: item.app.id, manage: false });
              }}
            />
          )
        }
      />
      {hasApps ? (
        <T
          testID="home-hint"
          variant="caption"
          color="textTertiary"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.4}
          maxFontSizeMultiplier={TILE_TEXT_MAX_SCALE}
          style={{ textAlign: "center", paddingHorizontal: size.screenGutter, paddingTop: space.xs, paddingBottom: insets.bottom + space.sm }}
        >
          Hold to see options or prompt
        </T>
      ) : null}
      <AppSheet selection={selected} onClose={() => setSelected(null)} />
      <NewAppSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

function Header() {
  const t = useTheme();
  const connection = useStore((s) => s.connection);
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
  const markSize = icon.size.md;
  return (
    <View style={{ paddingTop: space.md, paddingBottom: space.xl }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginRight: -space.md }}>
        <Image source={MARK} style={{ width: markSize, height: markSize, borderRadius: (markSize * radius.appIcon) / size.appIcon }} />
        <T variant="heading" style={{ flex: 1 }}>
          AnyAppAgent
        </T>
        <IconButton testID="open-settings" icon={Settings} label="Settings" iconSize={icon.size.md} color={t.textSecondary} onPress={() => router.push("/settings")} />
      </View>
      <T variant="display" style={{ marginTop: space.xl }}>
        Your apps
      </T>
      <Pressable testID="connection-state" onPress={reconnectNow} style={{ marginTop: space.sm, minHeight: size.touch / 2, justifyContent: "center" }}>
        {connection === "online" ? (
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
  return <StateLine kind={line.kind} label={line.label} fit />;
}

/** Tiles: scale to 0.98 while pressed (COMPONENTS.md 3). */
function PressScale({
  onPress,
  onLongPress,
  children,
  style,
  testID,
  label,
  hint,
}: {
  onPress: () => void;
  onLongPress?: () => void;
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
      onPressOut={() => setPressed(false)}
      style={[style, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}

function AppTile({ app, width, onPress, onLongPress }: { app: App; width: number; onPress: () => void; onLongPress: () => void }) {
  const t = useTheme();
  const pkg = useStore((s) => s.packages[app.packageName]);
  const line = tileState(app, pkg, useStore((s) => s.installs[app.id]));
  const label = pkg ? `Open ${app.name}` : line.label === "Tap to install" ? `Install ${app.name}` : `${app.name}, ${line.label}`;
  return (
    <PressScale
      testID={`app-tile-${app.slug}`}
      label={label}
      hint="Hold for options and its chat"
      onPress={onPress}
      onLongPress={onLongPress}
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
      <AppIcon app={app} size={size.appIcon} />
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
      <TileStateLine app={app} />
    </PressScale>
  );
}

function NewTile({ width, onPress }: { width: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <PressScale
      testID="new-app"
      label="New app"
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
        New app
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
  const client = useStore((s) => s.client);
  const app = useStore((s) => (selection ? s.apps[selection.id] : undefined));
  const pkg = useStore((s) => (app ? s.packages[app.packageName] : undefined));
  const install = useStore((s) => (app ? s.installs[app.id] : undefined));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Keep showing the app while the sheet slides away; reset the mode for each new selection.
  const [lastApp, setLastApp] = useState<App | undefined>(app);
  if (app && app !== lastApp) setLastApp(app);
  const [lastSelection, setLastSelection] = useState(selection);
  if (selection !== lastSelection) {
    setLastSelection(selection);
    setConfirmRemove(!!selection?.manage);
  }
  const shown = app ?? lastApp;

  const action = shown ? appAction(shown, pkg) : "notReady";
  const installing = !!install && ["waiting", "downloading", "checking", "installing", "confirm"].includes(install.phase);
  const state = shown ? describeApp(shown, pkg, install) : null;
  const doInstall = () => shown && void installApp(shown);
  const doOpen = () => {
    if (!shown) return;
    if (!launchApp(shown)) AnyAppNative?.openAppSettings(shown.packageName);
    onClose();
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

  return (
    <Sheet visible={!!selection && !!app} onClose={onClose}>
      {shown ? (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.xl }}>
            <AppIcon app={shown} size={SHEET_ICON} />
            <View style={{ flex: 1, gap: space.xs }}>
              <T variant="titleSmall" numberOfLines={1}>
                {shown.name}
              </T>
              {state ? <StateLine kind={state.kind} label={state.label} /> : null}
            </View>
          </View>
          {confirmRemove ? (
            <View style={{ gap: space.sm }}>
              <T variant="callout" color="textSecondary" style={{ marginBottom: space.sm }}>
                {`Remove ${shown.name} from this list? Your PC keeps its files${pkg ? ", and the app stays on your phone" : ""}.`}
              </T>
              <Button
                testID="confirm-remove"
                label="Remove from list"
                variant="problem"
                busy={removing}
                onPress={async () => {
                  if (!client) return;
                  setRemoving(true);
                  try {
                    await client.deleteApp(shown.id);
                    removeApp(shown.id);
                    onClose();
                  } catch {
                    // the connection line tells the user if the PC is gone
                  } finally {
                    setRemoving(false);
                  }
                }}
              />
              <Button label="Keep it" variant="quiet" onPress={() => (selection?.manage ? onClose() : setConfirmRemove(false))} />
            </View>
          ) : (
            <View style={{ gap: space.sm }}>
              {install?.phase === "failed" ? <InstallFailure app={shown} message={install.message} conflict={install.conflict} /> : null}
              {action === "install" || action === "update" || installing ? (
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
              {pkg && action === "update" ? (
                <T variant="caption" color="textSecondary" style={{ textAlign: "center", marginTop: space.xs }}>
                  {`Version ${pkg.versionCode} is on this phone.`}
                </T>
              ) : null}
              <Button
                testID="app-remove"
                label="Remove from list"
                variant="text"
                small
                style={{ alignSelf: "center", marginTop: space.md }}
                onPress={() => setConfirmRemove(true)}
              />
            </View>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

export function InstallFailure({ app, message, conflict }: { app: App; message?: string; conflict?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ borderRadius: radius.card, backgroundColor: t.problemSoft, padding: space.md, gap: space.xs, marginBottom: space.xs }}>
      <T variant="row" color="problem">
        {message ?? "It didn't install."}
      </T>
      {conflict ? <Button label="Remove the old one" variant="text" small onPress={() => AnyAppNative?.requestUninstall(app.packageName)} /> : null}
    </View>
  );
}

// ---------- New app

function NewAppSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const client = useStore((s) => s.client);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [preset, setPreset] = useState<AppPreset>("react-native");
  const [askMore, setAskMore] = useState(false);
  const promptRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0 && prompt.trim().length > 0;

  const submit = async () => {
    if (!client || !ready) return;
    setBusy(true);
    setError(null);
    try {
      // The default is left out of the request, so an older PC companion still accepts it.
      const app = await client.createApp({ name: name.trim(), prompt: prompt.trim(), ...(preset !== "react-native" ? { preset } : {}), ...(askMore ? { askMore: true } : {}) });
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
        New app
      </T>
      <Field testID="new-app-name" label="Name" value={name} onChangeText={setName} placeholder="For example, Prayer Times" maxLength={40} autoCapitalize="words" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => promptRef.current?.focus()} />
      <Field
        testID="new-app-prompt"
        ref={promptRef}
        label="What should it do?"
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Wake me up for each prayer in Ajman, with a reminder before it."
        multiline
        containerStyle={{ marginTop: space.lg }}
      />
      <AskMore value={askMore} onChange={setAskMore} />
      <Advanced open={advanced} onToggle={() => setAdvanced(!advanced)} preset={preset} onPreset={setPreset} />
      {error ? (
        <T variant="caption" color="problem" style={{ marginTop: space.sm }}>
          {error}
        </T>
      ) : null}
      <Button testID="new-app-submit" label="Make it" style={{ marginTop: space.xl }} disabled={!ready} busy={busy} onPress={submit} />
      {!ready ? (
        <T variant="caption" color="textSecondary" style={{ marginTop: space.sm, textAlign: "center" }}>
          Give it a name and say what it should do.
        </T>
      ) : null}
    </Sheet>
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
        Your PC doesn’t recognise this phone any more. This happens if AnyAppAgent was reset on the PC.
      </T>
      <Button label="Connect your PC" style={{ marginTop: space.lg }} onPress={() => void unpair()} />
    </View>
  );
}
