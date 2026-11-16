// Kiwimake's own updates on screen (docs/RELEASING.md, "Updates of the phone app"):
//
// - UpdateNotice, on the home screen: the one update there is to take. A downloaded over-the-air
//   update comes first (a restart away); otherwise a newer APK, with its download progress, then
//   Android's installer. The text takes the full width; the buttons go below it, on the right.
// - UpdatesGroup, in Settings: the version running now (the APK's own code, or an update and its
//   date), the newer APK when there is one, and Check for updates, which asks the update server and
//   GitHub at once and says what it found in one line.
//
// Copied in spirit from Ghostex's UpdatesPage.tsx and updateNotice.ts (read only, never imported).
import { View } from "react-native";
import { Download, RefreshCw, Smartphone } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { availableApp, installedVersion, SELF_UPDATE_ENABLED, useAppUpdate, type CheckResult, type DownloadState } from "@/lib/appUpdate";
import { OTA_ENABLED, restartToApplyUpdate, useDownloadedUpdate, useRunningUpdate } from "@/lib/overTheAir";
import { formatSize } from "@/lib/releaseFeed";
import { Button } from "@/ui/Button";
import { StateLine } from "@/ui/StateLine";
import { T } from "@/ui/Text";
import { border, icon, radius, space, useTheme } from "@/ui/theme";
import type { StateKind } from "@shared/chat/index";

function percent(download: DownloadState): number | null {
  return download.phase === "downloading" && download.totalBytes > 0 ? Math.min(100, Math.floor((download.bytesWritten / download.totalBytes) * 100)) : null;
}

function formatWhen(at: Date): string {
  const sameYear = at.getFullYear() === new Date().getFullYear();
  return at.toLocaleString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit" });
}

/** The home screen's card for the update there is to take, or nothing. */
export function UpdateNotice() {
  const t = useTheme();
  const ready = useDownloadedUpdate();
  const newApp = useAppUpdate((s) => availableApp(s.check));
  const download = useAppUpdate((s) => s.download);
  const dismissed = useAppUpdate((s) => s.dismissed);
  const card = { gap: space.sm, padding: space.lg, marginBottom: space.md, borderRadius: radius.card, borderWidth: border.width, borderColor: t.border, backgroundColor: t.surface } as const;
  const buttons = { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: space.sm } as const;

  if (ready !== null && dismissed !== "ota") {
    return (
      <View testID="update-notice-restart" style={card}>
        <T>A Kiwimake update is ready. It starts by itself the next time you open Kiwimake.</T>
        {ready.whatsNew.length > 0 ? (
          <T variant="caption" color="textSecondary">
            {ready.whatsNew.join(" ")}
          </T>
        ) : null}
        <View style={buttons}>
          <Button small variant="text" label="Later" onPress={() => useAppUpdate.getState().dismiss("ota")} testID="update-later" />
          <Button small label="Restart now" onPress={() => void restartToApplyUpdate()} testID="update-restart" />
        </View>
      </View>
    );
  }

  if (newApp === null || dismissed === newApp.version) return null;
  const pct = percent(download);
  const take = () => void useAppUpdate.getState().takeNewApp();
  return (
    <View testID="update-notice-app" style={card}>
      {download.phase === "downloading" ? (
        <StateLine kind="working" label={pct === null ? `Downloading Kiwimake ${newApp.version}` : `Downloading Kiwimake ${newApp.version}, ${pct}%`} />
      ) : (
        <T>
          Kiwimake {newApp.version} is ready to install ({formatSize(newApp.apk.size)}). Your apps and the connection to your PC stay as they are.
        </T>
      )}
      {download.phase === "error" ? <T color="problem">{download.message}</T> : null}
      {download.phase === "ready" && download.installError ? <T color="problem">{download.installError}</T> : null}
      {download.phase === "ready" ? (
        <T variant="caption" color="textSecondary">
          Android asks you to confirm, then replaces Kiwimake and offers Open.
        </T>
      ) : null}
      <View style={buttons}>
        {download.phase === "downloading" ? (
          <Button small variant="text" label="Cancel" onPress={() => useAppUpdate.getState().cancelDownload()} testID="update-cancel" />
        ) : (
          <>
            <Button small variant="text" label="Not now" onPress={() => useAppUpdate.getState().dismiss(newApp.version)} testID="update-not-now" />
            <Button small label={download.phase === "error" ? "Try again" : "Install"} onPress={take} testID="update-install" />
          </>
        )}
      </View>
    </View>
  );
}

