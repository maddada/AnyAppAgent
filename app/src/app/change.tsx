// "Change this app" (docs/CHANGE-THIS-APP.md): an app made with Kiwimake opens
// anyappagent://change?package=&name=&owner=&repo=&build=&version=&screen= from the row in its
// settings. On the person's own app this goes straight to its chat. On someone else's app: Suggest a
// change (a text to the owner through Android's share menu) and, when this phone is paired with a
// PC, Make my own version (the PC makes a separate app from that version's published code).
import { useEffect, useState } from "react";
import { BackHandler, KeyboardAvoidingView, Pressable, ScrollView, Share, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Copy, MessageSquareText, X } from "lucide-react-native";
import { ownVersionName, readChangeLink, suggestionText } from "@shared/chat/index";
import { upsertApp, useStore } from "@/lib/store";
import { updatePrefs } from "@/lib/session";
import { Button, IconButton } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, radius, size, space, useTheme } from "@/ui/theme";

type Mode = "choose" | "suggest" | "own";

export default function ChangeThisApp() {
  const params = useLocalSearchParams<Record<string, string>>();
  const link = readChangeLink(params);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pairing = useStore((s) => s.pairing);
  const client = useStore((s) => s.client);
  const online = useStore((s) => s.connection === "online");
  const appsLoaded = useStore((s) => s.appsLoaded);
  const mine = useStore((s) => (link ? Object.values(s.apps).find((a) => a.packageName === link.packageName) : undefined));
  const prefs = useStore((s) => s.prefs);
  const [mode, setMode] = useState<Mode>("choose");
  const [yourName, setYourName] = useState(prefs.yourName ?? "");
  const [words, setWords] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // A new tap of the row (another app, or the same one again) starts from the choices.
  const linkKey = JSON.stringify(link);
  const [lastLink, setLastLink] = useState(linkKey);
  if (linkKey !== lastLink) {
    setLastLink(linkKey);
    setMode("choose");
    setSent(false);
    setError(null);
    setWords("");
    setName("");
  }

  // The owner: straight to the app's chat, keyboard up (as Change it on its tile).
  useEffect(() => {
    if (!mine) return;
    console.log(`change: ${mine.packageName} is this person's own app; opening its chat`);
    router.replace(`/chat/${mine.id}`);
  }, [mine]);

  // Back from a form goes back to the choices, not out.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (mode === "choose") return false;
      setMode("choose");
      return true;
    });
    return () => sub.remove();
  }, [mode]);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  // Paired and the app list not here yet: wait for it before deciding whose app this is.
  const deciding = Boolean(link && pairing && !appsLoaded && !mine);
  const appName = link?.appName ?? "This app";
  const owner = link?.owner;
  const ownerLabel = owner ?? "the person who made it";

  const sendSuggestion = async () => {
    if (!link || !words.trim()) return setError("Write what should change first.");
    setError(null);
    updatePrefs({ yourName: yourName.trim() });
    const message = suggestionText({ appName, packageName: link.packageName, from: yourName, text: words, build: link.build });
    try {
      const r = await Share.share({ message });
      console.log(`change: suggestion for ${link.packageName} handed to the share menu (${r.action})`);
      if (r.action === Share.sharedAction) setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The share menu did not open.");
    }
  };

  const makeOwn = async () => {
    if (!link?.repo || !client) return;
    const finalName = name.trim() || ownVersionName(appName, yourName);
    setBusy(true);
    setError(null);
    updatePrefs({ yourName: yourName.trim() });
    try {
      const app = await client.clone({ repo: link.repo, ...(link.build ? { build: link.build } : {}), name: finalName, firstChange: words.trim(), originalName: appName, ...(owner ? { owner } : {}) });
      upsertApp(app);
      console.log(`change: own version ${app.packageName} of ${link.packageName} started`);
      router.replace(`/chat/${app.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your PC could not make it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: size.chatHeaderHeight, paddingLeft: space.xs, paddingRight: space.lg, gap: space.sm, borderBottomWidth: border.width, borderBottomColor: t.border }}>
        <IconButton testID="change-back" icon={mode === "choose" ? X : ChevronLeft} label={mode === "choose" ? "Close" : "Back"} onPress={() => (mode === "choose" ? close() : setMode("choose"))} />
        <View style={{ flex: 1, marginLeft: space.xs }}>
          <T variant="heading" numberOfLines={1}>
            {mode === "suggest" ? "Suggest a change" : mode === "own" ? "Make my own version" : "Change this app"}
          </T>
          <T variant="caption" color="textSecondary" numberOfLines={1}>
            {appName}
          </T>
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space["2xl"] }}>
        {!link ? (
          <StateLine kind="problem" label="This link is not from an app made with Kiwimake." role="row" lines={0} />
        ) : mine || deciding ? (
          <StateLine kind="working" label="Opening..." role="row" />
        ) : mode === "choose" ? (
          <>
            <View style={{ gap: space.xs }}>
              <T variant="title" testID="change-title">{`${appName} is ${owner ? `${owner}'s` : "someone else's"} app`}</T>
              <T variant="callout" color="textSecondary">
                {link.version ? `You have version ${link.version}${owner ? ` from ${owner}` : ""}. ` : ""}
                {`${owner ?? "They"} decide${owner ? "s" : ""} what changes in it. You can suggest a change, or make your own version that is yours to change.`}
              </T>
            </View>
            <Choice
              testID="choice-suggest"
              title={`Suggest a change to ${owner ?? "them"}`}
              text={`You write it, ${owner ?? "they"} decide${owner ? "s" : ""}. It goes as a message (WhatsApp, SMS or email).`}
              onPress={() => setMode("suggest")}
            />
            {pairing ? (
              <Choice
                testID="choice-own"
                title="Make my own version"
                text={
                  link.repo
                    ? "A separate copy on your PC that you change as you like, with your Claude. It installs next to this one."
                    : `${owner ?? "Its maker"} has not shared this app on GitHub, so its code is not available for your own version. Suggest a change instead.`
                }
                disabled={!link.repo}
                onPress={() => setMode("own")}
              />
            ) : (
              <View style={{ gap: space.xs, paddingHorizontal: space.xs }}>
                <T variant="caption" color="textSecondary">
                  Your own version is made by your own PC: a Windows PC with Kiwimake and a Claude plan. Connect one in Kiwimake to make it.
                </T>
                <T variant="caption" color="textTertiary">
                  A way to change apps without a PC, using cloud credits, is planned.
                </T>
              </View>
            )}
            <Button testID="change-cancel" label="Not now" variant="text" onPress={close} />
          </>
        ) : mode === "suggest" ? (
          sent ? (
            <View style={{ gap: space.md }}>
              <StateLine kind="ready" label={`Sent. ${ownerLabel.charAt(0).toUpperCase()}${ownerLabel.slice(1)} decides; if it gets made, your copy updates the next time they publish.`} role="row" lines={0} />
              <Button label="Done" onPress={close} />
            </View>
          ) : (
            <>
              <T variant="callout" color="textSecondary">
                {`Say what you would like changed in ${appName}. It goes to ${ownerLabel} as a message, and they decide.`}
              </T>
              <Field testID="suggest-name" label="Your name" placeholder="So they know who it is from" value={yourName} onChangeText={setYourName} autoCapitalize="words" />
              <Field testID="suggest-text" label="What should change?" placeholder="Bigger numbers, I can't read Isha" value={words} onChangeText={setWords} multiline />
              {error ? <StateLine kind="problem" label={error} role="caption" lines={0} /> : null}
              <Button testID="suggest-send" label="Send suggestion" icon={MessageSquareText} onPress={() => void sendSuggestion()} disabled={!words.trim()} />
            </>
          )
        ) : (
          <>
            <T variant="callout" color="textSecondary">
              {`Your PC gets the code of ${appName}${link.version ? ` ${link.version}` : ""} and makes a separate app from it: its own name, its own place on your PC and GitHub, installed next to ${owner ? `${owner}'s` : "the original"}. Nothing changes in ${owner ? `${owner}'s` : "the original"}, and nothing comes over from it later by itself.`}
            </T>
            <Field testID="own-yourname" label="Your name" value={yourName} onChangeText={setYourName} autoCapitalize="words" />
            <Field testID="own-name" label="Name of your version" placeholder={ownVersionName(appName, yourName)} value={name} onChangeText={setName} />
            <Field testID="own-first" label="First change (optional)" placeholder="Bigger text, and add Tahajjud" value={words} onChangeText={setWords} multiline />
            {!online ? <StateLine kind="problem" label="Your PC is not connected right now." role="caption" lines={0} /> : null}
            {error ? <StateLine kind="problem" label={error} role="caption" lines={0} /> : null}
            <Button testID="own-make" label="Make it" icon={Copy} busy={busy} disabled={busy || !online} onPress={() => void makeOwn()} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Choice({ title, text, onPress, disabled, testID }: { title: string; text: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: space.lg,
        gap: space.xs,
        borderRadius: radius.card,
        borderWidth: border.width,
        borderColor: t.border,
        backgroundColor: pressed ? t.selectedBg : t.surface,
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <T variant="name">{title}</T>
      <T variant="caption" color="textSecondary">
        {text}
      </T>
    </Pressable>
  );
}
