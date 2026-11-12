// "From others" (docs/CHANGE-THIS-APP.md): suggestions people sent about one app, as text through
// WhatsApp, SMS or email. They land here when the message is shared into Kiwimake or pasted;
// Open in chat puts the words in the app's composer, to send or edit.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ClipboardPaste, MessageCircle, X } from "lucide-react-native";
import type { Suggestion } from "@/lib/protocol";
import { setSuggestions, useStore } from "@/lib/store";
import { openSuggestionInChat, pasteSuggestion } from "@/lib/suggestions";
import { Button, IconButton } from "@/ui/Button";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, radius, size, space, useTheme } from "@/ui/theme";

const EMPTY: Suggestion[] = [];

export default function FromOthers() {
  const params = useLocalSearchParams<{ id: string; problem?: string }>();
  const appId = String(params.id);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const client = useStore((s) => s.client);
  const online = useStore((s) => s.connection === "online");
  const app = useStore((s) => s.apps[appId]);
  const list = useStore((s) => s.suggestions[appId] ?? EMPTY);
  const [problem, setProblem] = useState<string | null>(params.problem ? String(params.problem) : null);
  const [note, setNote] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  useEffect(() => {
    if (!client || !online || !app) return;
    let live = true;
    client
      .suggestions(appId)
      .then((s) => live && setSuggestions(appId, s))
      .catch((e) => live && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [client, online, appId, app]);

  const paste = async () => {
    setPasting(true);
    setProblem(null);
    setNote(null);
    try {
      const r = await pasteSuggestion();
      if (r.appId !== appId) router.replace(`/suggestions/${r.appId}`);
      else setNote("Added.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setPasting(false);
    }
  };

  const remove = async (s: Suggestion) => {
    if (!client) return;
    setSuggestions(appId, list.filter((x) => x.id !== s.id));
    await client.removeSuggestion(appId, s.id).catch((e) => setProblem(e instanceof Error ? e.message : String(e)));
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: size.chatHeaderHeight, paddingLeft: space.xs, paddingRight: space.lg, gap: space.sm, borderBottomWidth: border.width, borderBottomColor: t.border }}>
        <IconButton testID="others-back" icon={ChevronLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <View style={{ flex: 1, marginLeft: space.xs }}>
          <T variant="heading" numberOfLines={1}>
            From others
          </T>
          <T variant="caption" color="textSecondary" numberOfLines={1}>
            {app?.name ?? ""}
          </T>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space["2xl"] }}>
        {problem ? <StateLine kind="problem" label={problem} role="caption" lines={0} /> : null}
        {note ? <StateLine kind="ready" label={note} role="caption" /> : null}
        {list.length === 0 ? (
          <T variant="callout" color="textSecondary">
            {`Suggestions people send you about ${app?.name ?? "this app"} show up here. When one arrives as a message, share it to Kiwimake, or copy it and tap Paste a suggestion.`}
          </T>
        ) : (
          list.map((s) => (
            <View key={s.id} testID="suggestion" style={{ padding: space.lg, gap: space.sm, borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <T variant="name">{s.from ? `${s.from} suggests` : "Someone suggests"}</T>
                  <T variant="caption" color="textTertiary">
                    {`${when(s.receivedAt)}${s.build ? `, on version ${s.build}` : ""}${s.opened ? ", opened" : ""}`}
                  </T>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Remove" onPress={() => void remove(s)} hitSlop={12}>
                  <X size={18} color={t.textTertiary} strokeWidth={1.75} />
                </Pressable>
              </View>
              <T variant="body">{s.text}</T>
              <Button testID="suggestion-open" small label="Open in chat" icon={MessageCircle} variant={s.opened ? "quiet" : "primary"} onPress={() => void openSuggestionInChat(appId, s)} />
            </View>
          ))
        )}
        <Button testID="suggestion-paste" label="Paste a suggestion" icon={ClipboardPaste} variant="quiet" busy={pasting} disabled={!client || !online || pasting} onPress={() => void paste()} />
      </ScrollView>
    </View>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
