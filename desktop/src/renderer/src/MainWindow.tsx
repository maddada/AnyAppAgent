// The main window after onboarding: sidebar (Apps, Phones, Setup, Settings), the app list with
// today's activity, the phone and "add another phone" panels, and each app's chat (Chat.tsx).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, CircleAlert, Cloud, FolderOpen, KeyRound, LayoutGrid, ListChecks, RefreshCw, Settings as Gear, Smartphone, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CheckState, Snapshot } from "../../shared/types.ts";
import { size as sizeTokens } from "../../../../shared/theme/tokens.ts";
import { ChatView } from "./Chat.tsx";
import type { StepId } from "./Onboarding.tsx";
import { PairingPanel, TypedCode, useFreshCode } from "./Pairing.tsx";
import { AppIcon, Icon, QrPlate, Spinner, StateLine, appState, timeAgo, Wordmark, type UiState } from "./ui.tsx";

const api = window.anyapp;
type Page = "apps" | "phones" | "setup" | "settings";

export function MainWindow({ s, openSetup, connectRequest }: { s: Snapshot; openSetup: (step: StepId) => void; connectRequest: number }) {
  const [page, setPage] = useState<Page>("apps");
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [connect, setConnect] = useState(false);
  useEffect(() => {
    if (connectRequest > 0) setConnect(true);
  }, [connectRequest]);
  useEffect(() => {
    (window as unknown as { __main: unknown }).__main = {
      page: (p: Page) => {
        setOpenApp(null);
        setPage(p);
      },
      openApp: (id: string | null) => setOpenApp(id),
      connect: (v: boolean) => setConnect(v),
    };
  });
  const app = s.apps.find((a) => a.id === openApp);
  const attention = setupRows(s).filter((r) => r.needsYou && r.blocks).length;
  const nav: [Page, LucideIcon, string][] = [
    ["apps", LayoutGrid, "Apps"],
    ["phones", Smartphone, "Phones"],
    ["setup", ListChecks, "Setup"],
    ["settings", Gear, "Settings"],
  ];
  return (
    <div className="dm">
      <aside className="dm-side">
        <Wordmark />
        <nav className="nav">
          {nav.map(([id, of, label]) => (
            <button
              key={id}
              className={`nav-i${page === id && !app ? " is-active" : ""}`}
              onClick={() => {
                setOpenApp(null);
                setPage(id);
              }}
            >
              <Icon of={of} size="button" />
              {label}
              {id === "setup" && attention > 0 && (
                <span className="nav-count" title={`${attention} need you`}>
                  <Icon of={CircleAlert} px={15} />
                </span>
              )}
            </button>
          ))}
        </nav>
        <SideStatus s={s} />
      </aside>
      <main className="dm-main">
        {app ? (
          <ChatView app={app} icon={s.icons[app.id]} onBack={() => setOpenApp(null)} />
        ) : (
          <div className="dm-scroll">
            {page === "apps" && <AppsPage s={s} onOpen={setOpenApp} onConnect={() => setConnect(true)} openSetup={openSetup} goSetup={() => setPage("setup")} />}
            {page === "phones" && <PhonesPage s={s} />}
            {page === "setup" && <SetupPage s={s} openSetup={openSetup} />}
            {page === "settings" && <SettingsPage s={s} openSetup={openSetup} />}
          </div>
        )}
      </main>
      {connect && (
        <Dialog title="Connect a phone" wide onClose={() => setConnect(false)}>
          <p className="callout body">
            No AnyAppAgent on the phone yet?{" "}
            <button
              className="btn btn-text"
              onClick={() => {
                setConnect(false);
                openSetup("phone-get");
              }}
            >
              Get the app first
            </button>
          </p>
          <PairingPanel s={s} />
        </Dialog>
      )}
    </div>
  );
}

function SideStatus({ s }: { s: Snapshot }) {
  const c = s.companion;
  const ec = s.admin?.easyConnect.state;
  const [mark, title, line]: [ReactNode, string, string] =
    c.phase === "running"
      ? [<span className="state-dot" style={{ color: "var(--aa-ready)" }} />, "Running", ec === "ready" ? "Your phone can reach this PC from anywhere" : "Phones on this Wi-Fi can reach this PC"]
      : c.phase === "failed"
        ? [<span style={{ color: "var(--aa-problem)" }}><Icon of={CircleAlert} px={15} /></span>, "Needs attention", c.message]
        : [<Spinner />, c.phase === "restarting" ? "Restarting" : "Starting", "Getting ready to make apps"];
  return (
    <div className="side-status caption">
      {mark}
      <div>
        <strong>{title}</strong>
        <span>{line}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Apps

function activity(s: Snapshot): { time: string; text: string }[] {
  const today = new Date().toDateString();
  return [...s.apps]
    .filter((a) => new Date(a.updatedAt).toDateString() === today)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6)
    .map((a) => {
      const st = appState(a);
      const what =
        a.status === "idle" && a.latestApk
          ? `version ${a.latestApk.number} built and sent to your phone`
          : a.status === "error"
            ? `version ${a.latestBuild?.number ?? ""} didn't build`.replace("  ", " ")
            : st.text.toLowerCase();
      return { time: new Date(a.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }), text: `${a.name}: ${what}` };
    });
}

