// The Kiwimake account (docs/CLOUD.md, "One account, two places"): who is signed in, the places
// that make their apps (this phone's PC, the cloud) with "Add" for the missing one, credits and
// plan, "Use the cloud when my PC is off", and sign out. Without an account it offers sign-in.
import { useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation } from "convex/react";
import { linkPairedPc, pcLinkedHere, unlinkPairedPc } from "@/lib/pcLink";
import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowLeft, ChevronRight, Cloud, CreditCard, LogOut, Monitor } from "lucide-react-native";
import { api, cloudMessage } from "@/lib/cloud";
import { useStore } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { credits } from "@/ui/CloudBits";
import { T } from "@/ui/Text";
import { border, icon, radius, size, space, useTheme } from "@/ui/theme";

function Row({ icon: Icon, title, line, action, onPress, testID }: { icon: typeof Cloud; title: string; line: string; action?: string; onPress?: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.lg, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? t.selectedBg : "transparent" })}
    >
      <Icon size={icon.size.lg} strokeWidth={1.75} color={t.textSecondary} />
      <View style={{ flex: 1 }}>
        <T variant="row">{title}</T>
        <T variant="caption" color="textSecondary">
          {line}
        </T>
      </View>
      {action ? (
        <T variant="buttonSmall" color="accent">
          {action}
        </T>
      ) : onPress ? (
        <ChevronRight size={icon.size.md} strokeWidth={1.75} color={t.textTertiary} />
      ) : null}
    </Pressable>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface, overflow: "hidden" }}>{children}</View>;
}

