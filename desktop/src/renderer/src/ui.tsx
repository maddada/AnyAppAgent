// Small shared pieces on the shared theme: Lucide icons at the theme's stroke, the mark, the
// wordmark, the state line (COMPONENTS.md 8) and the QR plate (7).
import type { LucideIcon } from "lucide-react";
import { CircleAlert } from "lucide-react";
import { icon as iconTokens } from "../../../../shared/theme/tokens.ts";
import markUrl from "../../../../shared/theme/mark/mark.svg";
import type { App } from "../../shared/types.ts";

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
      <span>AnyAppAgent</span>
    </div>
  );
}

export type UiState = "working" | "ready" | "problem" | "idle";

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

/** An app's state in the four words the theme allows. */
export function appState(app: App): { state: UiState; text: string } {
  switch (app.status) {
    case "creating":
      return { state: "working", text: "Setting up" };
    case "working":
      return { state: "working", text: "Making changes" };
    case "building":
      return { state: "working", text: `Building version ${app.latestBuild?.number ?? ""}`.trim() };
    case "error":
      return { state: "problem", text: app.latestBuild?.status === "failed" ? "Couldn't build" : "Something went wrong" };
    default: {
      const apk = app.latestApk;
      if (!apk) return { state: "idle", text: "Waiting for the first version" };
      const fresh = apk.finishedAt && Date.now() - Date.parse(apk.finishedAt) < 60 * 60_000;
      return fresh ? { state: "ready", text: `Version ${apk.number} ready` } : { state: "idle", text: "Up to date" };
    }
  }
}

export function AppIcon({ icon, small }: { icon?: string; small?: boolean }) {
  return <div className={`appicon${small ? " small" : ""}`}>{icon ? <img src={icon} alt="" /> : null}</div>;
}
