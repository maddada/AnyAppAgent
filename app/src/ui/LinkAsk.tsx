// The desktop asked this phone to link its PC to the Kiwimake account (docs/CLOUD.md section 3,
// "Signed in once, on either side"; the account.asked event). A notice on the home screen: the
// text takes the full width, the buttons go below it, aligned right.
import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { cloudMessage } from "@/lib/cloud";
import { linkPairedPc } from "@/lib/pcLink";
import { setState, useStore } from "@/lib/store";
import { Button } from "@/ui/Button";
import { T } from "@/ui/Text";
import { border, radius, space, useTheme } from "@/ui/theme";

export function LinkAskBanner() {
  const t = useTheme();
  const asked = useStore((s) => s.accountAsked);
  const signedIn = useStore((s) => s.cloudAuth === "signedIn");
  const online = useStore((s) => s.connection === "online");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!asked || !online) return null;
  return (
    <View testID="link-ask" style={{ gap: space.sm, padding: space.lg, borderRadius: radius.card, backgroundColor: t.surface, borderWidth: border.width, borderColor: t.border, marginBottom: space.md }}>
      <T variant="body">Link {asked} to your Kiwimake account?</T>
      <T variant="label" color="textSecondary">
        {signedIn
          ? "Your PC can then share your apps, publish web apps and move apps to the cloud for you. You will not need to sign in on the PC."
          : "Sign in on this phone first; your PC then uses the same account."}
      </T>
      {error ? <T color="problem">{error}</T> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.xs }}>
        <Button small variant="text" label="Not now" onPress={() => setState({ accountAsked: null })} testID="link-ask-dismiss" />
        {signedIn ? (
          <Button
            small
            label="Link"
            busy={busy}
            testID="link-ask-go"
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await linkPairedPc();
              } catch (e) {
                setError(cloudMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <Button small label="Sign in" onPress={() => router.push("/sign-in")} testID="link-ask-sign-in" />
        )}
      </View>
    </View>
  );
}
