// Kiwimake Cloud, the spike's screen (milestone 0 of docs/CLOUD.md). Not linked from the app:
// opened with `adb shell am start -d anyappagent://cloud-spike <package>`, only in builds made with
// EXPO_PUBLIC_CONVEX_URL. Proves sign-in (Google, a code by email) with Convex Auth and one round
// trip phone -> Convex -> box -> Convex -> phone with the Convex React Native client. Milestone 4
// replaces it with the real cloud mode (sign in, the Convex Client behind api.ts).
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/ui/Button";
import { T } from "@/ui/Text";
import { border, radius, space, typeStyle, useTheme } from "@/ui/theme";

const URL = process.env.EXPO_PUBLIC_CONVEX_URL;
const RETURN_TO = "anyappagent://cloud-spike";
const api = anyApi;

const client = URL ? new ConvexReactClient(URL, { unsavedChangesWarning: false }) : null;

// SecureStore keys allow only letters, digits, ".", "-" and "_".
const safe = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, "_");
const storage = {
  getItem: (k: string) => SecureStore.getItemAsync(safe(k)),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(safe(k), v),
  removeItem: (k: string) => SecureStore.deleteItemAsync(safe(k)),
};

export default function CloudSpike() {
  const t = useTheme();
  if (!client) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, padding: space.xl }}>
        <T variant="title">Cloud</T>
        <T color="textSecondary">This build has no cloud address.</T>
      </SafeAreaView>
    );
  }
  return (
    <ConvexAuthProvider client={client} storage={Platform.OS === "web" ? undefined : storage}>
      <Screen />
    </ConvexAuthProvider>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.textTertiary}
      {...props}
      style={[
        typeStyle("body"),
        { color: t.text, backgroundColor: t.fieldBg, borderColor: t.fieldBorder, borderWidth: border.width, borderRadius: radius.field, paddingHorizontal: space.lg, paddingVertical: space.md },
        props.style,
      ]}
    />
  );
}

function Screen() {
  const t = useTheme();
  const { isAuthenticated, isLoading } = useConvexAuth();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md }}>
          <T variant="title">Make apps in the cloud</T>
          <T variant="caption" color="textSecondary">Spike build. Your apps are made on a cloud machine, no PC needed.</T>
        </View>
        {isLoading ? <T style={{ padding: space.xl }} color="textSecondary">Connecting…</T> : isAuthenticated ? <Chat /> : <SignIn />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  const params = useLocalSearchParams<{ code?: string }>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef<string | null>(null);

  // Back from Google: the deep link carries ?code=, which finishes the sign-in.
  useEffect(() => {
    const c = params.code;
    if (!c || finished.current === c) return;
    finished.current = c;
    setBusy("google");
    signIn("google", { code: c })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  }, [params.code, signIn]);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message.split("\n")[0].slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <Button
        label="Continue with Google"
        busy={busy === "google"}
        onPress={() =>
          run("google", async () => {
            const { redirect } = await signIn("google", { redirectTo: RETURN_TO });
            if (redirect) await Linking.openURL(redirect.toString());
          })
        }
      />
      <T variant="label" color="textSecondary">Or get a code by email</T>
      <Field value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" testID="cloud-email" />
      {sent ? (
        <>
          <Field value={code} onChangeText={setCode} placeholder="6-digit code" keyboardType="number-pad" maxLength={6} testID="cloud-code" />
          <Button label="Sign in" busy={busy === "code"} disabled={code.length !== 6} onPress={() => run("code", () => signIn("resend-otp", { email: email.trim(), code }))} />
        </>
      ) : (
        <Button
          label="Send me a code"
          variant="quiet"
          busy={busy === "send"}
          disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
          onPress={() => run("send", async () => {
            await signIn("resend-otp", { email: email.trim() });
            setSent(true);
          })}
        />
      )}
      <Button label="Try it without an account (dev)" variant="text" busy={busy === "anon"} onPress={() => run("anon", () => signIn("anonymous"))} testID="cloud-anon" />
      {error ? <T color="problem">{error}</T> : null}
    </ScrollView>
  );
}

type Row = { id: string; seq: number; role: "user" | "agent" | "build" | "status"; text: string; apkUrl: string | null; usage: { costMicros: number } | null };

function Chat() {
  const t = useTheme();
  const me = useQuery(api.chat.me, {}) as { email: string | null; anonymous: boolean } | null | undefined;
  const rows = (useQuery(api.chat.messages, {}) ?? []) as Row[];
  const send = useMutation(api.chat.send);
  const { signOut } = useAuthActions();
  const [text, setText] = useState("");
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.xl }}>
        <T variant="caption" color="textSecondary">{me?.email ?? (me?.anonymous ? "Signed in without an account" : "Signed in")}</T>
        <Button label="Sign out" variant="text" small onPress={() => void signOut()} />
      </View>
      <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd()} contentContainerStyle={{ padding: space.xl, gap: space.md }}>
        {rows.map((r) => (
          <View
            key={r.id}
            testID={`cloud-row-${r.role}`}
            style={{
              alignSelf: r.role === "user" ? "flex-end" : "stretch",
              maxWidth: r.role === "user" ? "85%" : "100%",
              backgroundColor: r.role === "user" ? t.bubbleBg : r.role === "build" ? t.readySoft : "transparent",
              borderColor: r.role === "user" ? t.bubbleBorder : "transparent",
              borderWidth: r.role === "user" ? border.width : 0,
              borderRadius: radius.field,
              padding: r.role === "agent" ? 0 : space.md,
              gap: space.sm,
            }}
          >
            <T variant={r.role === "status" ? "caption" : "body"} color={r.role === "status" ? "textSecondary" : r.role === "user" ? "bubbleText" : "text"}>
              {r.text}
            </T>
            {r.apkUrl ? <Button label="Download the APK" small variant="quiet" onPress={() => void Linking.openURL(r.apkUrl!)} testID="cloud-apk" /> : null}
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: space.md, padding: space.lg, borderTopWidth: border.width, borderColor: t.border }}>
        <Field value={text} onChangeText={setText} placeholder="Describe a change" style={{ flex: 1 }} testID="cloud-input" />
        <Button
          label="Send"
          disabled={!text.trim()}
          onPress={() => {
            const body = text.trim();
            setText("");
            void send({ text: body });
          }}
          testID="cloud-send"
        />
      </View>
    </View>
  );
}
