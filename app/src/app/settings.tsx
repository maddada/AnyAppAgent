import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, PermissionsAndroid, Platform, Pressable, ScrollView, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, ChevronLeft, ChevronRight, Download, Globe, Laptop, Palette, Wifi, CircleUser } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import Constants from "expo-constants";
import { AnyAppNative } from "anyapp-native";
import { AiSettingsGroup } from "@/ui/AiSettings";
import { AppIcon } from "@/ui/AppIcon";
import { emptyTrash, loadTrash, restoreApp, setHidden } from "@/lib/manage";
import type { App } from "@/lib/protocol";
import { CareSettings } from "@/ui/Trust";
import { displayAddress } from "@/lib/address";
import { usesEasyConnect } from "@/lib/route";
import { unpair, updatePrefs } from "@/lib/session";
import { useStore } from "@/lib/store";
import { cloudAvailable } from "@/lib/cloud";
import type { ThemePref } from "@/lib/storage";
import { Button, IconButton } from "@/ui/Button";
import { Sheet, useKeyboardHeight } from "@/ui/Sheet";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, icon, radius, size, space, useTheme } from "@/ui/theme";

export default function Settings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pairing = useStore((s) => s.pairing);
  const cloudOn = useStore((s) => s.cloudAuth === "signedIn");
  const account = useStore((s) => s.account);
  const serverName = useStore((s) => s.serverName);
  const connection = useStore((s) => s.connection);
  const theme = useStore((s) => s.prefs.theme);
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [perms, setPerms] = useState(readPermissions);
  const keyboard = useKeyboardHeight();

  const check = useCallback(() => setPerms(readPermissions()), []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => sub.remove();
  }, [check]);

  // A phone that makes apps only in the cloud has Settings too (no PC rows).
  if (!pairing && !cloudOn) return <Redirect href="/" />;
  const anywhere = pairing ? usesEasyConnect(pairing) : false;
  const nextTheme: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: t.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: size.chatHeaderHeight, paddingLeft: space.xs, gap: space.xs }}>
        <IconButton testID="settings-back" icon={ChevronLeft} label="Back" onPress={() => router.back()} />
        <T variant="heading">Settings</T>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: size.screenGutter, paddingTop: space.md, gap: space["2xl"], paddingBottom: Math.max(insets.bottom, keyboard) + space["2xl"] }}
      >
        {cloudAvailable ? (
          <Group title="Kiwimake account">
            <Row
              testID="settings-account"
              icon={CircleUser}
              label={cloudOn ? (account?.email ?? account?.name ?? "Your account") : "Sign in"}
              sub={cloudOn ? "Places, credits and plan" : "Optional: for the cloud, family circles and web apps"}
              onPress={() => router.push(cloudOn ? "/account" : "/sign-in")}
            />
          </Group>
        ) : null}

        {pairing ? (
        <Group title="Your PC">
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.rowHeight, paddingHorizontal: space.lg, paddingVertical: space.md }}>
            <RowIcon icon={Laptop} />
            <View style={{ flex: 1, gap: space.xs }}>
              <T variant="body">{serverName ?? "Your PC"}</T>
              {connection === "online" ? (
                <StateLine kind="ready" label="Connected" />
              ) : connection === "connecting" ? (
                <StateLine kind="working" label="Connecting" />
              ) : (
                <StateLine kind="problem" label="Can't reach your PC" />
              )}
            </View>
          </View>
          <Divider />
          <Row
            testID="connected-how"
            icon={anywhere ? Globe : Wifi}
            label={anywhere ? "From anywhere" : "Same Wi-Fi only"}
            sub={
              anywhere
                ? "Works on any Wi-Fi or mobile data, through Easy Connect."
                : `Works when this phone and your PC are on the same Wi-Fi (${displayAddress(pairing.baseUrl)}). To use it from anywhere, disconnect and scan the code again.`
            }
          />
        </Group>
        ) : null}

        {pairing ? <AiSettingsGroup Group={Group} Row={Row} Divider={Divider} /> : null}

        {pairing ? <CareGroup /> : null}

        <Group title="Permissions">
          <Row
            icon={Download}
            label="Install apps"
            sub="Needed to put your apps on this phone."
            trailing={perms.install ? <StateLine kind="ready" label="Allowed" /> : <Button testID="grant-install-settings" label="Allow" small onPress={() => AnyAppNative?.openInstallPermissionSettings()} />}
          />
          <Divider />
          <Row
            icon={Bell}
            label="Notifications"
            sub="Tells you when an app is ready."
            trailing={
              perms.notify ? (
                <StateLine kind="ready" label="Allowed" />
              ) : (
                <Button
                  testID="grant-notify"
                  label="Allow"
                  small
                  variant={perms.install ? "primary" : "quiet"}
                  onPress={async () => {
                    if (Platform.OS === "android" && Platform.Version >= 33) {
                      const r = await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS" as never);
                      if (r === "granted") return check();
                    }
                    AnyAppNative?.openNotificationSettings();
                  }}
                />
              )
            }
          />
        </Group>

        <Group title="Look">
          <Row
            testID="theme-toggle"
            icon={Palette}
            label="Light or dark"
            value={theme === "system" ? "Same as the phone" : theme === "light" ? "Light" : "Dark"}
            onPress={() => updatePrefs({ theme: nextTheme[theme] })}
          />
        </Group>

        {pairing ? <HiddenAppsGroup /> : null}

        {pairing ? <RecentlyDeletedGroup /> : null}

        {pairing ? <Button testID="disconnect" label="Disconnect from your PC" variant="quiet" onPress={() => setConfirm(true)} /> : null}

        <T variant="caption" color="textTertiary" style={{ textAlign: "center" }}>
          Kiwimake {Constants.expoConfig?.version ?? ""}
        </T>
      </ScrollView>

      <Sheet visible={confirm} onClose={() => setConfirm(false)}>
        <T variant="titleSmall">Disconnect from your PC?</T>
        <T variant="callout" color="textSecondary" style={{ marginTop: space.sm }}>
          Your apps stay on your PC and on this phone. You can connect again any time with a new code.
        </T>
        <View style={{ gap: space.sm, marginTop: space["2xl"] }}>
          <Button
            testID="confirm-disconnect"
            label="Disconnect"
            variant="problem"
            busy={leaving}
            onPress={async () => {
              setLeaving(true); // the PC is told first, which can take a few seconds
              await unpair(); // with no PC, this screen redirects to Connect by itself
            }}
          />
          <Button label="Stay connected" variant="quiet" onPress={() => setConfirm(false)} />
        </View>
      </Sheet>
    </View>
  );
}

