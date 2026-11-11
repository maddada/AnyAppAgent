// "Send app" (C:\aa\ideas\ideas.html, Q39): give an app to family or friends as one file, through
// Android's share sheet (WhatsApp, Bluetooth, Files). Only the installed APK goes, named after the
// app; never the signing key or anything else. One short note first: what they must allow, and
// that updates do not reach them this way (sharing on GitHub does that, docs/DISTRIBUTION.md).
import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { FolderDown, Globe, Send } from "lucide-react-native";
import { AnyAppNative } from "anyapp-native";
import type { App } from "@/lib/protocol";
import { useStore } from "@/lib/store";
import { Button } from "./Button";
import { StateLine } from "./StateLine";
import { T } from "./Text";
import { space } from "./theme";

/** "Kettle Timer" -> "Kettle Timer.apk" (the same cleaning as ShareFiles.apkName). */
export function apkFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${clean || "App"}.apk`;
}

/** True when "Send app" can be offered: the app is on this phone and this build can share it. */
export function canSendApp(app: App | undefined): boolean {
  return !!app && !!AnyAppNative?.shareApk && !!useStore.getState().packages[app.packageName];
}

/** The note and the button, for a sheet. `onDone` closes the sheet once the share sheet opened. */
export function SendAppPanel({ app, onDone, onCancel }: { app: App; onDone: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState<"send" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const shared = !!app.sharing?.shared;
  const file = apkFileName(app.name);

  const send = async () => {
    if (!AnyAppNative?.shareApk) return;
    setBusy("send");
    setError(null);
    try {
      await AnyAppNative.shareApk(app.packageName, app.name, `Send ${app.name}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "It could not be sent.");
    } finally {
      setBusy(null);
    }
  };

  // For Bluetooth, a USB stick or a phone without WhatsApp: the same file, kept in Files.
  const save = async () => {
    if (!AnyAppNative?.saveApk) return;
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      setSaved(await AnyAppNative.saveApk(app.packageName, app.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "It could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="send-app" style={{ gap: space.md }}>
      <T variant="callout" color="textSecondary">
        {`It goes as one file, ${file}, in WhatsApp or any app you pick.`}
      </T>
      <T variant="callout" color="textSecondary">
        To install it, they allow installs from WhatsApp or Files when their phone asks.
      </T>
      <T variant="callout" color="textSecondary">
        {shared
          ? "New versions do not reach them this way. Send them your share link instead, and they get every update."
          : "New versions do not reach them this way. To send them updates, share the app on GitHub with Share with others."}
      </T>
      {error ? <StateLine kind="problem" label={error} role="caption" lines={0} /> : null}
      {saved ? <StateLine kind="ready" label={`Saved as ${file}. Open it from Files to install it, or send it from there.`} role="caption" lines={0} /> : null}
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        <Button testID="send-app-go" label="Send the file" icon={Send} busy={busy === "send"} disabled={busy !== null} onPress={() => void send()} />
        {AnyAppNative?.saveApk ? <Button testID="send-app-save" label="Save to Files" icon={FolderDown} variant="quiet" busy={busy === "save"} disabled={busy !== null} onPress={() => void save()} /> : null}
        {app.latestApk ? (
          <Button
            testID="send-app-github"
            label={shared ? "Send the share link" : "Share with others"}
            icon={Globe}
            variant="quiet"
            onPress={() => {
              onCancel();
              router.push(`/share/${app.id}`);
            }}
          />
        ) : null}
        <Button label="Not now" variant="text" small style={{ alignSelf: "center" }} onPress={onCancel} />
      </View>
    </View>
  );
}
