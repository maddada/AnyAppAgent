import { useState } from "react";
import { View } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import { setState, useStore } from "@/lib/store";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { T } from "./Text";
import { icon, radius, size, space, useTheme } from "./theme";

/** Asked once, right before the first install: Android's "install unknown apps" switch. */
export function InstallPermissionSheet() {
  const t = useTheme();
  const appId = useStore((s) => s.needInstallPermission);
  const app = useStore((s) => (appId ? s.apps[appId] : undefined));
  const [name, setName] = useState<string | null>(null);
  if (app && app.name !== name) setName(app.name);
  const close = () => setState({ needInstallPermission: null });
  return (
    <Sheet visible={!!appId} onClose={close}>
      <View style={{ width: size.badge, height: size.badge, borderRadius: radius.badge, backgroundColor: t.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
        <ShieldCheck size={icon.size.md} color={t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
      </View>
      <T variant="titleSmall" style={{ marginTop: space.lg }}>
        Allow installing your apps
      </T>
      <T variant="callout" color="textSecondary" style={{ marginTop: space.sm }}>
        {`Android asks once before ${name ?? "your app"} can be installed. Turn on “Allow from this source”, then come back.`}
      </T>
      <View style={{ gap: space.sm, marginTop: space["2xl"] }}>
        <Button
          testID="grant-install"
          label="Allow"
          onPress={() => {
            // Keep needInstallPermission: the install continues when we're back in front.
            AnyAppNative?.openInstallPermissionSettings();
          }}
        />
        <Button label="Not now" variant="quiet" onPress={close} />
      </View>
    </Sheet>
  );
}
