// Ready apps, the gallery of official Kiwimake apps (docs/GALLERY.md), on the PC: a row at the end of
// the app list opens this page in the chat's place. Each card: Install on a phone (a QR code of the
// app's latest APK, the same link Share makes) and Make it mine (this PC makes a separate own version
// from its published code). Design rule (AGENTS.md): the card's words take its full width; its
// buttons go below them, on the right.
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Copy, LayoutGrid, MessageCircle, QrCode } from "lucide-react";
import type { App, GalleryApp, GalleryList } from "../../../../shared/protocol.ts";
import { galleryInstallUrl, galleryReleasesUrl, OFFICIAL_BADGE } from "../../../../shared/chat/gallery.ts";
import { ownVersionName } from "../../../../shared/chat/suggestions.ts";
import { Dialog, Icon, QrPlate, Spinner, StateLine } from "./ui.tsx";

const api = window.anyapp;

/** The app list's "open" value for this page (app ids are UUIDs, so it never clashes). */
export const GALLERY_ID = "ready-apps";

/** The list, through the companion; read again when the companion comes back. */
export function useGalleryList(online: boolean): { list: GalleryList | null; error: string | null; loading: boolean; reload: () => void } {
  const [list, setList] = useState<GalleryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    setLoading(true);
    void api.galleryList().then((r) => {
      setLoading(false);
      if (r.ok && r.list) {
        setList(r.list);
        setError(null);
      } else setError(r.error ?? "Couldn't get the list of ready apps.");
    });
  }, []);
  useEffect(() => {
    if (online) reload();
  }, [online, reload]);
  return { list, error, loading, reload };
}

/** The row at the end of the app list. */
export function GalleryRow({ count, selected, onOpen }: { count: number; selected: boolean; onOpen: () => void }) {
  return (
    <div className="arow-wrap gallery-row-wrap">
      <button className={`arow${selected ? " is-selected" : ""}`} onClick={onOpen} aria-current={selected ? "page" : undefined} data-testid="gallery-row" title="Ready apps">
        <span className="icon-wrap">
          <span className="appicon small gallery-row-icon">
            <Icon of={LayoutGrid} size="sm" />
          </span>
        </span>
        <div className="arow-main">
          <div className="arow-top">
            <span className="body arow-name">Ready apps</span>
            <span className="arow-meta">{count === 1 ? "1 app" : `${count} apps`}</span>
          </div>
          <span className="caption secondary">Install or start from one</span>
        </div>
      </button>
    </div>
  );
}

function GalleryIcon({ app }: { app: GalleryApp }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="appicon gallery-icon">
      {app.icon && !failed ? <img src={app.icon} alt="" onError={() => setFailed(true)} /> : <span className="gallery-letter">{app.name.charAt(0).toUpperCase()}</span>}
    </div>
  );
}

export function OfficialBadge() {
  return (
    <span className="gallery-badge caption" data-testid="gallery-badge">
      <Icon of={BadgeCheck} px={14} /> {OFFICIAL_BADGE}
    </span>
  );
}

