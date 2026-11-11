// "From others" (docs/CHANGE-THIS-APP.md): suggestions people sent the owner about an app, as text
// (WhatsApp, SMS, email). Pasted here (or shared into AnyAppAgent on the phone), they are filed under
// the right app by the companion. Open in chat puts the words in the app's composer to send or edit.
import { useEffect, useState } from "react";
import { Inbox, MessageCircle, X } from "lucide-react";
import type { App, Suggestion } from "../../../../shared/protocol.ts";
import { suggestionPrompt } from "../../../../shared/chat/suggestions.ts";
import { drafts, draftSet } from "./chatStore.ts";
import { Dialog, Icon, timeAgo } from "./ui.tsx";

const api = window.anyapp;

export function FromOthersButton({ app, online, onOpen }: { app: App; online: boolean; onOpen: () => void }) {
  const waiting = app.fromOthers ?? 0;
  return (
    // Small, so the app's name keeps its room in the header; the count shows when something waits.
    <button className="btn btn-quiet btn-sm" onClick={onOpen} disabled={!online} data-testid="from-others" aria-label="From others" title="From others: suggestions people sent you about this app">
      <Icon of={Inbox} size="sm" />
      {waiting > 0 ? ` ${waiting}` : null}
    </button>
  );
}

export function FromOthersDialog({ app, onClose, onOpenApp }: { app: App; onClose: () => void; onOpenApp: (appId: string) => void }) {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api.getSuggestions(app.id);
    if (r.ok) setList(r.suggestions);
    else setError(r.error ?? "The list could not be loaded.");
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id, app.fromOthers]);

  const file = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.fileSuggestion(paste);
      if (!r.ok) return setError(r.error ?? "That is not a suggestion.");
      setPaste("");
      if (r.appId && r.appId !== app.id) {
        onOpenApp(r.appId);
        return setNote("Filed under another app: it is open now.");
      }
      setNote("Added.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openInChat = async (s: Suggestion) => {
    drafts.set(app.id, suggestionPrompt(s));
    draftSet.dispatchEvent(new CustomEvent("set", { detail: app.id }));
    if (!s.opened) await api.openSuggestion(app.id, s.id);
    onClose();
  };

  const remove = async (s: Suggestion) => {
    setList((l) => (l ?? []).filter((x) => x.id !== s.id));
    const r = await api.removeSuggestion(app.id, s.id);
    if (!r.ok) setError(r.error ?? "It could not be removed.");
  };

  return (
    <Dialog title={`From others: ${app.name}`} onClose={onClose} wide>
      <section className="list">
        {list === null ? (
          <div className="srow">
            <span className="sub">Loading...</span>
          </div>
        ) : list.length === 0 ? (
          <div className="srow">
            <div className="srow-main">
              <span className="body">No suggestions yet</span>
              <span className="sub">People with {app.name} can tap Change this app in its settings and send you a suggestion as a message. Paste it below, or share it to AnyAppAgent on your phone.</span>
            </div>
          </div>
        ) : (
          list.map((s) => (
            <div className="srow" key={s.id} data-testid="suggestion">
              <div className="srow-main">
                <span className="body">{s.from ? `${s.from} suggests` : "Someone suggests"}</span>
                <span className="callout">{s.text}</span>
                <span className="sub">
                  {timeAgo(s.receivedAt)}
                  {s.build ? `, on version ${s.build}` : ""}
                  {s.opened ? ", opened" : ""}
                </span>
              </div>
              <button className={`btn btn-sm ${s.opened ? "btn-quiet" : "btn-primary"}`} onClick={() => void openInChat(s)} data-testid="suggestion-open">
                <Icon of={MessageCircle} size="sm" /> Open in chat
              </button>
              <button className="btn btn-icon btn-quiet btn-sm" aria-label="Remove" title="Remove" onClick={() => void remove(s)}>
                <Icon of={X} size="sm" />
              </button>
            </div>
          ))
        )}
      </section>
      <section className="list">
        <div className="srow">
          <div className="srow-main">
            <span className="body">Paste a suggestion</span>
            <span className="sub">Copy the whole message someone sent you, with its last line, and paste it here. It is filed under the right app.</span>
            <textarea className="field" rows={4} style={{ height: "auto", paddingTop: "var(--aa-space-sm)", paddingBottom: "var(--aa-space-sm)" }} placeholder="Ahmad suggests a change to ..." value={paste} onChange={(e) => setPaste(e.target.value)} data-testid="suggestion-paste" />
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy || !paste.trim()} onClick={() => void file()} data-testid="suggestion-add">
            Add
          </button>
        </div>
      </section>
      {error && <p className="label problem-text">{error}</p>}
      {note && <p className="label">{note}</p>}
    </Dialog>
  );
}
