// Sharing one app with other people and publishing versions to them (docs/DISTRIBUTION.md,
// stage 6): the same controls as the desktop's Share dialog. The PC does the GitHub work.
import { useEffect, useState } from "react";
import { ScrollView, Share, Switch, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Send, Share2 } from "lucide-react-native";
import type { PublishedRelease, ReleaseStats } from "@/lib/protocol";
import { upsertApp, useStore } from "@/lib/store";
import { Button, IconButton } from "@/ui/Button";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, size, space, useTheme } from "@/ui/theme";

export default function ShareScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const appId = String(params.id);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const client = useStore((s) => s.client);
  const online = useStore((s) => s.connection === "online");
  const app = useStore((s) => s.apps[appId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [channel, setChannel] = useState<"stable" | "testing">("stable");
  const [stats, setStats] = useState<ReleaseStats[] | null>(null);

  const sharing = app?.sharing;
  const shared = Boolean(sharing?.shared);
  const showToOthers = app?.change?.showToOthers !== false;
  const releases = sharing?.releases ?? [];
  const newest = app?.latestApk?.number;
  const published = releases.some((r) => r.channel === channel && r.build === newest && !r.pulledBack);
  const pulled = releases.some((r) => r.build === newest && r.pulledBack);

  useEffect(() => {
    if (!client || !online || !shared || releases.length === 0) return;
    let live = true;
    client
      .releases(appId)
      .then((s) => live && setStats(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, online, shared, releases.length, appId]);

  const run = async (key: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const next = await action();
      if (next && typeof next === "object" && "id" in next) upsertApp(next as never);
      if (done) setNote(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const downloads = (r: PublishedRelease) => stats?.find((s) => s.tag === r.tag)?.downloads;
  const disabled = !online || !client || busy !== null;

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: size.chatHeaderHeight, paddingLeft: space.xs, paddingRight: space.lg, gap: space.sm, borderBottomWidth: border.width, borderBottomColor: t.border }}>
        <IconButton testID="share-back" icon={ChevronLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <View style={{ flex: 1, marginLeft: space.xs }}>
          <T variant="heading" numberOfLines={1}>
            Share
          </T>
          <T variant="caption" color="textSecondary" numberOfLines={1}>
            {app?.name ?? ""}
          </T>
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space["2xl"] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <T variant="body">Share with others</T>
            <T variant="caption" color="textSecondary">
              {shared
                ? "Anyone with the link can install it and gets your new versions. Each version you publish also carries its code, so others can make their own version."
                : "Makes a public page on GitHub with the app's name, icon and the versions you publish. Each version also carries its code (never your chat, the app's notes about you, keys or .env files)."}
            </T>
          </View>
          <Switch
            testID="share-switch"
            accessibilityLabel="Share with others"
            value={shared}
            disabled={disabled}
            onValueChange={(on) => {
              if (client) void run("share", () => client.share(appId, on), on ? undefined : "Not shared any more. People who have it keep it, but get no new versions.");
            }}
            trackColor={{ false: t.borderStrong, true: t.accent }}
            thumbColor={t.dark ? t.text : t.surface}
          />
        </View>
        {busy === "share" ? <StateLine kind="working" label="Setting it up on GitHub..." role="caption" /> : null}

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <T variant="body">{"Show \"Change this app\" to others"}</T>
            <T variant="caption" color="textSecondary">
              {showToOthers
                ? "Anyone with the app can suggest a change to you, or make their own version. From the next version."
                : "Off: only your phone shows the row. From the next version."}
            </T>
          </View>
          <Switch
            testID="change-switch"
            accessibilityLabel="Show Change this app to others"
            value={showToOthers}
            disabled={disabled}
            onValueChange={(on) => {
              if (client) void run("change", () => client.setShowToOthers(appId, on));
            }}
            trackColor={{ false: t.borderStrong, true: t.accent }}
            thumbColor={t.dark ? t.text : t.surface}
          />
        </View>

        {shared && sharing ? (
          <View style={{ gap: space.sm }}>
            <T variant="body">Link for other people</T>
            <T variant="caption" color="textSecondary" selectable>
              {sharing.installUrl}
            </T>
            <Button
              testID="share-link"
              label="Send the link"
              icon={Share2}
              variant="quiet"
              onPress={() => void Share.share({ message: `${app?.name ?? "My app"}: open this on an Android phone to install it. ${sharing.installUrl}` })}
            />
          </View>
        ) : null}

        {shared ? (
          <View style={{ gap: space.sm }}>
            <T variant="body">Publish this version</T>
            <T variant="caption" color="textSecondary">
              {newest ? `Build ${newest}, the one on this phone.` : "There is no finished build yet."} Leave the notes empty to use what changed since the last version.
            </T>
            <TextInput
              testID="publish-notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="What's new (optional)"
              placeholderTextColor={t.textTertiary}
              multiline
              style={{ minHeight: 72, padding: space.md, borderRadius: 14, borderWidth: border.width, borderColor: t.fieldBorder, backgroundColor: t.fieldBg, color: t.text, textAlignVertical: "top" }}
            />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button testID="channel-stable" label="Everyone" small variant={channel === "stable" ? "primary" : "quiet"} onPress={() => setChannel("stable")} />
              <Button testID="channel-testing" label="Testers" small variant={channel === "testing" ? "primary" : "quiet"} onPress={() => setChannel("testing")} />
            </View>
            <Button
              testID="publish"
              label={published ? "Published" : pulled ? "Pulled back" : "Publish"}
              icon={Send}
              busy={busy === "publish"}
              disabled={disabled || !newest || published || pulled}
              onPress={() => {
                if (!client) return;
                void run("publish", async () => {
                  const next = await client.publish(appId, { ...(notes.trim() ? { notes: notes.trim() } : {}), channel });
                  setNotes("");
                  return next;
                }, channel === "stable" ? "Published. People who have the app get a notification." : "Published for testers.");
              }}
            />
          </View>
        ) : null}

        {releases.length ? (
          <View style={{ gap: space.sm }}>
            <T variant="eyebrow" color="textTertiary">
              Versions
            </T>
            {releases.map((r) => (
              <View key={`${r.tag}-${r.build}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs, borderBottomWidth: border.width, borderBottomColor: t.border }}>
                <View style={{ flex: 1 }}>
                  <T variant="body">{`${r.version}${r.channel === "testing" ? " (testers)" : ""}${r.pulledBack ? " (pulled back)" : ""}`}</T>
                  <T variant="caption" color="textSecondary">
                    {`Build ${r.build}${downloads(r) !== undefined ? `, ${downloads(r)} ${downloads(r) === 1 ? "download" : "downloads"}` : ""}`}
                  </T>
                </View>
                {r.channel === "stable" && !r.pulledBack ? (
                  <Button
                    testID={`pullback-${r.build}`}
                    label="Pull back"
                    small
                    variant="quiet"
                    busy={busy === `pull-${r.build}`}
                    disabled={disabled}
                    onPress={() => client && void run(`pull-${r.build}`, () => client.pullBack(appId, r.build), `${r.version} is pulled back. New installs get the version before it.`)}
                  />
                ) : null}
              </View>
            ))}
            <T variant="caption" color="textTertiary">
              GitHub counts downloads some minutes late, and counts downloads, not people.
            </T>
          </View>
        ) : null}

        {error ? <StateLine kind="problem" label={error} role="caption" lines={0} /> : null}
        {note ? <StateLine kind="ready" label={note} role="caption" lines={0} /> : null}
        {!online ? <StateLine kind="problem" label="Not connected to your PC." role="caption" /> : null}
      </ScrollView>
    </View>
  );
}
