// Sharing an app with other people and publishing versions to them (docs/DISTRIBUTION.md, stage 6):
// the Share button in the app's chat header and its dialog. The work happens in the companion
// (POST /api/apps/:id/share, /publish, /pullback; GET /releases), which talks to GitHub.
import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import type { App, PublishedRelease, ReleaseStats } from "../../../../shared/protocol.ts";
import { Dialog, Icon, QrPlate, Spinner, timeAgo } from "./ui.tsx";

const api = window.anyapp;

export function ShareButton({ app, online, onOpen }: { app: App; online: boolean; onOpen: () => void }) {
  const shared = app.sharing?.shared;
  return (
    <button className="btn btn-quiet btn-sm" onClick={onOpen} disabled={!online || !app.repoUrl && !app.latestApk} data-testid="share" title="Share this app with other people">
      <Icon of={Share2} size="sm" /> {shared ? "Shared" : "Share"}
    </button>
  );
}

function SwitchRow({ on, busy, onChange }: { on: boolean; busy: boolean; onChange: () => void }) {
  return <button className={`switch${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label="Share with others" disabled={busy} onClick={onChange} data-testid="share-switch" />;
}

export function ShareDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const sharing = app.sharing;
  const shared = Boolean(sharing?.shared);
  const releases = sharing?.releases ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [channel, setChannel] = useState<"stable" | "testing">("stable");
  const [qr, setQr] = useState<string | null>(null);
  const [stats, setStats] = useState<ReleaseStats[] | null>(null);
  // "Change this app" (docs/CHANGE-THIS-APP.md)
  const showToOthers = app.change?.showToOthers !== false;
  const [owner, setOwner] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  useEffect(() => {
    void api.getOwnerName().then(setOwner);
  }, []);

  const newest = app.latestApk?.number;
  const published = releases.find((r) => r.channel === channel && r.build === newest && !r.pulledBack);
  const pulled = releases.some((r) => r.build === newest && r.pulledBack);

  useEffect(() => {
    if (!sharing?.installUrl || !shared) return setQr(null);
    void api.qr(sharing.installUrl).then(setQr);
  }, [sharing?.installUrl, shared]);
  useEffect(() => {
    if (!shared || releases.length === 0) return;
    void api.releaseStats(app.id).then((r) => setStats(r.ok ? r.stats : null));
  }, [app.id, shared, releases.length]);

  const run = async (what: string, fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(what);
    setError(null);
    setNote(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That did not work.");
      else if (done) setNote(done);
    } finally {
      setBusy(null);
    }
  };

  const downloads = (r: PublishedRelease) => stats?.find((s) => s.tag === r.tag)?.downloads;

  return (
    <Dialog title={`Share ${app.name}`} onClose={onClose} wide>
      <section className="list">
        <div className="srow">
          <div className="srow-main">
            <span className="body">Share with others</span>
            <span className="sub">
              {shared
                ? "Anyone with the link can install it and gets your new versions. Each version you publish also carries its code, so others can make their own version."
                : "Makes a public page on GitHub with the app's name, icon and the versions you publish. Each published version also carries its code; your chat, the app's notes about you, keys and .env files never go."}
            </span>
          </div>
          {busy === "share" ? <Spinner /> : <SwitchRow on={shared} busy={busy !== null} onChange={() => void run("share", () => api.shareApp(app.id, !shared), shared ? "Not shared any more. People who have it keep it, but get no new versions." : undefined)} />}
        </div>
        {shared && sharing && (
          <div className="srow">
            <div className="srow-main">
              <span className="body">Link for other people</span>
              <span className="sub">They open it on their Android phone and install. {releases.some((r) => r.channel === "stable" && !r.pulledBack) ? "" : "It works once you publish a version."}</span>
              <div className="row wrap">
                <code className="sub" data-testid="share-link">{sharing.installUrl}</code>
                <button className="btn btn-quiet btn-sm" onClick={() => void api.copyText(sharing.installUrl).then(() => setNote("Link copied."))}>
                  Copy link
                </button>
                <button className="btn btn-quiet btn-sm" onClick={() => void api.openExternal(sharing.releasesRepoUrl)}>
                  Open on GitHub
                </button>
              </div>
            </div>
            {qr && <QrPlate svg={qr} size={132} label={`QR code for ${app.name}`} />}
          </div>
        )}
        <div className="srow">
          <div className="srow-main">
            <span className="body">Show "Change this app" to others</span>
            <span className="sub">
              {showToOthers
                ? "Everyone with the app sees the row in its settings: they can suggest a change to you, or make their own version. From the next version."
                : "Off: only your phone shows the row. From the next version."}
            </span>
          </div>
          {busy === "change" ? (
            <Spinner />
          ) : (
            <button
              className={`switch${showToOthers ? " on" : ""}`}
              role="switch"
              aria-checked={showToOthers}
              aria-label="Show Change this app to others"
              disabled={busy !== null}
              onClick={() => void run("change", () => api.setChange(app.id, { showToOthers: !showToOthers }))}
              data-testid="change-switch"
            />
          )}
        </div>
        <div className="srow">
          <div className="srow-main">
            <span className="body">Your name in your apps</span>
            <span className="sub">"Made by {owner || "you"}" and "Suggest a change to {owner || "you"}". The same for every app, from its next version.</span>
            {editingName ? (
              <div className="row wrap">
                <input className="field" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40} data-testid="owner-name" />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("name", async () => {
                      const r = await api.setChange(app.id, { ownerName: nameDraft });
                      if (r.ok) {
                        setEditingName(false);
                        setOwner(await api.getOwnerName());
                      }
                      return r;
                    })
                  }
                >
                  Save
                </button>
              </div>
            ) : null}
          </div>
          {!editingName && (
            <button
              className="btn btn-quiet btn-sm"
              onClick={() => {
                setNameDraft(owner);
                setEditingName(true);
              }}
            >
              Change
            </button>
          )}
        </div>
      </section>

      {shared && (
        <section className="list">
          <div className="srow">
            <div className="srow-main">
              <span className="body">Publish this version</span>
              <span className="sub">
                {newest ? `Build ${newest}, the one on your phone now.` : "There is no finished build yet."} Leave the notes empty to use what changed since the last version.
              </span>
              <textarea className="field" rows={3} style={{ height: "auto", paddingTop: "var(--aa-space-sm)", paddingBottom: "var(--aa-space-sm)" }} placeholder="What's new (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="publish-notes" />
              <div className="row wrap">
                <span className="sub">Who gets it:</span>
                <button className={`btn btn-sm ${channel === "stable" ? "btn-primary" : "btn-quiet"}`} aria-pressed={channel === "stable"} onClick={() => setChannel("stable")}>
                  Everyone
                </button>
                <button className={`btn btn-sm ${channel === "testing" ? "btn-primary" : "btn-quiet"}`} aria-pressed={channel === "testing"} onClick={() => setChannel("testing")}>
                  Testers
                </button>
              </div>
            </div>
            {busy === "publish" ? (
              <Spinner />
            ) : (
              <button
                className="btn btn-primary btn-sm"
                data-testid="publish"
                disabled={busy !== null || !newest || Boolean(published) || pulled}
                onClick={() =>
                  void run("publish", async () => {
                    const r = await api.publishApp(app.id, notes, channel);
                    if (r.ok) setNotes("");
                    return r;
                  }, channel === "stable" ? "Published. People who have the app get a notification." : "Published for testers.")
                }
              >
                {published ? "Published" : pulled ? "Pulled back" : "Publish"}
              </button>
            )}
          </div>
        </section>
      )}

      {releases.length > 0 && (
        <section className="list">
          <div className="srow">
            <div className="srow-main">
              <span className="body">Versions</span>
              <span className="sub">Downloads are counted by GitHub some minutes late, and count downloads, not people.</span>
            </div>
          </div>
          {releases.map((r) => (
            <div className="srow" key={`${r.tag}-${r.build}`}>
              <div className="srow-main">
                <span className="body">
                  {r.version}
                  {r.channel === "testing" ? " (testers)" : ""}
                  {r.pulledBack ? " (pulled back)" : ""}
                </span>
                <span className="sub">
                  Build {r.build}, {timeAgo(r.publishedAt)}
                  {downloads(r) !== undefined ? `, ${downloads(r)} ${downloads(r) === 1 ? "download" : "downloads"}` : ""}
                </span>
              </div>
              {r.channel === "stable" && !r.pulledBack && (
                <button
                  className="btn btn-quiet btn-sm"
                  disabled={busy !== null}
                  onClick={() => void run(`pull-${r.build}`, () => api.pullBack(app.id, r.build), `${r.version} is pulled back. New installs get the version before it.`)}
                >
                  {busy === `pull-${r.build}` ? "Pulling back..." : "Pull back"}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {error && <p className="label problem-text">{error}</p>}
      {note && <p className="label">{note}</p>}
    </Dialog>
  );
}
