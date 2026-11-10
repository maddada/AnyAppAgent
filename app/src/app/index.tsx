import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, TextInput, View, useWindowDimensions } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageCircle, Plus, Settings, Smartphone, Trash2, WifiOff } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { actionLabel, describeApp, type Tone } from "@/lib/describe";
import { installApp, installFromLink, launchApp } from "@/lib/installer";
import type { App } from "@/lib/protocol";
import { askForNotificationsOnce, reconnectNow, unpair } from "@/lib/session";
import { appAction, removeApp, sortedApps, useStore } from "@/lib/store";
import { AppIcon } from "@/ui/AppIcon";
import { Button, IconButton } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { Shine } from "@/ui/Shine";
import { T } from "@/ui/Text";
import { font, radius, type as typeScale, useTheme, type Theme, space } from "@/ui/theme";

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
  const connection = useStore((s) => s.connection);
  const [selected, setSelected] = useState<{ id: string; manage: boolean } | null>(null);
  const [creating, setCreating] = useState(false);

  const tiles: Tile[] = useMemo(() => [{ kind: "new" }, ...sortedApps(apps).map((app) => ({ kind: "app" as const, app }))], [apps]);
  const gap = 12;
  const tileWidth = (width - 16 * 2 - gap) / 2;

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: space.xl, paddingRight: space.sm, paddingTop: space.sm, paddingBottom: space.xs }}>
        <T size="xxl" weight="semibold" style={{ flex: 1 }}>
          Your apps
        </T>
        <IconButton testID="open-settings" icon={Settings} label="Settings" onPress={() => router.push("/settings")} />
      </View>
      <ConnectionBanner connection={connection} loaded={appsLoaded} />
      <FlatList
        data={tiles}
        keyExtractor={(item) => (item.kind === "new" ? "new" : item.app.id)}
        numColumns={2}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ padding: space.lg, gap, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reconnectNow} colors={[t.foreground]} progressBackgroundColor={t.background} />}
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

function ConnectionBanner({ connection, loaded }: { connection: string; loaded: boolean }) {
  const t = useTheme();
  const [show, setShow] = useState(false);
  // Don't flash the banner for a quick reconnect.
  useEffect(() => {
    if (connection === "online") return;
    const timer = setTimeout(() => setShow(true), loaded ? 2500 : 600);
    return () => {
      clearTimeout(timer);
      setShow(false);
    };
  }, [connection, loaded]);
  if (!show) return null;
  const connecting = connection === "connecting";
  return (
    <Pressable
      onPress={reconnectNow}
      style={{
        marginHorizontal: space.lg,
        marginTop: space.sm,
        borderRadius: radius.xl,
        backgroundColor: t.recessed,
        borderWidth: 1,
        borderColor: t.seam,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
      }}
    >
      <WifiOff size={18} color={t.mutedForeground} strokeWidth={1.75} />
      <View style={{ flex: 1 }}>
        <T size="sm" weight="medium">
          {connecting ? "Connecting to your PC…" : "Can't reach your PC"}
        </T>
        {!connecting ? (
          <T size="xs" tone="muted">
            Make sure it’s on and AnyAppAgent is running. Tap to try again.
          </T>
        ) : null}
      </View>
    </Pressable>
  );
}

function toneColor(t: Theme, tone: Tone) {
  return tone === "busy" ? t.attention : tone === "ready" ? t.success : tone === "problem" ? t.destructiveText : t.subtleForeground;
}

function StateLine({ app, center = true }: { app: App; center?: boolean }) {
  const t = useTheme();
  const pkg = useStore((s) => s.packages[app.packageName]);
  const install = useStore((s) => s.installs[app.id]);
  const state = describeApp(app, pkg, install);
  if (!state) {
    return (
      <T size="xs" tone="subtle" style={{ textAlign: center ? "center" : "left" }}>
        {pkg ? "On your phone" : " "}
      </T>
    );
  }
  const color = toneColor(t, state.tone);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: center ? "center" : "flex-start", gap: space.sm }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Shine active={state.live} style={{ ...typeScale.xs, fontFamily: font.medium, color: state.tone === "quiet" ? t.mutedForeground : t.foreground }}>
        {state.label}
      </Shine>
    </View>
  );
}