/** The page in the chat's place. */
export function GalleryPage({ apps, online, gallery, onOpenApp }: { apps: App[]; online: boolean; gallery: ReturnType<typeof useGalleryList>; onOpenApp: (id: string) => void }) {
  const [installing, setInstalling] = useState<GalleryApp | null>(null);
  const [mine, setMine] = useState<GalleryApp | null>(null);
  const { list, error, loading } = gallery;
  return (
    <div className="dm-scroll gallery-page" data-testid="gallery-page">
      <header className="dm-head">
        <div>
          <h2 className="title">Ready apps</h2>
          <p className="dm-sub callout">Made and checked by {list?.maker ?? "Kiwimake"}. Install one on a phone as it is, or make it yours: this PC makes your own copy that you change as you like.</p>
        </div>
      </header>
      {!list && loading && <StateLine state="working" text="Getting the list" />}
      {!list && error && <StateLine state="problem" text={error} />}
      {list && list.apps.length === 0 && <StateLine state="idle" text="No ready apps yet. Check again soon." />}
      <div className="gallery-list">
        {list?.apps.map((g) => {
          const own = apps.find((a) => a.packageName === g.package && !a.hidden);
          return (
            <article key={g.package} className="card gallery-card" data-testid={`gallery-card-${g.package}`}>
              <div className="gallery-head">
                <GalleryIcon app={g} />
                <div className="gallery-title">
                  <strong className="heading">{g.name}</strong>
                  <OfficialBadge />
                </div>
              </div>
              {g.line && <p className="callout secondary">{g.line}</p>}
              <p className="caption secondary">{[g.latest.version ? `Version ${g.latest.version}.` : "", own ? "One of your apps on this PC." : ""].filter(Boolean).join(" ")}</p>
              <div className="notice-actions">
                <button className="btn btn-quiet btn-sm" onClick={() => setInstalling(g)} data-testid={`gallery-install-${g.package}`}>
                  <Icon of={QrCode} size="sm" /> Install on a phone
                </button>
                {own ? (
                  <button className="btn btn-quiet btn-sm" onClick={() => onOpenApp(own.id)}>
                    <Icon of={MessageCircle} size="sm" /> Open its chat
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => setMine(g)} disabled={!online} data-testid={`gallery-mine-${g.package}`}>
                    <Icon of={Copy} size="sm" /> Make it mine
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {installing && <InstallDialog app={installing} onClose={() => setInstalling(null)} />}
      {mine && (
        <MineDialog
          app={mine}
          maker={list?.maker ?? "Kiwimake"}
          onClose={() => setMine(null)}
          onMade={(id) => {
            setMine(null);
            onOpenApp(id);
          }}
        />
      )}
    </div>
  );
}

function InstallDialog({ app, onClose }: { app: GalleryApp; onClose: () => void }) {
  const url = galleryInstallUrl(app);
  const [qr, setQr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void api.qr(url).then(setQr);
  }, [url]);
  return (
    <Dialog
      title={`Install ${app.name} on a phone`}
      onClose={onClose}
      actions={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="gallery-install">
        <p className="callout secondary">Scan it with the phone's camera to download {app.name}. In Kiwimake on the phone it is under Ready apps, where Install also checks that it is signed by Kiwimake.</p>
        {qr ? <QrPlate svg={qr} size={168} label={`QR code for ${app.name}`} /> : <Spinner />}
        <code className="sub" data-testid="gallery-install-link">{url}</code>
        {note && <p className="label secondary">{note}</p>}
        <div className="notice-actions">
          <button className="btn btn-quiet btn-sm" onClick={() => void api.openExternal(galleryReleasesUrl(app))}>
            Open on GitHub
          </button>
          <button className="btn btn-quiet btn-sm" onClick={() => void api.copyText(url).then(() => setNote("Link copied."))}>
            Copy link
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function MineDialog({ app, maker, onClose, onMade }: { app: GalleryApp; maker: string; onClose: () => void; onMade: (id: string) => void }) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.getOwnerName().then(setOwner);
  }, []);
  const placeholder = ownVersionName(app.name, owner);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await api.makeItMine({ repo: app.repo, name: name.trim() || placeholder, firstChange: change.trim(), originalName: app.name, owner: maker });
    setBusy(false);
    if (r.ok && r.app) onMade(r.app.id);
    else setError(r.error ?? "This PC could not make it. Try again.");
  };
  return (
    <Dialog
      title={`Make ${app.name} yours`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy} data-testid="gallery-mine-make">
            {busy ? <Spinner /> : <Icon of={Copy} size="button" />} Make it
          </button>
        </>
      }
    >
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="callout secondary">
          This PC gets the code of {app.name} and makes a separate app from it: its own name, its own place on this PC and on GitHub, installed next to {maker}'s. Nothing comes over from {maker}'s later by itself.
        </p>
        <label className="fld">
          <span className="label">Name of your version</span>
          <input className="field" data-testid="gallery-mine-name" value={name} maxLength={50} placeholder={placeholder} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="fld">
          <span className="label">First change (optional)</span>
          <textarea className="field field-multi" rows={3} value={change} placeholder="Bigger numbers, and a dark mode" onChange={(e) => setChange(e.target.value)} />
        </label>
        {error && <StateLine state="problem" text={error} />}
      </form>
    </Dialog>
  );
}
