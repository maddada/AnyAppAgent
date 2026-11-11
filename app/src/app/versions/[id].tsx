// An app's versions (docs/VERSIONS.md): every version it got, newest first, with what changed. Go back
// to an earlier one, or undo the last change: the PC builds that code again as a new version, so it
// installs over the current one and the app's data stays. Nothing is lost.
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, History, Undo2 } from "lucide-react-native";
import type { AppVersion } from "@/lib/protocol";
import { useStore } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { Spinner } from "@/ui/Spinner";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, radius, size, space, useTheme } from "@/ui/theme";
import { goBackBlocked, goBackQuestion, undoQuestion, undoTarget, versionRows, type VersionRow } from "@shared/chat/index";

type Ask = { kind: "undo"; target: AppVersion } | { kind: "restore"; build: number };

export default function VersionsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const appId = String(params.id);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const client = useStore((s) => s.client);
  const online = useStore((s) => s.connection === "online");
  const app = useStore((s) => s.apps[appId]);
  const [versions, setVersions] = useState<AppVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!client || !online) return;
    client
      .versions(appId)
      .then(setVersions)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [client, online, appId]);
  // Again whenever a new version arrives (a go-back finished).
  useEffect(load, [load, app?.latestApk?.number]);

  const blocked = goBackBlocked(app);
  const target = versions ? undoTarget(versions) : null;
  const question = ask ? (ask.kind === "undo" ? undoQuestion(ask.target) : goBackQuestion(ask.build)) : null;

  const confirm = async () => {
    if (!ask || !client) return;
    setBusy(true);
    setError(null);
    try {
      if (ask.kind === "undo") await client.undo(appId);
      else await client.restoreVersion(appId, ask.build);
      setAsk(null);
      // The go-back build shows in the chat.
      if (router.canGoBack()) router.back();
    } catch (e) {
      setAsk(null);
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
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
        <IconButton testID="versions-back" icon={ChevronLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <View style={{ flex: 1, marginLeft: space.xs }}>
          <T variant="heading" numberOfLines={1}>
            Versions
          </T>
          <T variant="caption" color="textSecondary" numberOfLines={1}>
            {app?.name ?? ""}
          </T>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space["2xl"] }}>
        <T variant="callout" color="textSecondary">
          Every version your app had. Go back to any of them: nothing is lost, and your data in the app stays.
        </T>
        {target ? (
          <Button testID="versions-undo" label="Undo last change" icon={Undo2} variant="quiet" disabled={!!blocked || !online} onPress={() => setAsk({ kind: "undo", target })} />
        ) : null}
        {blocked && versions ? <StateLine kind="idle" label={blocked} role="caption" lines={0} /> : null}
        {error ? <StateLine kind="problem" label={error} role="caption" lines={0} /> : null}
        {versions === null ? (
          <View style={{ padding: space["2xl"], alignItems: "center" }}>{online ? <Spinner color={t.working} /> : <StateLine kind="problem" label="Not connected to your PC." role="caption" />}</View>
        ) : versions.length === 0 ? (
          <T variant="callout" color="textSecondary" style={{ textAlign: "center", paddingTop: space.xl }}>
            No versions yet. The first one appears here once it is built.
          </T>
        ) : (
          versionRows(versions).map((row) => <VersionCard key={row.build} row={row} disabled={!!blocked || !online} onGoBack={() => setAsk({ kind: "restore", build: row.build })} />)
        )}
      </ScrollView>
      <Sheet visible={!!ask} onClose={() => !busy && setAsk(null)}>
        {question ? (
          <View style={{ gap: space.md }}>
            <T variant="title">{question.title}</T>
            <T variant="body" color="textSecondary">
              {question.body}
            </T>
            <Button testID="versions-confirm" label={question.confirm} icon={History} busy={busy} onPress={() => void confirm()} />
            <Button label="Not now" variant="text" disabled={busy} onPress={() => setAsk(null)} />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function VersionCard({ row, disabled, onGoBack }: { row: VersionRow; disabled: boolean; onGoBack: () => void }) {
  const t = useTheme();
  return (
    <View testID="version-row" style={{ backgroundColor: t.surface, borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <T variant="heading" style={{ flex: 1 }}>
          {row.title}
        </T>
        {row.badge ? (
          <View style={{ backgroundColor: t.readySoft, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 2 }}>
            <T variant="caption" color="ready">
              {row.badge}
            </T>
          </View>
        ) : null}
      </View>
      <T variant="callout">{row.what}</T>
      <T variant="caption" color="textTertiary">
        {row.when}
      </T>
      {row.canRestore ? <Button testID={`version-restore-${row.build}`} label="Go back to this" variant="quiet" small disabled={disabled} onPress={onGoBack} /> : null}
    </View>
  );
}
