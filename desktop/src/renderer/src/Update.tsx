// Kiwimake's own update (src/main/updates.ts): the "restart to update" notice over the apps list,
// and the Updates group in Settings. Notices keep their text full width with the buttons below it,
// aligned right (AGENTS.md, design).
import { useState } from "react";
import type { UpdateState } from "../../shared/types.ts";
import { StateLine, Switch } from "./ui.tsx";
import { updateWords } from "./updateWords.ts";

const api = window.anyapp;

/** Over the apps list: only when there is something to do (ready, waiting, installing, or a failed install). */
export function UpdateNotice({ u }: { u: UpdateState }) {
  const [later, setLater] = useState<string | null>(null);
  const shown = u.phase === "ready" || u.phase === "waiting" || u.phase === "installing" || (u.phase === "error" && !!u.version);
  const words = updateWords(u);
  if (!shown || !words || (u.phase === "ready" && later === u.version)) return null;
  return (
    <div className="card notice apps-notice" data-testid="update-notice" role="status">
      <div className="grow">
        <div className="body">{words.title}</div>
        <div className={`label ${u.phase === "error" ? "problem-text" : "secondary"}`}>{words.body}</div>
      </div>
      {u.phase !== "installing" && (
        <div className="notice-actions">
          {u.phase === "ready" && (
            <button className="btn btn-quiet btn-sm" onClick={() => setLater(u.version ?? "")}>
              Later
            </button>
          )}
          {u.phase === "waiting" ? (
            <button className="btn btn-quiet btn-sm" onClick={() => void api.updateCancel()}>
              Don't wait
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => void api.updateRestart()} data-testid="update-restart">
              {u.phase === "error" ? "Try again" : "Restart to update"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Settings: automatic updates on or off, where things stand, and Check now. */
export function UpdatesGroup({ u, auto }: { u: UpdateState; auto: boolean }) {
  const words = updateWords(u);
  const off = u.phase === "off";
  const busy = u.phase === "checking" || u.phase === "downloading" || u.phase === "installing";
  const restartable = u.phase === "ready" || (u.phase === "error" && !!u.version);
  return (
    <section className="settings-group">
      <h2 className="heading">Updates</h2>
      <section className="list">
        <div className="srow">
          <div className="srow-main">
            <span className="body">Update Kiwimake by itself</span>
            <span className="sub">Kiwimake looks for a new version every few hours and downloads it. It installs only when you click Restart to update, and never while an app is being made.</span>
          </div>
          <Switch label="Update Kiwimake by itself" on={auto && !off} disabled={off} onChange={() => api.setSetting("autoUpdates", !auto)} />
        </div>
        <div className="srow">
          <div className="srow-main">
            <span className="body">Kiwimake {u.current}</span>
            {words && <StateLine state={words.state} text={words.status} />}
          </div>
          {!off && (
            <div className="notice-actions">
              {restartable ? (
                <button className="btn btn-primary btn-sm" onClick={() => void api.updateRestart()}>
                  Restart to update
                </button>
              ) : u.phase === "waiting" ? (
                <button className="btn btn-quiet btn-sm" onClick={() => void api.updateCancel()}>
                  Don't wait
                </button>
              ) : (
                <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void api.updateCheck()}>
                  Check now
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