function checkLine(result: CheckResult): { kind: StateKind; label: string } {
  const { overTheAir, app } = result;
  if (app.kind === "newApp") return { kind: "ready", label: `Kiwimake ${app.version} is ready to install.` };
  if (overTheAir.kind === "downloaded") return { kind: "ready", label: "An update was downloaded. Restart to use it." };
  if (overTheAir.kind === "rollback") return { kind: "ready", label: "Going back to the code inside the app. Restart to use it." };
  if (app.kind === "error") return { kind: "problem", label: app.message };
  if (overTheAir.kind === "error") return { kind: "problem", label: `The update server didn't answer: ${overTheAir.message}` };
  return { kind: "idle", label: "Kiwimake is up to date." };
}

type RowProps = { icon: LucideIcon; label: string; sub?: string; value?: string; trailing?: React.ReactNode; onPress?: () => void; testID?: string };

/** Settings' Updates group, drawn with Settings' own Group, Row and Divider. */
export function UpdatesGroup({
  Group,
  Row,
  Divider,
}: {
  Group: (p: { title: string; children: React.ReactNode }) => React.ReactNode;
  Row: (p: RowProps) => React.ReactNode;
  Divider: () => React.ReactNode;
}) {
  const running = useRunningUpdate();
  const ready = useDownloadedUpdate();
  const newApp = useAppUpdate((s) => availableApp(s.check));
  const download = useAppUpdate((s) => s.download);
  const manual = useAppUpdate((s) => s.manualCheck);
  const version = installedVersion();
  const pct = percent(download);

  const runningSub = !OTA_ENABLED
    ? "This build doesn't update itself."
    : running.builtIn
      ? "Running the code inside the app."
      : `Running the update of ${running.details.createdAt ? formatWhen(running.details.createdAt) : "an earlier day"}.`;

  const line: { kind: StateKind; label: string } | null = manual.running ? { kind: "working", label: "Checking for updates" } : manual.result ? checkLine(manual.result) : null;

  return (
    <Group title="Updates">
      <Row testID="updates-version" icon={Smartphone} label={`Kiwimake ${version}`} sub={runningSub} />
      {ready !== null ? (
        <>
          <Divider />
          <ActionBlock
            testID="updates-restart-row"
            icon={RefreshCw}
            label="An update is ready"
            sub={ready.whatsNew.length > 0 ? ready.whatsNew.join(" ") : "It starts the next time you open Kiwimake."}
          >
            <Button testID="updates-restart" label="Restart now" small onPress={() => void restartToApplyUpdate()} />
          </ActionBlock>
        </>
      ) : null}
      {newApp !== null ? (
        <>
          <Divider />
          <ActionBlock
            testID="updates-new-app"
            icon={Download}
            label={`Kiwimake ${newApp.version} is ready to install`}
            sub={
              download.phase === "downloading"
                ? pct === null
                  ? "Downloading"
                  : `Downloading, ${pct}%`
                : download.phase === "error"
                  ? download.message
                  : `${formatSize(newApp.apk.size)}. Your apps and the connection to your PC stay as they are.`
            }
          >
            {download.phase === "downloading" ? (
              <Button testID="updates-cancel" label="Cancel" small variant="quiet" onPress={() => useAppUpdate.getState().cancelDownload()} />
            ) : (
              <Button testID="updates-install" label="Install" small onPress={() => void useAppUpdate.getState().takeNewApp()} />
            )}
          </ActionBlock>
        </>
      ) : null}
      {OTA_ENABLED || SELF_UPDATE_ENABLED ? (
        <>
          <Divider />
          <ActionBlock testID="updates-check-row" icon={RefreshCw} label="Check for updates" sub="Kiwimake also checks by itself." line={line}>
            <Button testID="updates-check" label="Check now" small variant="quiet" busy={manual.running} onPress={() => void useAppUpdate.getState().checkEverything()} />
          </ActionBlock>
        </>
      ) : null}
    </Group>
  );
}

/** A Settings row with an action: the text takes the full width, the button goes below it, on the right. */
function ActionBlock({
  icon: Icon,
  label,
  sub,
  line,
  children,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  line?: { kind: StateKind; label: string } | null;
  children: React.ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View testID={testID} style={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Icon size={icon.size.md} color={t.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
        <View style={{ flex: 1, gap: space.hair }}>
          <T variant="body">{label}</T>
          {sub ? (
            <T variant="caption" color="textSecondary">
              {sub}
            </T>
          ) : null}
        </View>
      </View>
      {line ? <StateLine kind={line.kind} label={line.label} lines={3} /> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: space.sm }}>{children}</View>
    </View>
  );
}
