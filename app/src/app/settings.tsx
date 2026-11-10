import { useCallback, useEffect, useState } from "react";
import { AppState, PermissionsAndroid, Platform, Pressable, ScrollView, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, ChevronLeft, ChevronRight, Download, Globe, Laptop, Palette, Wifi } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import Constants from "expo-constants";
import { AnyAppNative } from "anyapp-native";
import { displayAddress } from "@/lib/address";
import { usesEasyConnect } from "@/lib/route";
import { unpair, updatePrefs } from "@/lib/session";
import { useStore } from "@/lib/store";
import type { ThemePref } from "@/lib/storage";
import { Button, IconButton } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, icon, radius, size, space, useTheme } from "@/ui/theme";

export default function Settings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pairing = useStore((s) => s.pairing);
  const serverName = useStore((s) => s.serverName);
  const connection = useStore((s) => s.connection);
  const theme = useStore((s) => s.prefs.theme);
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [perms, setPerms] = useState(readPermissions);

  const check = useCallback(() => setPerms(readPermissions()), []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => sub.remove();
  }, [check]);

  if (!pairing) return <Redirect href="/connect" />;
  const anywhere = usesEasyConnect(pairing);
  const nextTheme: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: t.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: size.chatHeaderHeight, paddingLeft: space.xs, gap: space.xs }}>
        <IconButton testID="settings-back" icon={ChevronLeft} label="Back" onPress={() => router.back()} />
        <T variant="heading">Settings</T>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: size.screenGutter, paddingTop: space.md, gap: space["2xl"], paddingBottom: insets.bottom + space["2xl"] }}>
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

        <Button testID="disconnect" label="Disconnect from your PC" variant="quiet" onPress={() => setConfirm(true)} />

        <T variant="caption" color="textTertiary" style={{ textAlign: "center" }}>
          AnyAppAgent {Constants.expoConfig?.version ?? ""}
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
