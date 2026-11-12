// Connect GitHub (docs/CLOUD.md, "The code lives on the person's GitHub"): each cloud app's code
// lives in a private repo on the person's own GitHub. The browser installs (or authorizes) the
// Kiwimake GitHub App and comes back here through anyappagent://github.
import { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation } from "convex/react";
import { ArrowLeft, Check, GitBranch } from "lucide-react-native";
import { api, cloudMessage } from "@/lib/cloud";
import { useStore } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { T } from "@/ui/Text";
import { border, icon, radius, size, space, useTheme } from "@/ui/theme";

export default function ConnectGithub() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ ok?: string }>();
  const account = useStore((s) => s.account);
  const connectUrl = useMutation(api.github.connectUrl);
  const disconnect = useMutation(api.github.disconnect);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const github = account?.cloud.github ?? null;
  const connected = Boolean(github?.connected);
  const cameBack = params.ok !== undefined;

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(cloudMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", paddingHorizontal: size.screenGutter, paddingTop: space.sm }}>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: size.screenGutter, paddingBottom: insets.bottom + space["2xl"], gap: space.lg }}>
        <GitBranch size={size.appIconSmall} strokeWidth={1.75} color={t.text} />
        <T variant="display">{connected ? "GitHub is connected" : "Connect GitHub"}</T>
        <T variant="lede" color="textSecondary">
          Your cloud apps’ code is kept in private repositories on your own GitHub account, never by us. Kiwimake can only touch the repositories it makes for your apps.
        </T>
        {connected ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.lg, borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface }}>
            <Check size={icon.size.md} strokeWidth={1.75} color={t.ready} />
            <T style={{ flex: 1 }} testID="github-login">
              Connected as {github?.login}
            </T>
          </View>
        ) : github && !github.connected ? (
          <T color="attentionText">GitHub stopped answering for {github.login}. Connect it again to keep changing your cloud apps; they are all still there.</T>
        ) : null}
        {cameBack && !connected ? (
          <T variant="caption" color="textSecondary">
            Waiting for GitHub to finish. If it said Connected, this changes in a moment.
          </T>
        ) : null}
        <View style={{ alignItems: "flex-end", gap: space.md }}>
          {connected ? (
            <>
              <Button label="Done" onPress={() => router.replace("/")} testID="github-done" />
              <Button label="Disconnect GitHub" variant="text" busy={busy === "off"} onPress={() => run("off", () => disconnect({}))} testID="github-disconnect" />
            </>
          ) : (
            <Button
              label={github ? "Connect GitHub again" : "Connect GitHub"}
              busy={busy === "on"}
              testID="github-connect"
              onPress={() =>
                run("on", async () => {
                  const { url } = (await connectUrl({})) as { url: string };
                  await Linking.openURL(url);
                })
              }
            />
          )}
        </View>
        {error ? <T color="problem">{error}</T> : null}
      </ScrollView>
    </View>
  );
}
