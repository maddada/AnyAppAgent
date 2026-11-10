import { useCallback, useEffect, useState } from "react";
import { AppState, PermissionsAndroid, Platform, Pressable, ScrollView, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Bell, Check, Download, Laptop } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import Constants from "expo-constants";
import { AnyAppNative } from "anyapp-native";
import { displayAddress } from "@/lib/address";
import { unpair, updatePrefs } from "@/lib/session";
import { useStore } from "@/lib/store";
import type { ThemePref } from "@/lib/storage";
import { Button, IconButton } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { T } from "@/ui/Text";
import { radius, sizes, space, useTheme } from "@/ui/theme";

export default function Settings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pairing = useStore((s) => s.pairing);
  const serverName = useStore((s) => s.serverName);
  const connection = useStore((s) => s.connection);
  const theme = useStore((s) => s.prefs.theme);
  const [confirm, setConfirm] = useState(false);
  const [perms, setPerms] = useState(readPermissions);

  const check = useCallback(() => setPerms(readPermissions()), []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => sub.remove();
  }, [check]);

  if (!pairing) return <Redirect href="/connect" />;

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, height: 56 }}>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <T size="lg" weight="semibold" style={{ marginLeft: space.xs }}>
          Settings
        </T>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xxl, paddingBottom: insets.bottom + 24 }}>
        <Section title="Your PC">
          <Row
            icon={Laptop}
            title={serverName ?? "Your PC"}
            detail={`${pairing ? displayAddress(pairing.baseUrl) : ""} · ${connection === "online" ? "Connected" : connection === "connecting" ? "Connecting…" : "Can't reach it"}`}
            right={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: connection === "online" ? t.success : t.attention }} />}
          />
          <View style={{ padding: space.md, paddingTop: space.none }}>
            <Button testID="disconnect" label="Disconnect" variant="outline" size="md" onPress={() => setConfirm(true)} />
          </View>
        </Section>

        <Section title="Permissions">
          <Row
            icon={Download}
            title="Install apps"
            detail="Needed to put your apps on this phone."
            right={
              perms.install ? (
                <Granted />
              ) : (
                <Button testID="grant-install-settings" label="Allow" size="sm" onPress={() => AnyAppNative?.openInstallPermissionSettings()} />
              )
            }
          />
          <Divider />
          <Row
            icon={Bell}
            title="Notifications"
            detail="Tells you when an app is ready."
            right={
              perms.notify ? (
                <Granted />
              ) : (
                <Button
                  testID="grant-notify"
                  label="Allow"
                  size="sm"
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
        </Section>

        <Section title="Look">
          <View style={{ flexDirection: "row", padding: space.sm, gap: space.sm }}>
            {(["system", "light", "dark"] as ThemePref[]).map((v) => (
              <Pressable
                key={v}
                testID={`theme-${v}`}
                onPress={() => updatePrefs({ theme: v })}
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: radius.lg,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme === v ? t.background : "transparent",
                  borderWidth: theme === v ? 1 : 0,
                  borderColor: t.border,
                }}
              >
                <T size="sm" weight={theme === v ? "semibold" : "regular"} tone={theme === v ? "foreground" : "muted"}>
                  {v === "system" ? "Auto" : v === "light" ? "Light" : "Dark"}
                </T>
              </Pressable>
            ))}
          </View>
        </Section>

        <T size="xs" tone="subtle" style={{ textAlign: "center" }}>
          AnyAppAgent {Constants.expoConfig?.version ?? ""}
        </T>
      </ScrollView>

      <Sheet visible={confirm} onClose={() => setConfirm(false)}>
        <T size="lg" weight="semibold">
          Disconnect from your PC?
        </T>
        <T size="sm" tone="muted" style={{ marginTop: space.sm }}>
          Your apps stay on your PC and on this phone. You can connect again any time with a new code.
        </T>
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <Button
            testID="confirm-disconnect"
            label="Disconnect"
            variant="danger"
            size="lg"
            onPress={async () => {
              setConfirm(false);
              await unpair(); // with no PC, this screen redirects to Connect by itself
            }}
          />
          <Button label="Stay connected" variant="ghost" onPress={() => setConfirm(false)} />
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <T size="xs" weight="medium" tone="muted" style={{ paddingHorizontal: space.xs }}>
        {title}
      </T>
      <View style={{ borderRadius: radius.xl, borderWidth: 1, borderColor: t.seam, backgroundColor: t.recessed, overflow: "hidden" }}>{children}</View>
    </View>
  );
}

function Row({ icon: Icon, title, detail, right }: { icon: LucideIcon; title: string; detail?: string; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
      <Icon size={20} color={t.mutedForeground} strokeWidth={1.75} />
      <View style={{ flex: 1 }}>
        <T size="sm" weight="medium">
          {title}
        </T>
        {detail ? (
          <T size="xs" tone="muted">
            {detail}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  );
}

function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.seam, marginLeft: sizes.rowDividerInset }} />;
}

function Granted() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Check size={16} color={t.successText} strokeWidth={2} />
      <T size="xs" weight="medium" tone="success">
        Allowed
      </T>
    </View>
  );
}
