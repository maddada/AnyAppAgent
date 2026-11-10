import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, Pressable, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUp, ChevronLeft, Square } from "lucide-react-native";
import { ChatRow } from "@/chat/ChatRows";
import { buildRows } from "@/chat/timeline";
import { describeApp } from "@/lib/describe";
import { installApp, launchApp } from "@/lib/installer";
import type { App, ChatItem } from "@/lib/protocol";
import { askForNotificationsOnce, loadChat } from "@/lib/session";
import { appAction, useStore } from "@/lib/store";
import { AppIcon } from "@/ui/AppIcon";
import { Button, IconButton } from "@/ui/Button";
import { useKeyboardHeight } from "@/ui/Sheet";
import { Spinner } from "@/ui/Spinner";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, elevation, icon, radius, size, space, typeStyle, useTheme } from "@/ui/theme";

const EMPTY: ChatItem[] = [];
/** The composer grows to six lines of type.body, then scrolls (COMPONENTS.md, Composer). */
const COMPOSER_MAX_LINES = 6;

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = String(id);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const app = useStore((s) => s.apps[appId]);
  const items = useStore((s) => s.chats[appId] ?? EMPTY);
  const loaded = useStore((s) => !!s.chatLoaded[appId]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadChat(appId).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [appId]);

  const rows = useMemo(() => buildRows(items, app).reverse(), [items, app]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: keyboard > 0 ? keyboard : 0 }}>
      <Header app={app} />
      <FlatList
        inverted
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => <ChatRow row={item} app={app} />}
        // Inverted list: paddingTop is the bottom edge.
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, gap: space.md }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        ListFooterComponent={
          loaded ? undefined : (
            <View style={{ padding: space["2xl"], alignItems: "center" }}>
              {loadError ? (
                <StateLine kind="problem" label={loadError} role="row" lines={0} />
              ) : (
                <Spinner color={t.working} />
              )}
            </View>
          )
        }
        style={{ backgroundColor: t.bg }}
      />
      <Composer app={app} bottomInset={keyboard > 0 ? space.xs : insets.bottom + space.xs} />
    </View>
  );
}

function Header({ app }: { app: App | undefined }) {
  const t = useTheme();
  const pkg = useStore((s) => (app ? s.packages[app.packageName] : undefined));
  const install = useStore((s) => (app ? s.installs[app.id] : undefined));
  const state = app ? describeApp(app, pkg, install) : null;
  const action = app ? appAction(app, pkg) : "notReady";
  const installing = !!install && ["waiting", "downloading", "checking", "installing", "confirm"].includes(install.phase);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: size.chatHeaderHeight,
        paddingLeft: space.xs,
        paddingRight: space.lg,
        gap: space.sm,
        borderBottomWidth: border.width,
        borderBottomColor: t.border,
      }}
    >
      <IconButton testID="chat-back" icon={ChevronLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      {app ? <AppIcon app={app} size={size.appIconSmall} /> : null}
      <View style={{ flex: 1, marginLeft: space.xs }}>
        <T variant="heading" numberOfLines={1}>
          {app?.name ?? ""}
        </T>
        {state ? <StateLine kind={state.kind} label={state.label} role="caption" /> : null}
      </View>
      {app && action !== "notReady" && !installing ? (
        <Button
          testID="chat-header-action"
          label={action === "open" ? "Open" : "Install"}
          variant="quiet"
          small
          onPress={() => (action === "open" ? launchApp(app) : void installApp(app))}
        />
      ) : null}
    </View>
  );
}

function Composer({ app, bottomInset }: { app: App | undefined; bottomInset: number }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const [text, setText] = useState("");
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = app?.status === "working";
  const hasText = text.trim().length > 0;
  const showStop = running && !hasText;
  const canSend = !!client && !!app && hasText && !sending;
  const body = typeStyle("body");

  const send = async () => {
    if (!canSend || !client || !app) return;
    const message = text.trim();
    setSending(true);
    setError(null);
    try {
      await client.send(app.id, { text: message });
      setText("");
      input.current?.blur();
      Keyboard.dismiss();
      void askForNotificationsOnce();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (!client || !app) return;
    try {
      await client.cancel(app.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't stop it.");
    }
  };

  const buttonFill = showStop || !hasText ? t.surfaceSunken : t.accent;
  return (
    <View style={{ paddingTop: space.sm, paddingHorizontal: space.md, paddingBottom: bottomInset, backgroundColor: t.bg }}>
      {error ? (
        <View style={{ paddingHorizontal: space.xs, paddingBottom: space.sm }}>
          <StateLine kind="problem" label={error} role="caption" lines={0} />
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          minHeight: size.composerMinHeight,
          borderRadius: radius.composer,
          backgroundColor: t.fieldBg,
          borderWidth: border.width,
          borderColor: t.fieldBorder,
          paddingLeft: space.lg,
          gap: space.sm,
          ...elevation(t.mode, 1),
        }}
      >
        <TextInput
          testID="composer-input"
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder={app?.status === "creating" ? "Your app is being set up…" : "Ask for a change"}
          placeholderTextColor={t.textTertiary}
          cursorColor={t.accent}
          selectionColor={t.accent}
          multiline
          textAlignVertical="center"
          style={{
            ...body,
            flex: 1,
            color: t.text,
            minHeight: size.composerMinHeight - border.width * 2,
            maxHeight: (body.lineHeight ?? 0) * COMPOSER_MAX_LINES + space.md * 2,
            paddingVertical: space.md,
          }}
        />
        <View style={{ paddingBottom: (size.composerMinHeight - border.width * 2 - size.sendButton) / 2, paddingRight: (size.composerMinHeight - border.width * 2 - size.sendButton) / 2 }}>
          <Pressable
            testID={showStop ? "composer-stop" : "composer-send"}
            accessibilityLabel={showStop ? "Stop" : "Send"}
            onPress={() => void (showStop ? stop() : send())}
            disabled={!showStop && !canSend}
            style={{ width: size.sendButton, height: size.sendButton, borderRadius: radius.send, backgroundColor: buttonFill, alignItems: "center", justifyContent: "center" }}
          >
            {showStop ? (
              <Square size={icon.size.sm} color={t.text} fill={t.text} strokeWidth={icon.stroke} absoluteStrokeWidth />
            ) : (
              <ArrowUp size={icon.size.md} color={hasText ? t.onAccent : t.textTertiary} strokeWidth={icon.stroke} absoluteStrokeWidth />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

