import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowDown, ArrowUp, Camera, ChevronLeft, ClipboardPaste, Image as ImageIcon, ImagePlus, ListTodo, Square, X } from "lucide-react-native";
import { buildRows, composerState, COMPOSER_MAX_LINES, Follower, FOLLOW_WITHIN, mainChatReplying, MAX_IMAGES, type Row } from "@shared/chat/index";
import { clipboardHasImage, pastePicture, pickFromGallery, takePhoto, toUploads, type Attachment } from "@/chat/attachments";
import { ChatRow } from "@/chat/ChatRows";
import { describeApp } from "@/lib/describe";
import { installApp, launchApp } from "@/lib/installer";
import type { App, ChatItem } from "@/lib/protocol";
import { askForNotificationsOnce, loadChat } from "@/lib/session";
import { appAction, drafts, useStore } from "@/lib/store";
import { AppIcon } from "@/ui/AppIcon";
import { Button, IconButton } from "@/ui/Button";
import { useKeyboardHeight } from "@/ui/Sheet";
import { Spinner } from "@/ui/Spinner";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, elevation, icon, radius, size, space, typeStyle, useTheme } from "@/ui/theme";

const EMPTY: ChatItem[] = [];
/** A picture waiting in the composer: 64, the app icon size (no thumbnail token). */
const THUMB = size.appIcon;

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

  // Load the history, and keep trying by itself until it arrives (2, 4, 8, then every 15 s, and at
  // once when the connection comes back); the error line goes away when it does.
  const connection = useStore((s) => s.connection);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    loadChat(appId)
      .then(() => {
        if (!cancelled) setLoadError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(() => setAttempt((a) => a + 1), [2000, 4000, 8000][attempt] ?? 15000);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [appId, attempt]);
  const [lastConnection, setLastConnection] = useState(connection);
  if (connection !== lastConnection) {
    setLastConnection(connection);
    if (connection === "online" && loadError) setAttempt((n) => n + 1);
  }

  const rows = useMemo(() => buildRows(items, app).reverse(), [items, app]);

  // Stay on the newest item while the agent works, unless the user scrolled up to read; then a
  // "Jump to latest" control brings them back (as in bb's thread view). The list is inverted, so
  // offset 0 is the bottom.
  const list = useRef<FlatList<Row>>(null);
  const [follower] = useState(() => new Follower());
  const [pinned, setPinned] = useState(true);
  const follow = () => {
    if (follower.shouldFollow()) list.current?.scrollToOffset({ offset: 0, animated: true });
  };
  const jumpToLatest = () => {
    follower.jump();
    setPinned(true);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: keyboard > 0 ? keyboard : 0 }}>
      <Header app={app} />
      <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        inverted
        data={rows}
        onScroll={(e) => {
          // Inverted list: the distance from the newest item, whichever sign Android reports it with.
          if (follower.scrolled(e.nativeEvent.contentOffset.y)) {
            console.log(`chat: ${follower.pinned ? "following new items" : "reader scrolled up"} (offset ${Math.round(e.nativeEvent.contentOffset.y)})`);
            setPinned(follower.pinned);
          }
        }}
        scrollEventThrottle={64}
        // New rows land at offset 0: when pinned they are followed, otherwise the reader's place is kept.
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: FOLLOW_WITHIN }}
        onContentSizeChange={follow}
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
      {pinned ? null : <JumpToLatest onPress={jumpToLatest} />}
      </View>
      <Composer key={appId} appId={appId} app={app} onSent={jumpToLatest} bottomInset={keyboard > 0 ? space.xs : insets.bottom + space.xs} />
    </View>
  );
}

function JumpToLatest({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: space.md, alignItems: "center" }}>
      <Pressable
        testID="jump-to-latest"
        accessibilityRole="button"
        accessibilityLabel="Jump to latest"
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: size.buttonHeightSmall,
          paddingHorizontal: space.lg,
          borderRadius: radius.full,
          backgroundColor: pressed ? t.selectedBg : t.surfaceOverlay,
          borderWidth: border.width,
          borderColor: t.border,
          ...elevation(t.mode, 2),
        })}
      >
        <ArrowDown size={icon.size.sm} color={t.text} strokeWidth={icon.stroke} absoluteStrokeWidth />
        <T variant="buttonSmall">Jump to latest</T>
      </Pressable>
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
      {app ? <TodoButton app={app} /> : null}
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