function AppTile({ app, width, onPress, onLongPress }: { app: App; width: number; onPress: () => void; onLongPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      testID={`app-tile-${app.slug}`}
      accessibilityLabel={app.name}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        width,
        borderRadius: radius.tile,
        backgroundColor: pressed ? t.hover : t.recessed,
        borderWidth: 1,
        borderColor: t.seam,
        alignItems: "center",
        paddingTop: space.xxl,
        paddingBottom: space.lg,
        paddingHorizontal: space.sm,
        gap: space.sm,
      })}
    >
      <AppIcon app={app} size={76} />
      <View style={{ alignSelf: "stretch", gap: space.xs }}>
        <T size="base" weight="semibold" numberOfLines={1} style={{ textAlign: "center" }}>
          {app.name}
        </T>
        <StateLine app={app} />
      </View>
    </Pressable>
  );
}

function NewTile({ width, empty, onPress }: { width: number; empty: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      testID="new-app"
      accessibilityLabel="New app"
      onPress={onPress}
      style={({ pressed }) => ({
        width,
        minHeight: 172,
        borderRadius: radius.tile,
        borderWidth: 1.5,
        borderStyle: "dashed",
        borderColor: t.input,
        backgroundColor: pressed ? t.hover : "transparent",
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        padding: space.md,
      })}
    >
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.primary, alignItems: "center", justifyContent: "center" }}>
        <Plus size={30} color={t.primaryForeground} strokeWidth={2} />
      </View>
      <T size="base" weight="semibold">
        New app
      </T>
      {empty ? (
        <T size="xs" tone="muted" style={{ textAlign: "center" }}>
          Describe an app and your PC makes it
        </T>
      ) : null}
    </Pressable>
  );
}

// ---------- tap an app: Open / Change it

