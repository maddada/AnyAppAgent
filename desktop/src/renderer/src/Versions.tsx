// Versions and undo (docs/VERSIONS.md): every version of an app, newest first, beside the chat.
// "Go back to this" builds that version again as a new version, so it installs over the one on the
// phone and the app's data stays; "Undo last change" goes back to the version before the newest one.
// Both ask first, inside the panel. The words come from shared/chat/history.ts, the same as the phone.
import { useEffect, useState } from "react";
import { RotateCcw, Undo2, X } from "lucide-react";
import type { App, AppVersion } from "../../shared/types.ts";
import { goBackBlocked, goBackQuestion, undoQuestion, undoTarget, versionRows } from "../../../../shared/chat/index.ts";
import { Icon, Spinner, StateLine } from "./ui.tsx";

const api = window.anyapp;

type Ask = { kind: "restore"; build: number } | { kind: "undo"; target: AppVersion };

/** The app's versions: loaded when the panel opens and again whenever a new version is ready. */
function useVersions(app: App, online: boolean): { versions: AppVersion[]; loaded: boolean; reload: () => void } {
  const [state, setState] = useState<{ appId: string; versions: AppVersion[]; loaded: boolean }>({ appId: app.id, versions: [], loaded: false });
  const [tick, setTick] = useState(0);
  const newest = app.latestApk?.number ?? 0;
  useEffect(() => {
    if (!online) return;
    let live = true;
    void api.getVersions(app.id).then((versions) => live && setState({ appId: app.id, versions, loaded: true }));
    return () => {
      live = false;
    };
  }, [app.id, online, newest, app.status, tick]);
  const current = state.appId === app.id ? state : { versions: [], loaded: false };
  return { ...current, reload: () => setTick((n) => n + 1) };
}

export function VersionsPanel({ app, online, onClose }: { app: App; online: boolean; onClose: () => void }) {
  const { versions, loaded, reload } = useVersions(app, online);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const rows = versionRows(versions);
  const target = undoTarget(versions);
  const blocked = online ? goBackBlocked(app) : "This PC's companion is not answering.";

  const run = async (what: Ask) => {
    setBusy(true);
    setError(null);
    const r = what.kind === "undo" ? await api.undoChange(app.id) : await api.restoreVersion(app.id, what.build);
    setBusy(false);
    setAsk(null);
    if (!r.ok) return setError(r.error ?? "That did not work. Try again.");
    setStarted(what.kind === "undo" ? `Undoing: building version ${what.target.build} again. It goes to your phone when it is ready.` : `Going back to version ${what.build}. It goes to your phone when it is ready.`);
    reload();
  };

  const question = ask ? (ask.kind === "undo" ? undoQuestion(ask.target) : goBackQuestion(ask.build)) : null;
  const confirm = question ? (
    <div className="versions-ask card" data-testid="versions-ask">
      <div className="heading">{question.title}</div>
      <p className="caption versions-ask-body">{question.body}</p>
      <div className="versions-ask-actions">
        <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setAsk(null)}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" data-testid="versions-confirm" disabled={busy || !!blocked} onClick={() => ask && void run(ask)}>
          {busy ? <Spinner /> : null} {question.confirm}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <aside className="helper-chat helper-chat-beside versions-panel" data-testid="versions-panel" aria-label="Versions">
      <header className="chat-head">
        <div className="chat-id">
          <div className="heading">Versions</div>
          <span className="caption versions-sub">Go back to any version. Nothing is lost.</span>
        </div>
        <button className="btn btn-icon" aria-label="Close versions" data-testid="versions-close" onClick={onClose}>
          <Icon of={X} size="md" />
        </button>
      </header>
      {target ? (
        <div className="versions-undo">
          <button
            className="btn btn-quiet btn-sm"
            data-testid="versions-undo"
            disabled={!!blocked || busy}
            title={blocked ?? `Go back to version ${target.build}`}
            onClick={() => {
              setStarted(null);
              setAsk({ kind: "undo", target });
            }}
          >
            <Icon of={Undo2} px={14} /> Undo last change
          </button>
          <span className="caption tertiary">Back to version {target.build}</span>
        </div>
      ) : null}
      {ask?.kind === "undo" ? confirm : null}
      {blocked && loaded && rows.length > 0 ? (
        <div className="versions-note">
          <StateLine state="idle" text={blocked} />
        </div>
      ) : null}
      {error ? (
        <div className="versions-note">
          <StateLine state="problem" text={error} />
        </div>
      ) : null}
      {started ? (
        <div className="versions-note">
          <StateLine state="working" text={started} />
        </div>
      ) : null}
      <div className="todo-scroll">
        {!loaded ? (
          <div className="chat-loading">
            <Spinner />
          </div>
        ) : null}
        {loaded && rows.length === 0 ? (
          <div className="chat-empty todo-empty">
            <span className="label">No versions yet. Each new version of the app shows up here.</span>
          </div>
        ) : null}
        <ol className="versions-list">
          {rows.map((v) => (
            <li key={v.build} className={`versions-row${v.badge ? " is-newest" : ""}`} data-testid="versions-row">
              <div className="versions-top">
                <span className="label">{v.title}</span>
                {v.badge ? <span className="versions-badge caption">{v.badge}</span> : null}
                <span className="caption tertiary versions-when">{v.when}</span>
              </div>
              <div className="versions-what">{v.what}</div>
              {v.canRestore ? (
                <button
                  className="btn btn-text btn-sm versions-restore"
                  data-testid="versions-restore"
                  disabled={!!blocked || busy}
                  title={blocked ?? undefined}
                  onClick={() => {
                    setStarted(null);
                    setAsk({ kind: "restore", build: v.build });
                  }}
                >
                  <Icon of={RotateCcw} px={14} /> Go back to this
                </button>
              ) : null}
              {ask?.kind === "restore" && ask.build === v.build ? confirm : null}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