function AppsPage({ s, onOpen, onConnect, openSetup, goSetup }: { s: Snapshot; onOpen: (id: string) => void; onConnect: () => void; openSetup: (step: StepId) => void; goSetup: () => void }) {
  const apps = useMemo(() => [...s.apps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [s.apps]);
  const blocking = setupRows(s).find((r) => r.needsYou && r.blocks);
  const recent = activity(s);
  return (
    <>
      <header className="dm-head">
        <div>
          <h1 className="title">Your apps</h1>
          <p className="dm-sub callout">{apps.length === 0 ? "Nothing made yet" : `${apps.length} ${apps.length === 1 ? "app" : "apps"}, all made on this PC`}</p>
        </div>
        <button className="btn btn-quiet" onClick={() => api.openFolder("apps")}>
          <Icon of={FolderOpen} size="button" /> Open apps folder
        </button>
      </header>
      <div className="dm-cols">
        <div className="dm-left">
          {blocking && (
            <div className="card notice">
              <div className="grow">
                <StateLine state="problem" text={blocking.problemText ?? blocking.sub} />
              </div>
              <button className="btn btn-quiet btn-sm" onClick={() => (blocking.step ? openSetup(blocking.step) : goSetup())}>
                Fix it
              </button>
            </div>
          )}
          {apps.length === 0 ? (
            <section className="list empty">
              <strong className="heading">No apps yet</strong>
              <p className="callout secondary">Make your first one from your phone: open AnyAppAgent and tap New app. It shows up here while this PC makes it.</p>
            </section>
          ) : (
            <section className="list">
              {apps.map((a) => {
                const st = appState(a);
                const v = a.latestApk ?? a.latestBuild;
                return (
                  <button key={a.id} className="lrow" onClick={() => onOpen(a.id)}>
                    <AppIcon icon={s.icons[a.id]} />
                    <div className="lrow-main">
                      <div className="heading">{a.name}</div>
                      <StateLine state={st.state} text={st.text} />
                    </div>
                    <div className="lrow-meta">{[v ? `v${v.number}` : "", timeAgo(a.updatedAt)].filter(Boolean).join(", ")}</div>
                    <span className="lrow-chev">
                      <Icon of={ChevronRight} size="button" />
                    </span>
                  </button>
                );
              })}
            </section>
          )}
          {recent.length > 0 && (
            <section className="recent">
              <div className="eyebrow">Today</div>
              {recent.map((r, i) => (
                <div key={i} className="recent-row">
                  <time>{r.time}</time>
                  <span>{r.text}</span>
                </div>
              ))}
            </section>
          )}
        </div>
        <aside className="dm-aside">
          <PhonesPanel s={s} />
          <AddPhonePanel s={s} onMore={onConnect} />
        </aside>
      </div>
    </>
  );
}

function PhonesPanel({ s }: { s: Snapshot }) {
  const devices = s.admin?.devices ?? [];
  return (
    <div className="panel">
      <div className="eyebrow">{devices.length > 1 ? "Your phones" : "Your phone"}</div>
      {devices.length === 0 ? (
        <p className="label secondary">No phone connected yet.</p>
      ) : (
        devices.map((d) => (
          <div key={d.id} className="phone-row">
            <Icon of={Smartphone} size="md" />
            <div>
              <strong className="body">{d.name}</strong>
              <span className="label">{d.connected ? "Connected, seen just now" : d.lastSeenAt ? `Last seen ${timeAgo(d.lastSeenAt)}` : "Paired"}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function AddPhonePanel({ s, onMore }: { s: Snapshot; onMore: () => void }) {
  useFreshCode(s);
  const p = s.pairing;
  const hasPhone = (s.admin?.devices.length ?? 0) > 0;
  return (
    <div className="panel qr-card">
      <div className="eyebrow">{hasPhone ? "Add another phone" : "Connect your phone"}</div>
      {/* The Easy Connect code is long (about 354 characters): give it more room than the standard QR. */}
      {p.qrSvg ? <QrPlate svg={p.qrSvg} size={p.kind === "easy-connect" ? sizeTokens.qr * 1.6 : sizeTokens.qr} label="Code to connect a phone" /> : <Spinner />}
      <p className="label secondary">Open AnyAppAgent on the phone and scan this code.</p>
      <button className="btn btn-quiet btn-sm btn-block" onClick={onMore}>
        {p.kind === "easy-connect" ? "Use a code instead" : "Bigger code and other ways"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Phones

function PhonesPage({ s }: { s: Snapshot }) {
  const devices = s.admin?.devices ?? [];
  const [forget, setForget] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="page">
      <header className="dm-head" style={{ paddingBottom: 0 }}>
        <div>
          <h1 className="title">Phones</h1>
          <p className="dm-sub callout">The phones that can ask this PC for apps.</p>
        </div>
      </header>
      {devices.length > 0 && (
        <section className="list">
          {devices.map((d) => (
            <div key={d.id} className="lrow">
              <span className="badge">
                <Icon of={Smartphone} size="md" />
              </span>
              <div className="lrow-main">
                <div className="heading">{d.name}</div>
                <StateLine state={d.connected ? "ready" : "idle"} text={d.connected ? "Connected" : d.lastSeenAt ? `Last seen ${timeAgo(d.lastSeenAt)}` : "Paired"} />
              </div>
              <button className="btn btn-quiet btn-sm" onClick={() => setForget({ id: d.id, name: d.name })}>
                Forget
              </button>
            </div>
          ))}
        </section>
      )}
      {error && <p className="label problem-text">{error}</p>}
      <section>
        <h2 className="heading">{devices.length ? "Connect another phone" : "Connect your phone"}</h2>
        <PairingPanel s={s} />
      </section>
      {forget && (
        <Dialog
          title="Forget this phone?"
          onClose={() => setForget(null)}
          actions={
            <>
              <button className="btn btn-quiet" onClick={() => setForget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-problem"
                onClick={async () => {
                  setError(null);
                  try {
                    await api.removeDevice(forget.id);
                  } catch (e) {
                    setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
                  }
                  setForget(null);
                }}
              >
                Forget phone
              </button>
            </>
          }
        >
          <p className="callout body">{forget.name} will stop reaching this PC straight away. You can connect it again any time with a new code.</p>
        </Dialog>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Setup checklist

interface SetupRow {
  key: string;
  icon: LucideIcon;
  title: string;
  state: UiState;
  sub: string;
  needsYou: boolean;
  blocks?: boolean; // apps cannot be made without it
  problemText?: string;
  step?: StepId;
  button?: string;
}

function lineFor(state: CheckState): UiState {
  return state === "done" ? "ready" : state === "working" || state === "checking" ? "working" : state === "skipped" ? "idle" : "problem";
}

function setupRows(s: Snapshot): SetupRow[] {
  const c = s.checks;
  return [
    {
      key: "claude",
      icon: KeyRound,
      title: "Claude, the AI",
      state: lineFor(c.claude.state),
      sub: c.claude.state === "done" ? `Signed in${c.claude.plan ? `, Claude ${c.claude.plan}` : ""}` : c.claude.state === "checking" ? "Checking" : "Not signed in",
      needsYou: c.claude.state === "needed" || c.claude.state === "problem",
      blocks: true,
      problemText: "Claude is not signed in, so no app can be made right now.",
      step: "claude",
      button: "Sign in",
    },
    {
      key: "tools",
      icon: Wrench,
      title: "Tools for building apps",
      state: lineFor(c.tools.state),
      sub: c.tools.state === "done" ? "Ready" : c.tools.install?.running ? `${c.tools.install.label}, ${Math.round(c.tools.install.progress * 100)}%` : c.tools.state === "checking" ? "Checking" : "A one-time download is needed",
      needsYou: c.tools.state === "needed",
      blocks: true,
      problemText: "The tools for building apps are missing, so apps can't be built yet.",
      step: "tools",
      button: "Get them",
    },
    {
      key: "github",
      icon: Cloud,
      title: "A safe copy of your apps",
      state: lineFor(c.github.state),
      sub: c.github.state === "done" ? c.github.summary : c.github.state === "skipped" ? "Skipped, your apps stay on this PC" : "Not set up",
      needsYou: false,
      step: "github",
      button: "Set up",
    },
    {
      key: "phone",
      icon: Smartphone,
      title: "Your phone",
      state: c.phone.state === "done" ? "ready" : "idle",
      sub: c.phone.summary,
      needsYou: c.phone.state === "needed",
      step: "phone-get",
      button: "Connect",
    },
  ];
}

function SetupPage({ s, openSetup }: { s: Snapshot; openSetup: (step: StepId) => void }) {
  return (
    <div className="page">
      <header className="dm-head" style={{ paddingBottom: 0 }}>
        <div>
          <h1 className="title">Setup</h1>
          <p className="dm-sub callout">Everything this PC needs to make apps for your phone. It checks itself.</p>
        </div>
        <button className="btn btn-quiet" onClick={() => api.recheck()}>
          <Icon of={RefreshCw} size="button" /> Check again
        </button>
      </header>
      <section className="list">
        {setupRows(s).map((r) => (
          <div key={r.key} className="srow">
            <Icon of={r.icon} size="md" />
            <div className="srow-main">
              <span className="body">{r.title}</span>
              <StateLine state={r.state} text={r.sub} />
            </div>
            {r.state !== "ready" && r.state !== "working" && r.step && (
              <button className="btn btn-quiet btn-sm" onClick={() => openSetup(r.step!)}>
                {r.button}
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Settings

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return <button className={`switch${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange} />;
}

function SettingsPage({ s, openSetup }: { s: Snapshot; openSetup: (step: StepId) => void }) {
  const c = s.companion;
  const ecOn = !!s.admin && s.admin.easyConnect.state !== "off";
  const [apk, setApk] = useState(s.settings.phoneApkPath);
  return (
    <div className="page">
      <header className="dm-head" style={{ paddingBottom: 0 }}>
        <h1 className="title">Settings</h1>
      </header>
      <section className="list">
        <div className="srow">
          <div className="srow-main">
            <span className="body">Start with Windows</span>
            <span className="sub">AnyAppAgent starts quietly next to the clock when you turn on this PC, so your phone can always make apps.</span>
          </div>
          <Switch label="Start with Windows" on={s.settings.startWithWindows} onChange={() => api.setSetting("startWithWindows", !s.settings.startWithWindows)} />
        </div>
        <div className="srow">
          <div className="srow-main">
            <span className="body">Connect from anywhere</span>
            <span className="sub">Your phone reaches this PC even when it is not on the same Wi-Fi.</span>
          </div>
          <Switch label="Connect from anywhere" on={ecOn} disabled={!c.adminRoutes} onChange={() => api.setEasyConnect(!ecOn)} />
        </div>
        <div className="srow">
          <div className="srow-main">
            <span className="body">The setup steps</span>
            <span className="sub">Go through the steps again, for example to connect another account.</span>
          </div>
          <button className="btn btn-quiet btn-sm" onClick={() => openSetup("welcome")}>
            Show again
          </button>
        </div>
      </section>
      <details className="adv">
        <summary>Advanced</summary>
        <div className="kv">
          <span>Companion</span>
          <span className="v">
            {c.phase} ({c.mode}), port {c.port}, pid {c.pid ?? "none"}, restarts {c.restarts}, admin routes {c.adminRoutes ? "yes" : "no (fallback)"}
          </span>
          <span>Companion folder</span>
          <span className="v">{s.advanced.companionDir}</span>
          <span>State folder</span>
          <span className="v">{s.advanced.stateDir}</span>
          <span>Apps folder</span>
          <span className="v">{s.advanced.appsDir}</span>
          <span>Tools folder</span>
          <span className="v">{s.advanced.toolsDir}</span>
          <span>JAVA_HOME</span>
          <span className="v">{s.checks.tools.env?.JAVA_HOME ?? "none"}</span>
          <span>ANDROID_HOME</span>
          <span className="v">{s.checks.tools.env?.ANDROID_HOME ?? "none"}</span>
        </div>
        <form
          className="row"
          style={{ marginTop: "var(--aa-space-md)" }}
          onSubmit={(e) => {
            e.preventDefault();
            void api.setSetting("phoneApkPath", apk.trim());
          }}
        >
          <input className="field" style={{ flex: 1 }} value={apk} placeholder="Phone app file (found by itself when empty)" onChange={(e) => setApk(e.target.value)} />
          <button className="btn btn-quiet btn-sm" type="submit" disabled={apk.trim() === s.settings.phoneApkPath}>
            Save
          </button>
        </form>
        <div className="row wrap" style={{ marginTop: "var(--aa-space-md)" }}>
          <button className="btn btn-quiet btn-sm" onClick={() => api.restartCompanion()}>
            Restart the companion
          </button>
          {(["apps", "state", "tools"] as const).map((w) => (
            <button key={w} className="btn btn-quiet btn-sm" onClick={() => api.openFolder(w)}>
              <Icon of={FolderOpen} size="sm" /> {w[0].toUpperCase() + w.slice(1)} folder
            </button>
          ))}
        </div>
        <div className="logbox">{s.advanced.logTail.slice(-40).join("\n")}</div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ dialog (COMPONENTS.md 4)

export function Dialog({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
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

export { TypedCode };
