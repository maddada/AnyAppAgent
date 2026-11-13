import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Switch, TextInput, View, useWindowDimensions } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, CircleUser, Download, Inbox, ListTodo, MessageCircle, Plus, Send, Settings, Share2, Smartphone } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { actionLabel, describeApp, tileState } from "@/lib/describe";
import { installLabel , BEHIND_LABEL, headsUp as bigJobHeadsUp } from "@shared/chat/index";
import { installApp, installFromLink, launchApp, updateFromLink } from "@/lib/installer";
import type { App, AppPreset } from "@/lib/protocol";
import { PRESET_CHOICES as PRESETS, type PresetChoice } from "@shared/presets";
import { useDictation } from "@/lib/dictation";
import { askForNotificationsOnce, reconnectNow, unpair } from "@/lib/session";
import { cloudAvailable } from "@/lib/cloud";
import { takeShare } from "@/lib/sharedIn";
import { SendAppPanel } from "@/ui/SendApp";
import { appAction, getState, placeOf, removeApp, sortedApps, useClientFor, useStore } from "@/lib/store";
import { AppCredits, AppSigning, credits, PlaceMark } from "@/ui/CloudBits";
import { AppIcon } from "@/ui/AppIcon";
import { Button, IconButton } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { DictationNote, MicButton } from "@/ui/MicButton";
import { Sheet } from "@/ui/Sheet";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { BrandLockup } from "@/ui/Brand";
import { HealthBadge, HealthCard, ReminderBanner } from "@/ui/Trust";
import { LinkAskBanner } from "@/ui/LinkAsk";
import { MoveButton, moveLine } from "@/ui/Move";
import { border, elevation, icon, look, radius, size, space, useTheme } from "@/ui/theme";

/** COMPONENTS.md 3 and 4: the New app plus is 28, the sheet head icon 56 (no icon-size token for either). */
const NEW_TILE_PLUS = 28;
const SHEET_ICON = 56;
/** Large text settings grow the tile names and the home hint up to this, then they shrink to fit. */
const TILE_TEXT_MAX_SCALE = 1.6;

type Tile = { kind: "new" } | { kind: "app"; app: App };

export default function Home() {
  const pairing = useStore((s) => s.pairing);
  const authLost = useStore((s) => s.authLost);
  const cloudAuth = useStore((s) => s.cloudAuth);
  const params = useLocalSearchParams<{ install?: string; update?: string; crash?: string }>();
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
        ListHeaderComponent={
          <>
            <Header />
            <ReminderBanner />
            <LinkAskBanner />
          </>
        }
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
  const base = pkg ? `Open ${app.name}` : line.label === "Tap to install" ? `Install ${app.name}` : `${app.name}, ${line.label}`;
  const label = app.health?.behind ? `${base}. ${BEHIND_LABEL}` : base;
  // Where it is made shows only when the person has both places (docs/CLOUD.md, "One grid").
  const bothPlaces = useStore((s) => !!s.pairing && s.cloudAuth === "signedIn");
  const pcOnline = useStore((s) => s.connection === "online");
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
      <View>
        <AppIcon app={app} size={size.appIcon} />
        {app.health?.behind ? (
          <View style={{ position: "absolute", top: -6, right: -6 }}>
            <HealthBadge app={app} onPress={onLongPress} />
          </View>
        ) : null}
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
    </PressScale>
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
  const client = useClientFor(selection?.id);
  const app = useStore((s) => (selection ? s.apps[selection.id] : undefined));
  const pkg = useStore((s) => (app ? s.packages[app.packageName] : undefined));
  const install = useStore((s) => (app ? s.installs[app.id] : undefined));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [sending, setSending] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Keep showing the app while the sheet slides away; reset the mode for each new selection.
  const [lastApp, setLastApp] = useState<App | undefined>(app);
  if (app && app !== lastApp) setLastApp(app);
  const [lastSelection, setLastSelection] = useState(selection);
  if (selection !== lastSelection) {
    setLastSelection(selection);
    setConfirmRemove(!!selection?.manage);
    setSending(false);
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
              <T variant="titleSmall" numberOfLines={1}>
                {shown.name}
              </T>
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
          {sending && !confirmRemove ? (
            <SendAppPanel app={shown} onDone={onClose} onCancel={() => setSending(false)} />
          ) : confirmRemove ? (
            <View style={{ gap: space.sm }}>
              <T variant="callout" color="textSecondary" style={{ marginBottom: space.sm }}>
                {placeOf(shown) === "cloud"
                  ? `Remove ${shown.name}? Its code stays on your GitHub${pkg ? ", and the app stays on your phone" : ""}.`
                  : `Remove ${shown.name} from this list? Your PC keeps its files${pkg ? ", and the app stays on your phone" : ""}.`}
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
              <HealthCard
                app={shown}
                onSent={() => {
                  onClose();
                  router.push(`/chat/${shown.id}`);
                }}
              />
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
              <Button testID="app-others" label={othersLabel} icon={Inbox} variant="quiet" onPress={doOthers} />
              {pkg && AnyAppNative?.shareApk ? <Button testID="app-send" label="Send app" icon={Send} variant="quiet" onPress={() => setSending(true)} /> : null}
              {shown.latestApk ? <Button testID="app-share" label={shown.sharing?.shared ? "Shared" : "Share"} icon={Share2} variant="quiet" onPress={doShare} /> : null}
              {pkg && action === "update" ? (
                <T variant="caption" color="textSecondary" style={{ textAlign: "center", marginTop: space.xs }}>
                  {`Version ${pkg.versionCode} is on this phone.`}
                </T>
              ) : null}
              <MoveButton app={shown} onMoved={onClose} />
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
        trailing={<MicButton dictation={dictation} testID="new-app-mic" />}
      />
      <DictationNote dictation={dictation} style={{ marginTop: space.sm }} />
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
