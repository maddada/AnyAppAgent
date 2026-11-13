// Small shared pieces on the shared theme: Lucide icons at the theme's stroke, the mark, the
// wordmark, the state line (COMPONENTS.md 8), the QR plate (7) and the dialog (4).
import { useEffect, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, X } from "lucide-react";
import { icon as iconTokens } from "../../../../shared/theme/tokens.ts";
import markUrl from "../../../../shared/theme/mark/mark.svg";
import wordmarkUrl from "../../../../shared/theme/mark/wordmark.svg";
import wordmarkDarkUrl from "../../../../shared/theme/mark/wordmark-dark.svg";
import type { App } from "../../shared/types.ts";
import { describeApp, type StateKind } from "../../../../shared/chat/index.ts";

type IconSize = keyof typeof iconTokens.size;

/** A Lucide icon with the theme's stroke and absolute stroke width (COMPONENTS.md "How to read this"). */
export function Icon({ of: Of, size = "sm", px }: { of: LucideIcon; size?: IconSize; px?: number }) {
  return <Of className="ic" size={px ?? iconTokens.size[size]} strokeWidth={iconTokens.stroke} absoluteStrokeWidth={iconTokens.absoluteStrokeWidth} aria-hidden />;
}

export function Mark() {
  return <img className="mark" src={markUrl} alt="" />;
}

export function Wordmark() {
  return (
    <div className="wordmark">
      <Mark />
      <span>
        <img className="wordmark-name wordmark-light" src={wordmarkUrl} alt="Kiwimake" />
        <img className="wordmark-name wordmark-dark" src={wordmarkDarkUrl} alt="Kiwimake" />
      </span>
    </div>
  );
}

export type UiState = StateKind;

export function StateLine({ state, text }: { state: UiState; text: string }) {
  return (
    <div className={`state state-${state}`}>
      {state === "ready" && <span className="state-dot" />}
      {state === "working" && <span className="spin" />}
      {state === "problem" && <Icon of={CircleAlert} px={15} />}
      <span>{text}</span>
    </div>
  );
}

export function Spinner() {
  return <span className="spin" aria-hidden />;
}

/** The QR plate: dark modules on light paper in both modes so every phone camera reads it. */
export function QrPlate({ svg, size, label }: { svg: string; size: number; label: string }) {
  return (
    <div className="qr-plate" role="img" aria-label={label}>
      <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

export function timeAgo(iso?: string): string {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "today";
  const y = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return "yesterday";
  if (today.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString();
}

/** An app's state in the four words the theme allows: the shared wording (shared/chat/state.ts), as on the phone. */
export function appState(app: App): { state: UiState; text: string } {
  const st = describeApp(app);
  return { state: st.kind, text: st.label };
}

export function AppIcon({ icon, small }: { icon?: string; small?: boolean }) {
  return <div className={`appicon${small ? " small" : ""}`}>{icon ? <img src={icon} alt="" /> : null}</div>;
}

/**
 * The dialog (COMPONENTS.md 4). Esc, a click on the scrim or the Close button closes it. Focus
 * moves into it when it opens, stays inside while Tab cycles, and goes back where it was after.
 */
export function Dialog({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>("[autofocus]") ?? el.querySelector<HTMLElement>(".dialog-head .btn-icon"))?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const el = box.current;
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, a[href], [tabindex]:not([tabindex='-1'])")];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2 className="title-small">{title}</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <Icon of={X} size="md" />
          </button>
        </div>
        <div className="body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}
