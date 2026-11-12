// Moving a PC app to the cloud from the desktop (docs/CLOUD.md section 3, "Moving an app", cloud
// milestone 8). The companion does the work through the PC link; the app's `move` shows where it
// is. A moved copy stays here read-only. Moving a cloud app to this PC starts on the phone, which
// lists the cloud apps.
import { useState } from "react";
import { Cloud } from "lucide-react";
import type { AccountLinkInfo, App } from "../../../../shared/protocol.ts";
import { Dialog, Icon } from "./ui.tsx";

const api = window.anyapp;

export function MoveButton({ app, account, online, onOpen }: { app: App; account?: AccountLinkInfo; online: boolean; onOpen: () => void }) {
  if (account?.state !== "linked" || !app.latestApk) return null;
  if (app.move && app.move.state !== "failed") return null;
  return (
    <button className="btn btn-quiet btn-sm" onClick={onOpen} disabled={!online} data-testid="move" title="Move this app to the cloud">
      <Icon of={Cloud} size="sm" /> Move
    </button>
  );
}

/** Where the move is, under the app's name (running, stopped, or moved and read-only). */
export function MoveNotice({ app }: { app: App }) {
  const m = app.move;
  if (!m) return null;
  const text =
    m.state === "running"
      ? `Moving to the cloud: ${m.step ?? "starting"}.`
      : m.state === "failed"
        ? `The move to the cloud stopped: ${m.error ?? "something went wrong"}. Move it again to go on.`
        : "Moved to the cloud. This copy is read-only: change the app from your phone, where it is made in the cloud now.";
  return (
    <div className={`notice health-notice${m.state === "failed" ? " problem-text" : ""}`} data-testid="move-notice">
      <span className="grow callout">{text}</span>
    </div>
  );
}

export function MoveDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    const r = await api.moveToCloud(app.id);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That did not work.");
    onClose();
  };
  return (
    <Dialog
      title={`Move ${app.name} to the cloud`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-text btn-sm" onClick={onClose}>
            Not now
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void go()} data-testid="move-go">
            Move
          </button>
        </>
      }
    >
      <p className="callout">
        {app.name} moves to the cloud with its code and every version, its chat, its to-dos and its signing key, so it keeps updating in place on your phone. Its code goes to a private repo on your GitHub.
      </p>
      <p className="callout secondary">Changes then run in the cloud and use credits. This PC keeps a read-only copy. You can move it back here later from the phone.</p>
      {error ? <p className="callout problem-text">{error}</p> : null}
    </Dialog>
  );
}
