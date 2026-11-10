import { useState } from "react";
import { ShieldCheck } from "lucide-react-native";
import { View } from "react-native";
import { AnyAppNative } from "anyapp-native";
import { setState, useStore } from "@/lib/store";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { T } from "./Text";
import { useTheme, space } from "./theme";

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
      <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.sm }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.recessed, alignItems: "center", justifyContent: "center" }}>
          <ShieldCheck size={28} color={t.foreground} strokeWidth={1.75} />
        </View>
        <T size="lg" weight="semibold" style={{ textAlign: "center" }}>
          Allow installing your apps
        </T>
        <T size="sm" tone="muted" style={{ textAlign: "center" }}>
          {`Android asks once before ${name ?? "your app"} can be installed. Turn on “Allow from this source”, then come back.`}
        </T>
      </View>
      <View style={{ gap: space.sm, marginTop: space.lg }}>
        <Button
          testID="grant-install"
          label="Allow"
          size="xl"
          onPress={() => {
            // Keep needInstallPermission: the install continues when we're back in front.
            AnyAppNative?.openInstallPermissionSettings();
          }}
        />
        <Button label="Not now" variant="ghost" onPress={close} />
      </View>
    </Sheet>
  );
}
