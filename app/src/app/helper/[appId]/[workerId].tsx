// A helper's own chat (docs/APP-COORDINATOR.md): read only. Its task, its messages and steps, and
// its own Stop; anything the person wants to tell it goes through the main chat.
import { useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, MessageSquare, Square } from "lucide-react-native";
import { HELPER_CHAT_FOOTER, helperChatRows, helperView, type Row } from "@shared/chat/index";
import { ChatRow } from "@/chat/ChatRows";
import type { ChatItem, WorkerInfo } from "@/lib/protocol";
import { loadHelperChat } from "@/lib/session";
import { useStore, useClientFor } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { Spinner } from "@/ui/Spinner";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, icon, size, space, useTheme } from "@/ui/theme";

const EMPTY: ChatItem[] = [];

export default function HelperChat() {
  const params = useLocalSearchParams<{ appId: string; workerId: string }>();
  const appId = String(params.appId);
  const workerId = String(params.workerId);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const app = useStore((s) => s.apps[appId]);
  const worker = useStore((s) => s.helpers[appId]?.find((w) => w.id === workerId));
  const items = useStore((s) => s.helperChats[workerId] ?? EMPTY);
  const loaded = useStore((s) => !!s.helperChatLoaded[workerId]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    loadHelperChat(appId, workerId)
      .then(() => !cancelled && setLoadError(null))
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(() => setAttempt((a) => a + 1), [2000, 4000, 8000][attempt] ?? 15000);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [appId, workerId, attempt]);

  const rows = useMemo(() => helperChatRows(items, worker).reverse(), [items, worker]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
      <Header appId={appId} worker={worker} />
      <FlatList<Row>
        inverted
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => <ChatRow row={item} app={app} />}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, gap: space.md }}
        ListFooterComponent={
          loaded ? undefined : (
            <View style={{ padding: space["2xl"], alignItems: "center" }}>
              {loadError ? <StateLine kind="problem" label={loadError} role="row" lines={0} /> : <Spinner color={t.working} />}
            </View>
          )
        }
        style={{ backgroundColor: t.bg }}
      />
      <View
        testID="helper-readonly"
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.md, paddingHorizontal: space.md, paddingVertical: space.md, borderTopWidth: border.width, borderTopColor: t.border }}
      >
        <MessageSquare size={icon.size.sm} color={t.textTertiary} strokeWidth={icon.stroke} absoluteStrokeWidth />
        <T variant="row" color="textTertiary" style={{ flex: 1 }}>
          {HELPER_CHAT_FOOTER}
        </T>
      </View>
    </View>
  );
}

function Header({ appId, worker }: { appId: string; worker: WorkerInfo | undefined }) {
  const t = useTheme();
  const client = useClientFor(appId);
  const view = worker ? helperView(worker) : null;
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A stop lasts until the helper really settles.
  if (stopping && view && !view.active) setStopping(false);
  const stop = async () => {
    if (!client || !worker) return;
    setStopping(true);
    setError(null);
    try {
      await client.stopHelper(appId, worker.id);
    } catch (e) {
      setStopping(false);
      setError(e instanceof Error ? e.message : "Couldn't stop it.");
    }
  };
  return (
    <View style={{ borderBottomWidth: border.width, borderBottomColor: t.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: size.chatHeaderHeight, paddingLeft: space.xs, paddingRight: space.lg, gap: space.sm }}>
        <IconButton testID="helper-back" icon={ChevronLeft} label="Back to the main chat" onPress={() => (router.canGoBack() ? router.back() : router.replace(`/chat/${appId}`))} />
        <View style={{ flex: 1, marginLeft: space.xs }}>
          <T variant="heading" numberOfLines={1}>
            {view?.title ?? ""}
          </T>
          {view ? <StateLine kind={view.state.kind} label={stopping ? "Stopping" : view.state.label} role="caption" /> : null}
        </View>
        {view?.active ? <Button testID="helper-stop" label={stopping ? "Stopping" : "Stop"} icon={Square} variant="quiet" small disabled={stopping} onPress={() => void stop()} /> : null}
      </View>
      {error ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <StateLine kind="problem" label={error} role="caption" lines={0} />
        </View>
      ) : null}
    </View>
  );
}