/** The app's to-do list, one tap from its chat, with how many ideas are still open. */
function TodoButton({ app }: { app: App }) {
  const t = useTheme();
  const count = app.openTodos ?? 0;
  return (
    <View>
      <IconButton testID="chat-todo" icon={ListTodo} label={count ? `To-do, ${count} open` : "To-do"} color={t.textSecondary} onPress={() => router.push(`/todo/${app.id}`)} />
      {count ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: space.xs, right: space.xs, minWidth: 18, height: 18, paddingHorizontal: space.xs, borderRadius: radius.full, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}
        >
          <T variant="caption" color="onAccent" style={{ fontSize: 11, lineHeight: 14 }}>
            {count > 99 ? "99+" : String(count)}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function Composer({ appId, app, bottomInset, onSent }: { appId: string; app: App | undefined; bottomInset: number; onSent: () => void }) {
  const t = useTheme();
  const client = useStore((s) => s.client);
  const online = useStore((s) => s.connection === "online");
  // The draft (text and pictures) is kept per app while the user moves between apps.
  const [text, setTextState] = useState(() => drafts.get(appId));
  const setText = (v: string) => {
    setTextState(v);
    drafts.set(appId, v);
  };
  const [attached, setAttachedState] = useState<Attachment[]>(() => drafts.attachments(appId));
  const setAttached = (list: Attachment[]) => {
    setAttachedState(list);
    drafts.setAttachments(appId, list);
  };
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tray, setTray] = useState(false);
  const [canPaste, setCanPaste] = useState(false);
  const [adding, setAdding] = useState(false);
  // Send, Queue (the agent is busy: it waits its turn) or Stop: the same rule as the desktop.
  const state = composerState(app, text, { sending, stopping, online: !!client && online, images: attached.length });
  const showStop = state.button === "stop";
  const hasContent = text.trim().length > 0 || attached.length > 0;
  const body = typeStyle("body");
  // A stop lasts until the main chat's turn really ends (with helpers the app can stay "working"
  // while only helpers work: they keep going, and the main chat's Stop is done).
  const replying = mainChatReplying(app);
  const [stoppedTurn, setStoppedTurn] = useState(replying);
  if (replying !== stoppedTurn) {
    setStoppedTurn(replying);
    if (!replying) setStopping(false);
  }

  const openTray = () => {
    setTray(!tray);
    if (!tray) void clipboardHasImage().then(setCanPaste);
  };
  const add = async (get: () => Promise<Attachment[]>) => {
    setTray(false);
    setError(null);
    setAdding(true);
    try {
      const more = await get();
      const room = MAX_IMAGES - attached.length;
      if (more.length > room) setError(`Send at most ${MAX_IMAGES} pictures at a time.`);
      if (more.length) setAttached([...attached, ...more.slice(0, Math.max(0, room))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture could not be added.");
    } finally {
      setAdding(false);
    }
  };

  const send = async () => {
    if (!state.enabled || !client || !app) return;
    const message = text.trim();
    setSending(true);
    setError(null);
    try {
      await client.send(app.id, { text: message, ...(attached.length ? { images: toUploads(attached) } : {}) });
      setText("");
      setAttached([]);
      input.current?.blur();
      Keyboard.dismiss();
      onSent();
      void askForNotificationsOnce();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (!client || !app) return;
    setStopping(true);
    setError(null);
    try {
      await client.cancel(app.id);
    } catch (e) {
      setStopping(false);
      setError(e instanceof Error ? e.message : "Couldn't stop it.");
    }
  };

  const buttonFill = showStop || !hasContent ? t.surfaceSunken : t.accent;
  const inner = size.composerMinHeight - border.width * 2;
  const sidePad = (inner - size.sendButton) / 2;
  return (
    <View style={{ paddingTop: space.sm, paddingHorizontal: space.md, paddingBottom: bottomInset, backgroundColor: t.bg }}>
      {error ? (
        <View style={{ paddingHorizontal: space.xs, paddingBottom: space.sm }}>
          <StateLine kind="problem" label={error} role="caption" lines={0} />
        </View>
      ) : null}
      {tray ? (
        <View testID="attach-tray" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingBottom: space.sm }}>
          <Button testID="attach-gallery" label="Photos" icon={ImageIcon} variant="quiet" small onPress={() => void add(() => pickFromGallery(MAX_IMAGES - attached.length))} />
          <Button testID="attach-camera" label="Camera" icon={Camera} variant="quiet" small onPress={() => void add(takePhoto)} />
          {canPaste ? (
            <Button
              testID="attach-paste"
              label="Paste picture"
              icon={ClipboardPaste}
              variant="quiet"
              small
              onPress={() => void add(async () => {
                const one = await pastePicture();
                return one ? [one] : [];
              })}
            />
          ) : null}
        </View>
      ) : null}
      <View
        style={{
          minHeight: size.composerMinHeight,
          borderRadius: radius.composer,
          backgroundColor: t.fieldBg,
          borderWidth: border.width,
          borderColor: t.fieldBorder,
          ...elevation(t.mode, 1),
        }}
      >
        {attached.length || adding ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.md, paddingTop: space.md }}>
            {attached.map((a) => (
              <View key={a.key} testID="composer-thumb">
                <Image source={{ uri: a.uri }} style={{ width: THUMB, height: THUMB, borderRadius: radius.badge, backgroundColor: t.surfaceSunken }} contentFit="cover" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove picture"
                  hitSlop={space.sm}
                  onPress={() => setAttached(attached.filter((x) => x.key !== a.key))}
                  style={{ position: "absolute", top: space.xs, right: space.xs, width: size.dot * 3, height: size.dot * 3, borderRadius: radius.full, backgroundColor: t.surfaceOverlay, alignItems: "center", justifyContent: "center" }}
                >
                  <X size={icon.size.sm - 2} color={t.text} strokeWidth={icon.stroke} absoluteStrokeWidth />
                </Pressable>
              </View>
            ))}
            {adding ? (
              <View style={{ width: THUMB, height: THUMB, borderRadius: radius.badge, backgroundColor: t.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
                <Spinner color={t.working} />
              </View>
            ) : null}
          </ScrollView>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.xs }}>
          <View style={{ paddingBottom: sidePad, paddingLeft: sidePad }}>
            <Pressable
              testID="composer-attach"
              accessibilityRole="button"
              accessibilityLabel="Add a picture"
              onPress={openTray}
              disabled={attached.length >= MAX_IMAGES}
              style={({ pressed }) => ({ width: size.sendButton, height: size.sendButton, borderRadius: radius.send, alignItems: "center", justifyContent: "center", backgroundColor: pressed || tray ? t.selectedBg : "transparent" })}
            >
              <ImagePlus size={icon.size.md} color={attached.length >= MAX_IMAGES ? t.textTertiary : t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
            </Pressable>
          </View>
          <TextInput
            testID="composer-input"
            ref={input}
            value={text}
            onChangeText={setText}
            placeholder={state.placeholder}
            placeholderTextColor={t.textTertiary}
            cursorColor={t.accent}
            selectionColor={t.accent}
            multiline
            textAlignVertical="center"
            style={{
              ...body,
              flex: 1,
              color: t.text,
              minHeight: inner,
              maxHeight: (body.lineHeight ?? 0) * COMPOSER_MAX_LINES + space.md * 2,
              paddingVertical: space.md,
            }}
          />
          <View style={{ paddingBottom: sidePad, paddingRight: sidePad }}>
            <Pressable
              testID={showStop ? "composer-stop" : "composer-send"}
              accessibilityLabel={state.label}
              onPress={() => void (showStop ? stop() : send())}
              disabled={!state.enabled}
              style={{ width: size.sendButton, height: size.sendButton, borderRadius: radius.send, backgroundColor: buttonFill, alignItems: "center", justifyContent: "center" }}
            >
              {showStop && stopping ? (
                <Spinner color={t.textSecondary} />
              ) : showStop ? (
                <Square size={icon.size.sm} color={t.text} fill={t.text} strokeWidth={icon.stroke} absoluteStrokeWidth />
              ) : sending ? (
                <Spinner color={t.onAccent} />
              ) : (
                <ArrowUp size={icon.size.md} color={hasContent ? t.onAccent : t.textTertiary} strokeWidth={icon.stroke} absoluteStrokeWidth />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
