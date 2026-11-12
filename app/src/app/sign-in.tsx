// Signing in to the Kiwimake account (docs/CLOUD.md, "One account, two places"): Google, or a
// 6-digit code by email. Opened from first run ("In the cloud", "Sign in"), and from the features
// that need the account, which say why in one line (?reason=circle | web | cloud | move | pcoff).
// After sign-in it goes where ?then says: "cloud" connects GitHub next.
import { useEffect, useRef, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthActions } from "@convex-dev/auth/react";
import { X } from "lucide-react-native";
import { CLOUD_DEV, cloudMessage } from "@/lib/cloud";
import { useStore } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { T } from "@/ui/Text";
import { size, space, useTheme } from "@/ui/theme";

const RETURN_TO = "anyappagent://sign-in";

const REASONS: Record<string, string> = {
  cloud: "Your account keeps your cloud apps, their chats and your credits.",
  circle: "Family circles need a Kiwimake account, so your family can find your apps.",
  web: "Putting a web app online at an address needs a Kiwimake account.",
  move: "Moving an app between your PC and the cloud needs a Kiwimake account.",
  pcoff: "Changes while your PC is off run in the cloud, which needs a Kiwimake account.",
};

export default function SignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuthActions();
  const params = useLocalSearchParams<{ code?: string; then?: string; reason?: string }>();
  const signedIn = useStore((s) => s.cloudAuth === "signedIn");
  const account = useStore((s) => s.account);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef<string | null>(null);
  const then = params.then ?? "";
  const reason = REASONS[params.reason ?? then] ?? null;

  // Back from Google: the deep link carries ?code=, which finishes the sign-in.
  useEffect(() => {
    const c = params.code;
    if (!c || finished.current === c) return;
    finished.current = c;
    setBusy("google");
    signIn("google", { code: c })
      .catch((e: Error) => setError(cloudMessage(e)))
      .finally(() => setBusy(null));
  }, [params.code, signIn]);

  // Signed in: on to GitHub for the cloud (when it is not connected yet), else home.
  useEffect(() => {
    if (!signedIn || !account) return;
    if (then === "cloud" && !account.cloud.github?.connected) router.replace("/github");
    else router.replace("/");
  }, [signedIn, account, then]);

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

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: size.screenGutter, paddingTop: space.sm }}>
        <IconButton icon={X} label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: size.screenGutter, paddingBottom: insets.bottom + space["2xl"], gap: space.lg }}>
        <T variant="display">Sign in to Kiwimake</T>
        <T variant="lede" color="textSecondary">
          {reason ?? "One account for your PC and the cloud."}
        </T>
        <Button
          label="Continue with Google"
          busy={busy === "google"}
          testID="sign-in-google"
          onPress={() =>
            run("google", async () => {
              const { redirect } = await signIn("google", { redirectTo: RETURN_TO });
              if (redirect) await Linking.openURL(redirect.toString());
            })
          }
        />
        <T variant="label" color="textSecondary" style={{ marginTop: space.md }}>
          Or get a code by email
        </T>
        <Field value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" testID="sign-in-email" />
        {sent ? (
          <>
            <T variant="caption" color="textSecondary">
              We sent a 6-digit code to {email.trim()}. It works for 10 minutes.
            </T>
            <Field value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} placeholder="6-digit code" keyboardType="number-pad" maxLength={6} testID="sign-in-code" />
            <View style={{ alignItems: "flex-end" }}>
              <Button label="Sign in" busy={busy === "code"} disabled={code.length !== 6} onPress={() => run("code", () => signIn("resend-otp", { email: email.trim(), code }))} testID="sign-in-code-go" />
            </View>
          </>
        ) : (
          <View style={{ alignItems: "flex-end" }}>
            <Button
              label="Send me a code"
              variant="quiet"
              busy={busy === "send"}
              disabled={!emailOk}
              testID="sign-in-send"
              onPress={() =>
                run("send", async () => {
                  await signIn("resend-otp", { email: email.trim() });
                  setSent(true);
                })
              }
            />
          </View>
        )}
        {CLOUD_DEV ? (
          <View style={{ alignItems: "flex-end" }}>
            <Button label="Try it without an account (dev build)" variant="text" busy={busy === "anon"} onPress={() => run("anon", () => signIn("anonymous"))} testID="sign-in-anon" />
          </View>
        ) : null}
        {error ? <T color="problem">{error}</T> : null}
      </ScrollView>
    </View>
  );
}
