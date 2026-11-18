// Duplicate and Rename (an app's options; the app row's menu, next to Pin to top, Hide and Delete).
// The same words as the phone's sheet (app/src/ui/DuplicateRename.tsx).
import { useRef, useState } from "react";
import type { App } from "../../shared/types.ts";
import { Dialog, Spinner, Switch } from "./ui.tsx";
import { VoiceTextarea } from "./Voice.tsx";

const api = window.anyapp;

/** The name a duplicate gets by default: "Tea Timer 2", within the 50 characters a name may have. */
export function copyName(name: string): string {
  return `${name.slice(0, 48).trim()} 2`;
}

export function DuplicateAppDialog({ app, onClose, onMade }: { app: App; onClose: () => void; onMade: (id: string) => void }) {
  const [name, setName] = useState(() => copyName(app.name));
  const [change, setChange] = useState("");
  const changeBox = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0 && name.trim().length <= 50;
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const r = await api.duplicateApp(app.id, name.trim(), change.trim());
    setBusy(false);
    if (!r.ok || !r.app) return setError(r.error ?? "That didn't work. Try again.");
    onMade(r.app.id);
  };
  return (
    <Dialog
      title={`Duplicate ${app.name}`}
      onClose={busy ? () => {} : onClose}
      actions={
        <>
          <button className="btn btn-quiet" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={() => void go()} data-testid="duplicate-go">
            {busy && <Spinner />} Duplicate
          </button>
        </>
      }
    >
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <p className="callout">{`A second, separate app next to ${app.name}. Changes to one never reach the other. What ${app.name} saved on your phone stays in it.`}</p>
        <label className="fld">
          <span className="label">Name</span>
          <input className="field" data-testid="duplicate-name" value={name} maxLength={50} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="fld">
          <span className="label">What should be different? (optional)</span>
          <VoiceTextarea box={changeBox} className="field field-multi" testId="duplicate-change" value={change} setValue={setChange} rows={3} maxLength={4000} placeholder="Leave empty for an exact copy" />
        </label>
        {error && <p className="label problem-text">{error}</p>}
      </form>
    </Dialog>
  );
}

export function RenameAppDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const [name, setName] = useState(app.name);
  const [newApp, setNewApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim();
  const shared = !!app.sharing?.shared;
  const ready = clean.length > 0 && clean.length <= 50 && (clean !== app.name || newApp);
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const r = await api.renameApp(app.id, clean, newApp);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That didn't work. Try again.");
    onClose();
  };
  return (
    <Dialog
      title={`Rename ${app.name}`}
      onClose={busy ? () => {} : onClose}
      actions={
        <>
          <button className="btn btn-quiet" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={() => void go()} data-testid="rename-go">
            {busy && <Spinner />} {newApp ? "Make the new app" : "Rename"}
          </button>
        </>
      }
    >
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <p className="callout">The new name shows on your phone with the next version, in a few minutes. Its folder and GitHub repo get the new name too.</p>
        <label className="fld">
          <span className="label">New name</span>
          <input className="field" data-testid="rename-name" value={name} maxLength={50} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="toggle-rows">
          <div className="toggle-row" data-testid="rename-new-app">
            <span className="toggle-text">
              <span className="label">Make it a new app</span>
              <span className="caption secondary">{shared ? "Not while it's shared with others." : newApp ? "On: it becomes a new app." : "Off: it stays the same app and keeps updating."}</span>
            </span>
            <Switch on={newApp} disabled={shared || busy} onChange={() => setNewApp(!newApp)} label="Make it a new app" />
          </div>
        </div>
        {newApp && (
          <p className="callout secondary" data-testid="rename-new-app-help">{`Your phone gets it as a new app, next to the old one. The old ${app.name} stops getting updates, and what it saved stays in it. Good for a fresh start, for example before you share it with others.`}</p>
        )}
        {error && <p className="label problem-text">{error}</p>}
      </form>
    </Dialog>
  );
}