function readPermissions() {
  return {
    install: AnyAppNative?.canInstallPackages() ?? false,
    notify: AnyAppNative?.notificationsEnabled() ?? false,
  };
}

/** The usage meter and the backup (docs/TRUST.md); nothing on an older PC. */
function CareGroup() {
  const care = useStore((s) => s.care);
  if (!care) return null;
  return (
    <Group title="Claude plan and backup">
      <View style={{ padding: space.lg }}>
        <CareSettings care={care} />
      </View>
    </Group>
  );
}

/** Pin, hide and delete: apps hidden from the grid, with Unhide. */
function HiddenAppsGroup() {
  const apps = useStore((s) => s.apps);
  const online = useStore((s) => s.connection === "online");
  const hidden = useMemo(() => Object.values(apps).filter((a) => a.hidden).sort((a, b) => a.name.localeCompare(b.name)), [apps]);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Group title="Hidden apps">
      <View testID="hidden-apps" style={{ padding: space.lg, gap: space.xs }}>
        <T variant="caption" color="textSecondary">
          {hidden.length > 0 ? "Hidden apps are not in your app list. They still work on this phone." : "No hidden apps. Hide one from its options."}
        </T>
      </View>
      {hidden.map((app) => (
        <AppRow key={app.id} app={app} sub={app.latestApk ? `Version ${app.latestApk.number}` : "No version yet"}>
          <Button
            testID={`unhide-${app.slug}`}
            label="Unhide"
            variant="quiet"
            small
            busy={busy === app.id}
            disabled={!online}
            onPress={async () => {
              setBusy(app.id);
              await setHidden(app, false).catch(() => undefined);
              setBusy(null);
            }}
          />
        </AppRow>
      ))}
    </Group>
  );
}