export default function AccountScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const account = useStore((s) => s.account);
  const signedIn = useStore((s) => s.cloudAuth === "signedIn");
  const pairing = useStore((s) => s.pairing);
  const serverName = useStore((s) => s.serverName);
  const pcOnline = useStore((s) => s.connection === "online");
  const { signOut } = useAuthActions();
  const setSwitch = useMutation(api.accounts.setPcOffSwitch);
  const revokePc = useMutation(api.accounts.revokePcLink);
  const pcAccount = useStore((s) => s.pcAccount);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const header = (
    <View style={{ flexDirection: "row", paddingHorizontal: size.screenGutter, paddingTop: space.sm }}>
      <IconButton icon={ArrowLeft} label="Back" onPress={back} />
    </View>
  );

  if (!signedIn || !account) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
        {header}
        <View style={{ paddingHorizontal: size.screenGutter, gap: space.lg }}>
          <T variant="display">Kiwimake account</T>
          <T variant="lede" color="textSecondary">
            Making apps on your PC needs no account. Sign in to add the cloud, family circles or a web address for your apps.
          </T>
          <View style={{ alignItems: "flex-end" }}>
            <Button label="Sign in" onPress={() => router.push("/sign-in")} testID="account-sign-in" />
          </View>
        </View>
      </View>
    );
  }

  const github = account.cloud.github;
  const linkedHere = pcLinkedHere(account.pcs);
  const otherAccount = pcAccount?.state === "linked" && !linkedHere ? (pcAccount.account?.email ?? (pcAccount.account?.test ? "a test account" : "another account")) : null;
  const pcLine = !pcOnline
    ? "Paired, off right now"
    : linkedHere
      ? "Paired, and linked to this account"
      : otherAccount
        ? `Paired, linked to ${otherAccount}`
        : "Paired with this phone";
  const otherPcs = account.pcs.filter((p) => !(pairing && p.name === serverName));
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setLinking(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(cloudMessage(e));
    } finally {
      setLinking(null);
    }
  };
  const who = account.email ?? account.name ?? (account.anonymous ? "A test account (dev)" : "Your account");
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: size.screenGutter, paddingBottom: insets.bottom + space["2xl"], gap: space.xl }}>
        <View>
          <T variant="display">Kiwimake account</T>
          <T variant="lede" color="textSecondary" style={{ marginTop: space.xs }} testID="account-who">
            {who}
          </T>
        </View>

        <View style={{ gap: space.sm }}>
          <T variant="eyebrow" color="textTertiary">
            Where your apps are made
          </T>
          <Card>
            {pairing ? (
              <Row icon={Monitor} title={serverName ?? "Your PC"} line={pcLine} testID="account-pc" />
            ) : (
              <Row icon={Monitor} title="My PC" line="Make apps on your own computer with your Claude" action="Add" onPress={() => router.push("/connect")} testID="account-add-pc" />
            )}
            <View style={{ height: border.width, backgroundColor: t.border }} />
            {github?.connected ? (
              <Row icon={Cloud} title="Cloud" line={`GitHub: ${github.login}`} onPress={() => router.push("/github")} testID="account-cloud" />
            ) : (
              <Row
                icon={Cloud}
                title="Cloud"
                line={github ? "GitHub is disconnected" : "Connect GitHub to make apps in the cloud"}
                action={github ? "Reconnect" : "Add"}
                onPress={() => router.push("/github")}
                testID="account-add-cloud"
              />
            )}
          </Card>
        </View>

        {pairing && pcOnline && pcAccount ? (
          <Card>
            <View style={{ padding: space.lg, gap: space.md }} testID="account-pc-link">
              <T>
                {linkedHere
                  ? `${serverName ?? "Your PC"} can share your apps, publish web apps and move apps to the cloud for this account.`
                  : otherAccount
                    ? `${serverName ?? "Your PC"} is linked to ${otherAccount}. Link it to this account instead?`
                    : `Link ${serverName ?? "your PC"} to this account, so it can share your apps, publish web apps and move apps to the cloud. You will not need to sign in on the PC.`}
              </T>
              <View style={{ alignItems: "flex-end" }}>
                {linkedHere ? (
                  <Button small variant="text" label="Unlink this PC" busy={linking === "unlink"} onPress={() => act("unlink", unlinkPairedPc)} testID="account-pc-unlink" />
                ) : (
                  <Button small label="Link this PC" busy={linking === "link"} onPress={() => act("link", linkPairedPc)} testID="account-pc-link-go" />
                )}
              </View>
            </View>
          </Card>
        ) : null}

        {otherPcs.length ? (
          <View style={{ gap: space.sm }}>
            <T variant="eyebrow" color="textTertiary">
              Other linked PCs
            </T>
            <Card>
              {otherPcs.map((p, i) => (
                <View key={p.id}>
                  {i ? <View style={{ height: border.width, backgroundColor: t.border }} /> : null}
                  <Row
                    icon={Monitor}
                    title={p.name}
                    line={p.fromName ? `Linked from ${p.fromName}` : p.linkedFrom === "pc" ? "Signed in on the PC" : "Linked from a phone"}
                    action={linking === p.id ? "Unlinking" : "Unlink"}
                    onPress={() => act(p.id, () => revokePc({ id: p.id }))}
                    testID={`account-other-pc-${i}`}
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <T variant="eyebrow" color="textTertiary">
            Credits
          </T>
          <Card>
            <Row icon={CreditCard} title={`${credits(Math.round(account.credits * 1000))} left`} line={`Plan: ${account.plan.name}`} onPress={() => router.push("/plan")} testID="account-plan" />
          </Card>
        </View>

        {pairing ? (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg, padding: space.lg }}>
              <View style={{ flex: 1 }}>
                <T variant="row">Use the cloud when my PC is off</T>
                <T variant="caption" color="textSecondary">
                  A change you ask for while your PC is off can run in the cloud, using credits.
                </T>
              </View>
              <Switch
                value={account.pcOffSwitch}
                onValueChange={(on) => void setSwitch({ on }).catch((e) => setError(cloudMessage(e)))}
                testID="account-pcoff"
                trackColor={{ true: t.accent, false: t.borderStrong }}
              />
            </View>
          </Card>
        ) : null}

        {error ? <T color="problem">{error}</T> : null}
        <View style={{ alignItems: "flex-end" }}>
          <Button
            label="Sign out"
            variant="quiet"
            icon={LogOut}
            busy={leaving}
            testID="account-sign-out"
            onPress={async () => {
              setLeaving(true);
              try {
                await signOut();
                router.replace("/");
              } finally {
                setLeaving(false);
              }
            }}
          />
        </View>
      </ScrollView>
    </View>
  );
}
