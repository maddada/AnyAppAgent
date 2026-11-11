// "Like this, but mine" (C:\aa\ideas\ideas.html, Q15): something shared into AnyAppAgent from
// another app. Make a new app from it, or change one of the person's apps; their words say what to
// keep and what to change; the pictures ride in the message as in the chat, the link as text.
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Link2, MessageCircle, Plus, Send, Sparkles, X } from "lucide-react-native";
import { MAX_IMAGES } from "@shared/chat/index";
import { prepare, toUploads } from "@/chat/attachments";
import { useDictation } from "@/lib/dictation";
import { askForNotificationsOnce } from "@/lib/session";
import { dropShare, sharedLink, shareMessage, useSharedIn } from "@/lib/sharedIn";
import { sortedApps, useStore } from "@/lib/store";
import type { App } from "@/lib/protocol";
import { AppIcon } from "@/ui/AppIcon";
import { Button, IconButton } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { DictationNote, MicButton } from "@/ui/MicButton";
import { useKeyboardHeight } from "@/ui/Sheet";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, icon, radius, size, space, useTheme } from "@/ui/theme";

/** The shared pictures, a little larger than the composer's thumbnails. */
const PREVIEW = 120;
const ROW_ICON = 40;

type Target = "new" | "change";

export default function LikeThis() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const item = useSharedIn((s) => s.item);
  const pairing = useStore((s) => s.pairing);
  const client = useStore((s) => s.client);
  const online = useStore((s) => s.connection === "online");
  const apps = useStore((s) => s.apps);
  const list = useMemo(() => sortedApps(apps), [apps]);
  const [target, setTarget] = useState<Target>("new");
  const [appId, setAppId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [words, setWords] = useState("");
  // Dictation into "What to keep and what to change" (src/lib/dictation.ts); it never sends.
  const dictation = useDictation({ value: words, onChange: setWords });
  const listening = dictation.phase === "listening";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = sharedLink(item);
  const pictures = item?.pictures.slice(0, MAX_IMAGES) ?? [];
  const chosen = appId ? apps[appId] : undefined;
  const ready = !!item && !!client && online && (target === "new" ? name.trim().length > 0 : !!chosen);

  const close = () => {
    dropShare();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const send = async () => {
    if (!item || !client || !ready) return;
    dictation.cancel();
    setBusy(true);
    setError(null);
    try {
      const prepared = await Promise.all(pictures.map((p) => prepare(p.uri, p.width, p.height)));
      const images = prepared.length ? { images: toUploads(prepared) } : {};
      const text = shareMessage(item, words, target === "new");
      let open: string;
      if (target === "new") {
        const app = await client.createApp({ name: name.trim(), prompt: text, sharedIn: true, ...images });
        useStore.setState((s) => ({ apps: { ...s.apps, [app.id]: app } }));
        open = app.id;
      } else {
        await client.send(chosen!.id, { text, sharedIn: true, ...images });
        open = chosen!.id;
      }
      dropShare();
      void askForNotificationsOnce();
      router.replace(`/chat/${open}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: keyboard > 0 ? keyboard : insets.bottom, backgroundColor: t.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: size.chatHeaderHeight, paddingLeft: space.xs, paddingRight: space.lg, gap: space.sm, borderBottomWidth: border.width, borderBottomColor: t.border }}>
        <IconButton testID="like-this-close" icon={X} label="Close" onPress={close} />
        <T variant="heading" numberOfLines={1} style={{ flex: 1, marginLeft: space.xs }}>
          Like this, but mine
        </T>
      </View>
      {!item ? (
        <View style={{ padding: size.screenGutter, gap: space.lg }}>
          <T variant="body" color="textSecondary">
            Nothing was shared. In another app, tap Share on a screenshot, a picture or a link, then pick AnyAppAgent.
          </T>
          <Button label="Back to your apps" variant="quiet" onPress={close} />
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: size.screenGutter, gap: space.xl, paddingBottom: space["3xl"] }}>
          <View style={{ gap: space.sm }}>
            <T variant="eyebrow" color="textTertiary">
              What you shared
            </T>
            {pictures.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                {pictures.map((p) => (
                  <Image
                    key={p.uri}
                    testID="like-this-picture"
                    source={{ uri: p.uri }}
                    style={{ width: Math.round((PREVIEW * Math.min(p.width / p.height, 1.6)) || PREVIEW), height: PREVIEW, borderRadius: radius.card, backgroundColor: t.surfaceSunken, borderWidth: border.width, borderColor: t.border }}
                    contentFit="cover"
                  />
                ))}
              </ScrollView>
            ) : null}
            {link || (item.text && !pictures.length) ? <SharedText link={link} text={item.text} subject={item.subject} /> : null}
            {item.skipped ? (
              <T variant="caption" color="textSecondary">
                {item.skipped === 1 ? "One file was not a picture, so it was left out." : `${item.skipped} files were not pictures, so they were left out.`}
              </T>
            ) : null}
          </View>

          <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
            <Choice testID="like-this-new" icon={Sparkles} title="Make a new app" line="An app like this one, made yours." selected={target === "new"} onPress={() => setTarget("new")} />
            <Choice
              testID="like-this-change"
              icon={MessageCircle}
              title="Change one of my apps"
              line={list.length ? "Bring this into an app you already have." : "You have no apps yet."}
              selected={target === "change"}
              disabled={!list.length}
              onPress={() => setTarget("change")}
            />
          </View>

          {target === "new" ? (
            <Field testID="like-this-name" label="Name" value={name} onChangeText={setName} placeholder="For example, Kettle Timer" maxLength={40} autoCapitalize="words" />
          ) : (
            <View style={{ gap: space.sm }}>
              <T variant="label">Which app?</T>
              <View style={{ borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.listBg, overflow: "hidden" }}>
                {list.map((app, i) => (
                  <AppRow key={app.id} app={app} selected={app.id === appId} first={i === 0} onPress={() => setAppId(app.id)} />
                ))}
              </View>
            </View>
          )}

          <Field
            testID="like-this-words"
            label="What to keep and what to change"
            value={words}
            onChangeText={setWords}
            placeholder={listening ? "Listening..." : "Keep the big timer and the calm colours. Change the sounds, and let me set two timers."}
            multiline
            inputStyle={listening ? { borderWidth: border.focusWidth, borderColor: t.problem } : undefined}
            trailing={<MicButton dictation={dictation} testID="like-this-mic" />}
          />
          <DictationNote dictation={dictation} style={{ marginTop: -space.sm }} />

          <View style={{ gap: space.sm }}>
            {error ? <StateLine kind="problem" label={error} role="caption" lines={0} /> : null}
            {!pairing ? (
              <StateLine kind="problem" label="Connect your PC first." role="caption" lines={0} />
            ) : !online ? (
              <StateLine kind="problem" label="Not connected to your PC." role="caption" lines={0} />
            ) : null}
            <Button
              testID="like-this-send"
              label={target === "new" ? "Make it" : chosen ? `Send to ${chosen.name}` : "Send"}
              icon={target === "new" ? Plus : Send}
              disabled={!ready}
              busy={busy}
              onPress={() => void send()}
            />
            <T variant="caption" color="textSecondary" style={{ textAlign: "center" }}>
              {target === "change" && !chosen
                ? "Pick the app to change."
                : target === "new" && !name.trim()
                  ? "Give the new app a name."
                  : link
                    ? "The agent opens the link if it can, and tells you if it could not see it."
                    : "The agent sees what you shared and makes it yours."}
            </T>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function SharedText({ link, text, subject }: { link: string | null; text: string | null; subject: string | null }) {
  const t = useTheme();
  let host = "";
  if (link) {
    const m = link.match(/^https?:\/\/([^/?#]+)/i);
    host = m ? m[1].replace(/^www\./i, "") : "";
  }
  return (
    <View testID="like-this-link" style={{ flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface }}>
      <View style={{ width: ROW_ICON, height: ROW_ICON, borderRadius: radius.badge, backgroundColor: t.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
        <Link2 size={icon.size.md} color={t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <T variant="row" numberOfLines={2}>
          {subject ?? (host || "Shared text")}
        </T>
        <T variant="caption" color="textSecondary" numberOfLines={3} selectable>
          {link ?? text ?? ""}
        </T>
      </View>
    </View>
  );
}

function Choice({
  testID,
  icon: Icon,
  title,
  line,
  selected,
  disabled,
  onPress,
}: {
  testID: string;
  icon: typeof Sparkles;
  title: string;
  line: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${title}. ${line}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        // The thicker selected line eats into the padding, so the content never moves.
        padding: space.md - (selected ? border.focusWidth - border.width : 0),
        borderRadius: radius.card,
        borderWidth: selected ? border.focusWidth : border.width,
        borderColor: selected ? t.accent : t.border,
        backgroundColor: pressed ? t.selectedBg : t.fieldBg,
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <Icon size={icon.size.md} color={selected ? t.accent : t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
      <View style={{ flex: 1, gap: space.hair }}>
        <T variant="row">{title}</T>
        <T variant="caption" color="textSecondary">
          {line}
        </T>
      </View>
    </Pressable>
  );
}

function AppRow({ app, selected, first, onPress }: { app: App; selected: boolean; first: boolean; onPress: () => void }) {
  const t = useTheme();
  const dot = 20;
  return (
    <Pressable
      testID={`like-this-app-${app.slug}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={app.name}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: size.touch + space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderTopWidth: first ? 0 : border.width,
        borderTopColor: t.border,
        backgroundColor: pressed || selected ? t.selectedBg : "transparent",
      })}
    >
      <AppIcon app={app} size={ROW_ICON} />
      <T variant="row" numberOfLines={1} style={{ flex: 1 }}>
        {app.name}
      </T>
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, borderWidth: border.focusWidth, borderColor: selected ? t.accent : t.borderStrong, alignItems: "center", justifyContent: "center" }}>
        {selected ? <View style={{ width: dot / 2, height: dot / 2, borderRadius: dot / 4, backgroundColor: t.accent }} /> : null}
      </View>
    </Pressable>
  );
}