/** Pin, hide and delete: Recently deleted, kept until the person empties it. Nothing on an older PC. */
function RecentlyDeletedGroup() {
  const trash = useStore((s) => s.trash);
  const online = useStore((s) => s.connection === "online");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (online) void loadTrash();
  }, [online]);
  if (!trash) return null;
  return (
    <Group title="Recently deleted">
      <View testID="recently-deleted" style={{ padding: space.lg }}>
        <T variant="caption" color="textSecondary">
          {trash.length > 0
            ? "Apps you delete wait here until you empty it. Restore one and it comes back with its chat and versions."
            : "Nothing here. Apps you delete wait here until you empty it."}
        </T>
      </View>
      {trash.map((app) => (
        <AppRow key={app.id} app={app} sub={deletedWhen(app.deletedAt)}>
          <Button
            testID={`restore-${app.slug}`}
            label="Restore"
            variant="quiet"
            small
            busy={busy === app.id}
            disabled={!online}
            onPress={async () => {
              setBusy(app.id);
              await restoreApp(app.id).catch(() => undefined);
              setBusy(null);
            }}
          />
        </AppRow>
      ))}
      {trash.length > 0 ? (
        <>
          <Divider />
          <View style={{ padding: space.lg, gap: space.md }}>
            <T variant="caption" color={confirm ? "text" : "textSecondary"}>
              {confirm ? "Empty Recently deleted? This can't be undone." : "Empty deletes them for good from this PC. Their code stays on GitHub."}
            </T>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
              {confirm ? <Button testID="empty-cancel" label="Cancel" variant="quiet" small onPress={() => setConfirm(false)} /> : null}
              <Button
                testID={confirm ? "empty-confirm" : "empty-trash"}
                label="Empty"
                variant="problem"
                small
                busy={busy === "empty"}
                disabled={!online}
                onPress={async () => {
                  if (!confirm) return setConfirm(true);
                  setBusy("empty");
                  await emptyTrash().catch(() => undefined);
                  setBusy(null);
                  setConfirm(false);
                }}
              />
            </View>
          </View>
        </>
      ) : null}
    </Group>
  );
}

/** An app in a Settings list: its icon and name with a line under it, the button below on the right. */
function AppRow({ app, sub, children }: { app: App; sub: string; children: React.ReactNode }) {
  return (
    <>
      <Divider />
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <AppIcon app={app} size={size.appIconSmall} />
          <View style={{ flex: 1, gap: space.hair }}>
            <T variant="body" numberOfLines={1}>
              {app.name}
            </T>
            <T variant="caption" color="textTertiary">
              {sub}
            </T>
          </View>
        </View>
        {/* Design rule (AGENTS.md): the words keep the full width; the button sits below them, on the right. */}
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>{children}</View>
      </View>
    </>
  );
}

function deletedWhen(iso: string | undefined): string {
  if (!iso) return "Deleted";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Deleted today";
  if (days === 1) return "Deleted yesterday";
  if (days < 30) return `Deleted ${days} days ago`;
  return `Deleted on ${new Date(iso).toLocaleDateString()}`;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <T variant="eyebrow" color="textSecondary" style={{ paddingHorizontal: space.xs }}>
        {title}
      </T>
      <View style={{ borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface, overflow: "hidden" }}>{children}</View>
    </View>
  );
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  const t = useTheme();
  return <Icon size={icon.size.md} color={t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />;
}

/** Settings row (COMPONENTS.md 5): 56 high, icon, label, value, chevron when it opens something. */
function Row({
  icon: Icon,
  label,
  sub,
  value,
  trailing,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  value?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: size.rowHeight,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: pressed ? t.selectedBg : "transparent",
      })}
    >
      <RowIcon icon={Icon} />
      <View style={{ flex: 1, gap: space.hair }}>
        <T variant="body">{label}</T>
        {sub ? (
          <T variant="caption" color="textSecondary">
            {sub}
          </T>
        ) : null}
      </View>
      {value ? (
        <T variant="label" color="textTertiary">
          {value}
        </T>
      ) : null}
      {trailing}
      {onPress ? <ChevronRight size={icon.size.button} color={t.textTertiary} strokeWidth={icon.stroke} absoluteStrokeWidth /> : null}
    </Pressable>
  );
}

function Divider() {
  const t = useTheme();
  return <View style={{ height: border.width, backgroundColor: t.border }} />;
}