function AppSheet({ selection, onClose }: { selection: { id: string; manage: boolean } | null; onClose: () => void }) {
  const t = useTheme();
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
  const primary = () => {
    if (!shown) return;
    if (action === "open") {
      if (!launchApp(shown)) AnyAppNative?.openAppSettings(shown.packageName);
      onClose();
    } else if (action === "install" || action === "update") {
      void installApp(shown);
    }
  };

  return (
    <Sheet visible={!!selection && !!app} onClose={onClose}>
      {shown ? (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.xl }}>
            <AppIcon app={shown} size={60} />
            <View style={{ flex: 1, gap: space.xxs }}>
              <T size="lg" weight="semibold" numberOfLines={1}>
                {shown.name}
              </T>
              <StateLine app={shown} center={false} />
            </View>
          </View>
          {confirmRemove ? (
            <View style={{ gap: space.sm }}>
              <T size="sm" tone="muted">
                {`Remove ${shown.name} from this list? Your PC keeps its files${pkg ? ", and the app stays on your phone" : ""}.`}
              </T>
              <Button
                testID="confirm-remove"
                label="Remove from list"
                variant="danger"
                size="lg"
                icon={Trash2}
                busy={removing}
                onPress={async () => {
                  if (!client) return;
                  setRemoving(true);
                  try {
                    await client.deleteApp(shown.id);
                    removeApp(shown.id);
                    onClose();
                  } catch {
                    // the banner tells the user if the PC is gone
                  } finally {
                    setRemoving(false);
                  }
                }}
              />
              <Button label="Keep it" variant="ghost" onPress={() => (selection?.manage ? onClose() : setConfirmRemove(false))} />
            </View>
          ) : (
            <View style={{ gap: space.sm }}>
              {install?.phase === "failed" ? <InstallFailure app={shown} message={install.message} conflict={install.conflict} /> : null}
              <Button
                testID="app-primary"
                label={installing ? (install?.phase === "downloading" ? `Downloading ${Math.round((install.progress ?? 0) * 100)}%` : "Installing…") : actionLabel(action)}
                icon={Smartphone}
                size="xl"
                disabled={action === "notReady" && !installing}
                busy={installing}
                onPress={primary}
              />
              {action === "update" && !installing ? (
                <Pressable onPress={() => (launchApp(shown), onClose())} style={{ alignSelf: "center", padding: space.xs }}>
                  <T size="xs" tone="muted" style={{ textDecorationLine: "underline" }}>
                    Open the current version
                  </T>
                </Pressable>
              ) : null}
              <Button
                testID="app-change"
                label="Change it"
                icon={MessageCircle}
                variant="secondary"
                size="xl"
                onPress={() => {
                  onClose();
                  router.push(`/chat/${shown.id}`);
                }}
              />
              <Pressable testID="app-remove" onPress={() => setConfirmRemove(true)} style={{ alignSelf: "center", paddingTop: space.sm, paddingHorizontal: space.md }}>
                <T size="xs" tone="subtle">
                  Remove from list
                </T>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
      <View style={{ height: 0, backgroundColor: t.background }} />
    </Sheet>
  );
}

export function InstallFailure({ app, message, conflict }: { app: App; message?: string; conflict?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: t.destructiveSurface, backgroundColor: t.destructiveSurface, padding: space.sm, gap: space.sm }}>
      <T size="xs" tone="destructive">
        {message ?? "It didn't install."}
      </T>
      {conflict ? (
        <Pressable onPress={() => AnyAppNative?.requestUninstall(app.packageName)}>
          <T size="xs" weight="semibold" tone="destructive" style={{ textDecorationLine: "underline" }}>
            Remove the old one
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- New app

function NewAppSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
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

  const input = {
    ...typeScale.base,
    fontFamily: font.regular,
    color: t.foreground,
    backgroundColor: t.recessed,
    borderWidth: 1,
    borderColor: t.seam,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  } as const;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T size="xl" weight="semibold" style={{ marginBottom: space.lg }}>
        New app
      </T>
      <T size="xs" weight="medium" tone="muted" style={{ marginBottom: space.sm }}>
        Name
      </T>
      <TextInput
        testID="new-app-name"
        value={name}
        onChangeText={setName}
        placeholder="Prayer Alarm"
        placeholderTextColor={t.subtleForeground}
        maxLength={40}
        autoCapitalize="words"
        returnKeyType="next"
        style={input}
      />
      <T size="xs" weight="medium" tone="muted" style={{ marginTop: space.md, marginBottom: space.sm }}>
        What should it do?
      </T>
      <TextInput
        testID="new-app-prompt"
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Wake me up for each prayer in Ajman, with a reminder before it."
        placeholderTextColor={t.subtleForeground}
        multiline
        textAlignVertical="top"
        style={[input, { minHeight: 120, maxHeight: 220 }]}
      />
      {error ? (
        <T size="xs" tone="destructive" style={{ marginTop: space.sm }}>
          {error}
        </T>
      ) : null}
      <Button testID="new-app-submit" label="Make it" size="xl" style={{ marginTop: space.lg }} disabled={!ready} busy={busy} onPress={submit} />
    </Sheet>
  );
}

// ---------- the PC forgot this phone

function AuthLost() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 80, paddingHorizontal: space.xxl, gap: space.md }}>
      <T size="xl" weight="semibold">
        Connect again
      </T>
      <T size="base" tone="muted">
        Your PC doesn’t recognise this phone any more. This happens if AnyAppAgent was reset on the PC.
      </T>
      <Button label="Connect your PC" size="xl" style={{ marginTop: space.md }} onPress={() => void unpair()} />
    </View>
  );
}
