import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, Pressable, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, ArrowUp, ChevronDown, ListChecks } from "lucide-react-native";
import { ChatRow, PlanEntries } from "@/chat/ChatRows";
import { buildRows } from "@/chat/timeline";
import { actionLabel, describeApp } from "@/lib/describe";
import { installApp, launchApp } from "@/lib/installer";
import type { App, ChatItem } from "@/lib/protocol";
import { askForNotificationsOnce, loadChat } from "@/lib/session";
import { appAction, useStore } from "@/lib/store";
import { AppIcon } from "@/ui/AppIcon";
import { IconButton } from "@/ui/Button";
import { useKeyboardHeight } from "@/ui/Sheet";
import { Shine } from "@/ui/Shine";
import { T } from "@/ui/Text";
import { font, radius, sizes, space, type as typeScale, useTheme } from "@/ui/theme";

const EMPTY: ChatItem[] = [];

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
  const plan = useMemo(() => {
    if (app?.status !== "working") return null;
    for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "plan") return items[i].plan ?? null;
    return null;
  }, [items, app?.status]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: keyboard > 0 ? keyboard : 0 }}>
      <Header app={app} />
      <FlatList
        inverted
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => <ChatRow row={item} app={app} />}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.sm, maxWidth: 760, width: "100%", alignSelf: "center" }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        ListFooterComponent={
          loaded ? undefined : (
            <View style={{ padding: space.xxl, alignItems: "center" }}>
              {loadError ? (
                <T size="sm" tone="destructive">
                  {loadError}
                </T>
              ) : (
                <Shine style={{ ...typeScale.sm, fontFamily: font.regular, color: t.mutedForeground }}>Loading…</Shine>
              )}
            </View>
          )
        }
      />
      {plan ? <TodoCard entries={plan} /> : null}
      <Composer app={app} bottomInset={keyboard > 0 ? 8 : insets.bottom + 8} />
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
    <View style={{ flexDirection: "row", alignItems: "center", height: 60, paddingLeft: space.xs, paddingRight: space.md, gap: space.sm, borderBottomWidth: 1, borderBottomColor: t.seam }}>
      <IconButton testID="chat-back" icon={ArrowLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      {app ? <AppIcon app={app} size={34} /> : null}
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <T size="base" weight="semibold" numberOfLines={1}>
          {app?.name ?? ""}
        </T>
        {state ? (
          <Shine active={state.live} style={{ ...typeScale.xs, fontSize: 13, lineHeight: 17, fontFamily: font.regular, color: t.mutedForeground }}>
            {state.label}
          </Shine>
        ) : pkg ? (
          <T size="xs" tone="subtle" style={{ fontSize: 13, lineHeight: 17 }}>
            On your phone
          </T>
        ) : null}
      </View>
      {app && action !== "notReady" && !installing ? (
        <Pressable
          testID="chat-header-action"
          onPress={() => (action === "open" ? launchApp(app) : void installApp(app))}
          style={({ pressed }) => ({
            height: 34,
            paddingHorizontal: space.md,
            borderRadius: 17,
            backgroundColor: action === "open" ? t.secondary : t.primary,
            justifyContent: "center",
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <T size="xs" weight="semibold" style={{ color: action === "open" ? t.foreground : t.primaryForeground }}>
            {actionLabel(action)}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** bb's todo card above the composer: "2/5 complete", opens to the list. */
function TodoCard({ entries }: { entries: NonNullable<ChatItem["plan"]> }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const done = entries.filter((e) => e.status === "completed").length;
  const order = { in_progress: 0, pending: 1, completed: 2 } as const;
  const sorted = [...entries].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <View style={{ marginHorizontal: space.lg, marginBottom: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, backgroundColor: t.raised, overflow: "hidden" }}>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36, paddingHorizontal: space.md }}>
        <ListChecks size={16} color={t.mutedForeground} strokeWidth={1.75} />
        <Shine style={{ ...typeScale.xs, fontFamily: font.medium, color: t.foreground, flex: 1 }}>{`${done}/${entries.length} complete`}</Shine>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <ChevronDown size={16} color={t.subtleForeground} strokeWidth={1.75} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ maxHeight: 200, paddingHorizontal: space.xs, paddingBottom: space.sm }}>
          <PlanEntries entries={sorted} />
        </View>
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
  const showStop = running && text.trim().length === 0;
  const canSend = !!client && !!app && text.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend || !client || !app) return;
    const body = text.trim();
    setSending(true);
    setError(null);
    try {
      await client.send(app.id, { text: body });
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

  return (
    <View style={{ paddingHorizontal: space.md, paddingBottom: bottomInset, backgroundColor: t.background }}>
      {error ? (
        <T size="xs" tone="destructive" style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
          {error}
        </T>
      ) : null}
      <View
        style={{
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.background,
          shadowColor: t.shadowColor,
          shadowOpacity: t.dark ? 0.26 : 0.07,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
          elevation: 3,
        }}
      >
        <TextInput
          testID="composer-input"
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder={app?.status === "creating" ? "Your app is being set up…" : "Ask for a change"}
          placeholderTextColor={t.placeholder}
          multiline
          textAlignVertical="top"
          style={{
            ...typeScale.sm,
            lineHeight: 24,
            fontFamily: font.regular,
            color: t.foreground,
            minHeight: 56,
            maxHeight: 180,
            paddingLeft: space.lg,
            paddingRight: sizes.composerTrailing,
            paddingTop: space.md,
            paddingBottom: space.md,
          }}
        />
        <View style={{ position: "absolute", right: 10, bottom: 10 }}>
          {showStop ? (
            <Pressable
              testID="composer-stop"
              accessibilityLabel="Stop"
              onPress={() => void stop()}
              style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: t.secondary, alignItems: "center", justifyContent: "center" }}
            >
              <View style={{ width: 13, height: 13, borderRadius: 2, backgroundColor: t.foreground }} />
            </Pressable>
          ) : (
            <Pressable
              testID="composer-send"
              accessibilityLabel="Send"
              onPress={() => void send()}
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.md,
                backgroundColor: t.primary,
                alignItems: "center",
                justifyContent: "center",
                opacity: canSend ? 1 : 0.5,
              }}
            >
              <ArrowUp size={18} color={t.primaryForeground} strokeWidth={2.25} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
