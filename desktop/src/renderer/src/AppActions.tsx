// Pin, hide and delete (shared/protocol.ts "Pin, hide and delete"): the app row's menu, the Delete
// dialog, and the Settings groups for hidden apps and Recently deleted.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import type { App, Snapshot } from "../../shared/types.ts";
import { AppIcon, Dialog, Icon, Spinner, Switch, timeAgo } from "./ui.tsx";

const api = window.anyapp;

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  separatorBefore?: boolean;
}

/** A small floating menu at (x, y): Esc, a click outside, scrolling or resizing closes it; arrows move between items. */
export function Menu({ x, y, items, label, onClose }: { x: number; y: number; items: MenuItem[]; label: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    setAt({ left: Math.max(pad, Math.min(x, window.innerWidth - width - pad)), top: Math.max(pad, Math.min(y, window.innerHeight - height - pad)) });
  }, [x, y]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
    const outside = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    window.addEventListener("mousedown", outside, true);
    window.addEventListener("contextmenu", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", outside, true);
      window.removeEventListener("contextmenu", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
      if (box.current?.contains(document.activeElement) || document.activeElement === document.body) before?.focus?.();
    };
  }, [onClose]);
  const onKey = (e: KeyboardEvent) => {
    const list = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => list[(n + list.length) % list.length]?.focus();
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") (e.preventDefault(), go(i + 1));
    else if (e.key === "ArrowUp") (e.preventDefault(), go(i - 1));
    else if (e.key === "Home") (e.preventDefault(), go(0));
    else if (e.key === "End") (e.preventDefault(), go(list.length - 1));
  };
  return createPortal(
    <div ref={box} className="menu" role="menu" aria-label={label} style={at} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item) => (
        <div key={item.label} className="menu-slot">
          {item.separatorBefore && <div className="menu-sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={`menu-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon && <Icon of={item.icon} size="sm" />}
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Delete: always to Recently deleted; also from the phone and, for good, from this PC and GitHub. */
export function DeleteAppDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const [phone, setPhone] = useState(false);
  const [forGood, setForGood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await api.deleteApp(app.id, { uninstall: phone, forGood });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That didn't work. Try again.");
    if (r.problem) return setProblem(r.problem);
    onClose();
  };
  const rows: { label: string; sub: string; on: boolean; disabled?: boolean; toggle: () => void; testid: string }[] = [
    { label: "App list", sub: "It moves to Recently deleted in Settings.", on: true, disabled: true, toggle: () => {}, testid: "delete-list" },
    { label: "Your phone", sub: "Uninstalls it from your phone. Android asks first.", on: phone, toggle: () => setPhone(!phone), testid: "delete-phone" },
    { label: "PC and GitHub", sub: "Deletes its chat, files and code for good.", on: forGood, toggle: () => setForGood(!forGood), testid: "delete-for-good" },
  ];
  return (
    <Dialog
      title={`Delete ${app.name}?`}
      onClose={busy ? () => {} : onClose}
      actions={
        problem ? (
          <button className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className="btn btn-quiet" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-problem" disabled={busy} onClick={() => void go()} data-testid="delete-go">
              {busy && <Spinner />} {forGood ? "Delete for good" : "Delete"}
            </button>
          </>
        )
      }
    >
      {problem ? (
        <p className="callout problem-text">{problem}</p>
      ) : (
        <div className="fields">
          <p className="callout">Choose where to delete it from. The app list and your phone can be restored from Recently deleted in Settings. PC and GitHub can't be undone.</p>
          <div className="toggle-rows">
            {rows.map((r) => (
              <div key={r.label} className="toggle-row" data-testid={r.testid}>
                <span className="toggle-text">
                  <span className="label">{r.label}</span>
                  <span className="caption secondary">{r.sub}</span>
                </span>
                <Switch on={r.on} disabled={r.disabled || busy} onChange={r.toggle} label={r.label} />
              </div>
            ))}
          </div>
          {error && <p className="label problem-text">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

/** Settings: the apps hidden from the app list, each with Unhide. */
export function HiddenAppsGroup({ s }: { s: Snapshot }) {
  const hidden = s.apps.filter((a) => a.hidden).sort((a, b) => a.name.localeCompare(b.name));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unhide = async (id: string) => {
    setBusy(id);
    setError(null);
    const r = await api.hideApp(id, false);
    setBusy(null);
    if (!r.ok) setError(r.error ?? "That didn't work. Try again.");
  };
  return (
    <section className="settings-group" data-testid="hidden-apps">
      <h2 className="heading">Hidden apps</h2>
      <p className="callout secondary">Hidden apps are not in your app list. They still work on your phone.</p>
      <div className="list">
        {hidden.length === 0 ? (
          <div className="srow">
            <div className="srow-main">
              <span className="sub">No hidden apps.</span>
            </div>
          </div>
        ) : (
          hidden.map((a) => (
            <div key={a.id} className="srow app-srow">
              <AppIcon icon={s.icons[a.id]} small />
              <div className="srow-main">
                <span className="body">{a.name}</span>
              </div>
              <div className="notice-actions">
                <button className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => void unhide(a.id)}>
                  Unhide
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      {error && <p className="label problem-text">{error}</p>}
    </section>
  );
}

/** Settings: Recently deleted, each app with Restore, and Empty (asks first). */
export function RecentlyDeletedGroup({ s }: { s: Snapshot }) {
  const trash = s.trash ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (key: string, run: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    const r = await run();
    setBusy(null);
    if (!r.ok) setError(r.error ?? "That didn't work. Try again.");
    return r.ok;
  };
  return (
    <section className="settings-group" data-testid="recently-deleted">
      <h2 className="heading">Recently deleted</h2>
      <p className="callout secondary">Apps you delete wait here until you empty it. Restore one and it comes back with its chat and versions.</p>
      <div className="list">
        {trash.length === 0 ? (
          <div className="srow">
            <div className="srow-main">
              <span className="sub">Nothing here.</span>
            </div>
          </div>
        ) : (
          <>
            {trash.map((a) => (
              <div key={a.id} className="srow app-srow">
                <AppIcon icon={s.icons[a.id]} small />
                <div className="srow-main">
                  <span className="body">{a.name}</span>
                  {a.deletedAt && <span className="sub">Deleted {timeAgo(a.deletedAt)}</span>}
                </div>
                <div className="notice-actions">
                  <button className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => void act(a.id, () => api.restoreDeleted(a.id))}>
                    {busy === a.id && <Spinner />} Restore
                  </button>
                </div>
              </div>
            ))}
            <div className="srow" data-testid="empty-trash">
              <div className="srow-main">
                {confirm ? <span className="body">Empty Recently deleted? This can't be undone.</span> : <span className="sub">Empty deletes them for good from this PC. Their code stays on GitHub.</span>}
              </div>
              <div className="notice-actions">
                {confirm && (
                  <button className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => setConfirm(false)}>
                    Cancel
                  </button>
                )}
                <button
                  className="btn btn-problem btn-sm"
                  disabled={busy !== null}
                  onClick={() => (confirm ? void act("empty", () => api.emptyTrash()).then(() => setConfirm(false)) : setConfirm(true))}
                >
                  {busy === "empty" && <Spinner />} Empty
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {error && <p className="label problem-text">{error}</p>}
    </section>
  );
}
