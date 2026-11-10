import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, TextInput, View, useWindowDimensions } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Download, MessageCircle, Plus, Settings, Smartphone } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { actionLabel, describeApp } from "@/lib/describe";
import { installApp, installFromLink, launchApp } from "@/lib/installer";
import type { App } from "@/lib/protocol";
import { askForNotificationsOnce, reconnectNow, unpair } from "@/lib/session";
import { appAction, removeApp, sortedApps, useStore } from "@/lib/store";
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
  const appsLoaded = useStore((s) => s.appsLoaded);
  const [selected, setSelected] = useState<{ id: string; manage: boolean } | null>(null);
  const [creating, setCreating] = useState(false);

  // The user's apps first, newest first; the New app slot closes the grid (as in the renders).
  const tiles: Tile[] = useMemo(() => [...sortedApps(apps).map((app) => ({ kind: "app" as const, app })), { kind: "new" }], [apps]);
  const tileWidth = (width - size.screenGutter * 2 - size.gridGap) / 2;

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <FlatList
        data={tiles}
        keyExtractor={(item) => (item.kind === "new" ? "new" : item.app.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: size.gridGap }}
        contentContainerStyle={{ paddingHorizontal: size.screenGutter, gap: size.gridGap, paddingBottom: insets.bottom + space["2xl"] }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reconnectNow} colors={[t.text]} progressBackgroundColor={t.surface} />}
        ListHeaderComponent={<Header />}
        renderItem={({ item }) =>
          item.kind === "new" ? (
            <NewTile width={tileWidth} empty={appsLoaded && tiles.length === 1} onPress={() => setCreating(true)} />
          ) : (
            <AppTile
              app={item.app}
              width={tileWidth}
              onPress={() => setSelected({ id: item.app.id, manage: false })}
              onLongPress={() => setSelected({ id: item.app.id, manage: true })}
            />
          )
        }
      />
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
  const state = describeApp(app, pkg, install);
  if (!state) return null;
  // On a tile the idle line is short; the sheet says the full sentence.
  const label = state.kind === "idle" && pkg ? `Version ${pkg.versionCode}` : state.label;
  return <StateLine kind={state.kind} label={label} />;
}

/** Tiles: scale to 0.98 while pressed (COMPONENTS.md 3). */
function PressScale({
  onPress,
  onLongPress,
  children,
  style,
  testID,
  label,
}: {
  onPress: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
  style: object;
  testID?: string;
  label: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityLabel={label}
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
  return (
    <PressScale
      testID={`app-tile-${app.slug}`}
      label={app.name}
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
      <T variant="name" numberOfLines={2} style={{ marginTop: space.md, textAlign: look.tileTextAlign }}>
        {app.name}
      </T>
      <View style={{ flex: 1, minHeight: space.xs }} />
      <TileStateLine app={app} />
    </PressScale>
  );
}

function NewTile({ width, empty, onPress }: { width: number; empty: boolean; onPress: () => void }) {
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
      <T variant="label" color="textSecondary">
        {empty ? "Describe your idea, your PC makes it" : "Describe your idea"}
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
                      installing
                        ? install?.phase === "downloading"
                          ? `Downloading ${Math.round((install.progress ?? 0) * 100)}%`
                          : "Installing"
                        : actionLabel(action, shown.latestApk?.number)
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
  const promptRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0 && prompt.trim().length > 0;

  const submit = async () => {
    if (!client || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const app = await client.createApp({ name: name.trim(), prompt: prompt.trim() });
      useStore.setState((s) => ({ apps: { ...s.apps, [app.id]: app } }));
      setName("");
      setPrompt("");
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
