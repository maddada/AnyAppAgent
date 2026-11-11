// The main window after onboarding: sidebar (Apps, Phones, Setup, Settings). The Apps page is
// split: the list of apps on the left, and on the right either the open app's chat (Chat.tsx, the
// same chat as on the phone) or today's activity with the phone panels. New app works from here
// too, with the same fields and words as the phone's New app sheet.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, CircleAlert, Cloud, FolderOpen, KeyRound, LayoutGrid, ListChecks, Plus, RefreshCw, Settings as Gear, Smartphone, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppPreset, CheckState, Snapshot } from "../../shared/types.ts";
import { DEFAULT_PRESET, PRESET_CHOICES } from "../../../../shared/presets.ts";
import { size as sizeTokens } from "../../../../shared/theme/tokens.ts";
import { ChatView } from "./Chat.tsx";
import type { StepId } from "./Onboarding.tsx";
import { PairingPanel, TypedCode, useFreshCode } from "./Pairing.tsx";
import { GetPhoneApp } from "./PhoneApp.tsx";
import { AppIcon, Icon, QrPlate, Spinner, StateLine, appState, timeAgo, Wordmark, type UiState } from "./ui.tsx";

const api = window.anyapp;
type Page = "apps" | "phones" | "setup" | "settings";

export function MainWindow({ s, openSetup, connectRequest }: { s: Snapshot; openSetup: (step: StepId) => void; connectRequest: number }) {
  const [page, setPage] = useState<Page>("apps");
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [connect, setConnect] = useState(false);
  const [newApp, setNewApp] = useState(false);
  useEffect(() => {
    if (connectRequest > 0) setConnect(true);
  }, [connectRequest]);
  useEffect(() => {
    (window as unknown as { __main: unknown }).__main = {
      page: (p: Page) => {
        setOpenApp(null);
        setPage(p);
      },
      openApp: (id: string | null) => {
        setPage("apps");
        setOpenApp(id);
      },
      connect: (v: boolean) => setConnect(v),
      newApp: (v: boolean) => setNewApp(v),
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
              className={`nav-i${page === id ? " is-active" : ""}`}
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
        {page === "apps" ? (
          <AppsPage s={s} open={app?.id ?? null} onOpen={setOpenApp} onNewApp={() => setNewApp(true)} onConnect={() => setConnect(true)} openSetup={openSetup} goSetup={() => setPage("setup")} />
        ) : (
          <div className="dm-scroll">
            {page === "phones" && <PhonesPage s={s} />}
            {page === "setup" && <SetupPage s={s} openSetup={openSetup} />}
            {page === "settings" && <SettingsPage s={s} openSetup={openSetup} />}
          </div>
        )}
      </main>
      {newApp && (
        <NewAppDialog
          onClose={() => setNewApp(false)}
          onMade={(id) => {
            setNewApp(false);
            setPage("apps");
            setOpenApp(id);
          }}
        />
      )}
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

function AppsPage({
  s,
  open,
  onOpen,
  onNewApp,
  onConnect,
  openSetup,
  goSetup,
}: {
  s: Snapshot;
  open: string | null;
  onOpen: (id: string | null) => void;
  onNewApp: () => void;
  onConnect: () => void;
  openSetup: (step: StepId) => void;
  goSetup: () => void;
}) {
  const apps = useMemo(() => [...s.apps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [s.apps]);
  const blocking = setupRows(s).find((r) => r.needsYou && r.blocks);
  const app = apps.find((a) => a.id === open);
  const online = s.companion.phase === "running";
  // A helper's chat is open beside the main chat: in a narrow window the app list folds to icons.
  const [helperOpen, setHelperOpen] = useState(false);
  return (
    <div className={`apps-split${helperOpen ? " helper-open" : ""}`}>
      <section className="apps-pane" aria-label="Your apps">
        <header className="apps-pane-head">
          <h1 className="title-small">Your apps</h1>
          <button className="btn btn-primary btn-sm" onClick={onNewApp} disabled={!online} data-testid="new-app">
            <Icon of={Plus} size="sm" /> New app
          </button>
        </header>
        {blocking && (
          <div className="card notice apps-notice">
            <div className="grow">
              <StateLine state="problem" text={blocking.problemText ?? blocking.sub} />
            </div>
            <button className="btn btn-quiet btn-sm" onClick={() => (blocking.step ? openSetup(blocking.step) : goSetup())}>
              Fix it
            </button>
          </div>
        )}
        {apps.length === 0 ? (
          <div className="apps-empty">
            <strong className="heading">No apps yet</strong>
            <p className="callout secondary">Describe your first app here or in AnyAppAgent on your phone. This PC makes it, and it appears on your phone, ready to open.</p>
            <button className="btn btn-primary btn-sm" onClick={onNewApp} disabled={!online}>
              <Icon of={Plus} size="sm" /> New app
            </button>
          </div>
        ) : (
          <div className="apps-list">
            {apps.map((a) => {
              const st = appState(a);
              const v = a.latestApk ?? a.latestBuild;
              return (
                <button key={a.id} className={`arow${a.id === open ? " is-selected" : ""}`} onClick={() => onOpen(a.id)} aria-current={a.id === open ? "page" : undefined} title={a.name}>
                  <AppIcon icon={s.icons[a.id]} small />
                  <div className="arow-main">
                    <div className="arow-top">
                      <span className="body arow-name">{a.name}</span>
                      <span className="arow-meta">{[v ? `v${v.number}` : "", timeAgo(a.updatedAt)].filter(Boolean).join(", ")}</span>
                    </div>
                    <StateLine state={st.state} text={st.text} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <section className="apps-detail">
        {app ? <ChatView app={app} icon={s.icons[app.id]} online={online} onHelperOpen={setHelperOpen} /> : <Overview s={s} hasApps={apps.length > 0} onConnect={onConnect} />}
      </section>
    </div>
  );
}

/** The right side of the Apps page when no app is open: today's activity and the phones. */
function Overview({ s, hasApps, onConnect }: { s: Snapshot; hasApps: boolean; onConnect: () => void }) {
  const recent = activity(s);
  const hasPhone = (s.admin?.devices.length ?? 0) > 0;
  return (
    <div className="dm-scroll ov">
      <header className="dm-head">
        <div>
          <h2 className="title">{hasApps ? "Pick an app to change it" : "Make your first app"}</h2>
          <p className="dm-sub callout">{hasApps ? "Its chat opens here. Ask for a change, and the new version goes to your phone." : "Tap New app and say what it should do. This PC makes it."}</p>
        </div>
        <button className="btn btn-quiet" onClick={() => api.openFolder("apps")}>
          <Icon of={FolderOpen} size="button" /> Open apps folder
        </button>
      </header>
      <div className="ov-grid">
        <div className="panel">
          <div className="eyebrow">{hasPhone ? "AnyAppAgent for another phone" : "AnyAppAgent for your phone"}</div>
          <GetPhoneApp />
        </div>
        <AddPhonePanel s={s} onMore={onConnect} />
        {hasPhone && <PhonesPanel s={s} />}
      </div>
      <section className="recent ov-recent">
        <div className="eyebrow">Today</div>
        {recent.length > 0 ? (
          recent.map((r, i) => (
            <div key={i} className="recent-row">
              <time>{r.time}</time>
              <span>{r.text}</span>
            </div>
          ))
        ) : (
          <p className="callout tertiary">Nothing happened today yet.</p>
        )}
      </section>
    </div>
  );
}

/** New app from the PC: the same fields and words as the phone's New app sheet. */
function NewAppDialog({ onClose, onMade }: { onClose: () => void; onMade: (appId: string) => void }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [preset, setPreset] = useState<AppPreset>(DEFAULT_PRESET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0 && prompt.trim().length > 0;
  const chosen = PRESET_CHOICES.find((p) => p.id === preset);
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const r = await api.createApp(name.trim(), prompt.trim(), preset);
    setBusy(false);
    if (!r.ok || !r.app) return setError(r.error ?? "That didn't work. Try again.");
    onMade(r.app.id);
  };
  return (
    <Dialog
      title="New app"
      onClose={onClose}
      actions={
        <button className="btn btn-primary btn-block" disabled={!ready || busy} onClick={() => void submit()} data-testid="new-app-submit">
          {busy && <Spinner />} Make it
        </button>
      }
    >
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="fld">
          <span className="label">Name</span>
          <input className="field" data-testid="new-app-name" value={name} maxLength={40} placeholder="For example, Prayer Times" autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="fld">
          <span className="label">What should it do?</span>
          <textarea
            className="field field-multi"
            data-testid="new-app-prompt"
            value={prompt}
            rows={4}
            placeholder="Wake me up for each prayer in Ajman, with a reminder before it."
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <div className="advanced">
          <button type="button" className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} data-testid="new-app-advanced">
            <span className="label">Advanced</span>
            {!advanced && preset !== DEFAULT_PRESET && <span className="caption secondary">{chosen?.title}</span>}
            <span className={advanced ? "advanced-chevron open" : "advanced-chevron"}>
              <Icon of={ChevronDown} size="sm" />
            </span>
          </button>
          {advanced && (
            <div className="preset-choices" role="radiogroup" aria-label="What to make it with">
              {PRESET_CHOICES.map((p) => (
                <label key={p.id} className={p.id === preset ? "preset-choice selected" : "preset-choice"} data-testid={`new-app-preset-${p.id}`}>
                  <input type="radio" name="preset" value={p.id} checked={p.id === preset} onChange={() => setPreset(p.id)} />
                  <span className="preset-text">
                    <span className="preset-title">
                      <span className="row-type">{p.title}</span>
                      {p.tag && <span className="caption secondary">{p.tag}</span>}
                    </span>
                    <span className="caption secondary">{p.line}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <p className="label problem-text">{error}</p>}
      </form>
    </Dialog>
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
              <span className="label">{viaWords(d.via)}</span>
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

/** How a phone reaches this PC, in the words the phone app uses too. */
function viaWords(via: string | undefined): string {
  return via === "easy-connect" ? "From anywhere" : "Same Wi-Fi only";
}

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
                <span className="label secondary">{viaWords(d.via)}</span>
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
      <section className="list">
        <div className="srow">
          <div className="srow-main">
            <span className="body">Quit AnyAppAgent</span>
            <span className="sub">Stops making apps until you open AnyAppAgent again. Closing the window does not stop it.</span>
          </div>
          <button className="btn btn-quiet btn-sm" onClick={() => api.quit()}>
            Quit
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
