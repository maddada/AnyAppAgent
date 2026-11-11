// Onboarding (COMPONENTS.md 6): step rail on the left, one idea per screen on the right, footer
// with Back and Skip or Continue. Every step checks itself and fixes itself where it can.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Check, ChevronLeft, Cloud, Copy, Download, ExternalLink, KeyRound, Monitor, QrCode, Smartphone, Wrench, X } from "lucide-react";
import type { Snapshot } from "../../shared/types.ts";
import { PairingDialog } from "./Pairing.tsx";
import { Icon, Spinner, Wordmark } from "./ui.tsx";
import { GetPhoneAppDialog } from "./PhoneApp.tsx";

const api = window.anyapp;

export type StepId = "welcome" | "claude" | "tools" | "github" | "phone-get" | "phone-pair" | "done";
const RAIL: { id: StepId; label: string; optional?: boolean }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "claude", label: "Claude, the AI" },
  { id: "tools", label: "Tools for building apps" },
  { id: "github", label: "A safe copy of your apps", optional: true },
  { id: "phone-get", label: "The app on your phone" },
  { id: "phone-pair", label: "Connect your phone" },
];
const ORDER: StepId[] = [...RAIL.map((r) => r.id), "done"];

function isDone(id: StepId, s: Snapshot): boolean {
  const c = s.checks;
  if (id === "claude") return c.claude.state === "done";
  if (id === "tools") return c.tools.state === "done";
  if (id === "github") return c.github.state === "done" || c.github.state === "skipped";
  if (id === "phone-get" || id === "phone-pair") return c.phone.state === "done";
  return false;
}

export function Onboarding({ snapshot: s, start, onFinish, onClose }: { snapshot: Snapshot; start?: StepId; onFinish: () => void; onClose?: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, ORDER.indexOf(start ?? "welcome")));
  const [visited, setVisited] = useState(() => new Set<number>([0]));
  const step = ORDER[index];
  const go = (i: number) => {
    const n = Math.max(0, Math.min(ORDER.length - 1, i));
    setIndex(n);
    setVisited((v) => new Set(v).add(n));
  };
  const next = () => go(index + 1);
  useEffect(() => {
    (window as unknown as { __onb: unknown }).__onb = { goto: (id: StepId) => go(ORDER.indexOf(id)) };
  });

  return (
    <div className="onb">
      <aside className="onb-rail">
        <Wordmark />
        <ol className="steps">
          {RAIL.map((r, i) => {
            const done = i !== index && (i === 0 ? index > 0 : isDone(r.id, s));
            const cls = i === index ? "is-current" : done ? "is-done" : "is-todo";
            const canGo = i !== index && (i < index || visited.has(i) || done);
            return (
              <li key={r.id}>
                <button className={`step ${cls}${canGo ? " can-go" : ""}`} onClick={() => canGo && go(i)} aria-current={i === index ? "step" : undefined} tabIndex={canGo ? 0 : -1}>
                  <span className="step-n">{done ? <Icon of={Check} px={14} /> : i + 1}</span>
                  <span className="step-l">
                    {r.label}
                    {r.optional && <span className="eyebrow step-tag">Optional</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="caption rail-foot">You can change any of this later in Settings.</p>
        {onClose && (
          <button className="btn btn-quiet btn-sm" style={{ marginTop: "var(--aa-space-lg)", alignSelf: "flex-start" }} onClick={onClose}>
            <Icon of={X} size="sm" /> Back to my apps
          </button>
        )}
      </aside>
      <main className="onb-main">
        <div className="onb-scroll">
          <div className="onb-content" key={step}>
            {step === "welcome" && <Welcome />}
            {step === "claude" && <ClaudeStep s={s} />}
            {step === "tools" && <ToolsStep s={s} />}
            {step === "github" && <GitHubStep s={s} />}
            {step === "phone-get" && <PhoneGetStep />}
            {step === "phone-pair" && <PhonePairStep s={s} onPaired={next} />}
            {step === "done" && <DoneStep />}
          </div>
        </div>
        <footer className="onb-foot">
          {index > 0 ? (
            <button className="btn btn-quiet" onClick={() => go(index - 1)}>
              <Icon of={ChevronLeft} size="button" /> Back
            </button>
          ) : (
            <span />
          )}
          <Forward step={step} s={s} onNext={next} onFinish={onFinish} />
        </footer>
      </main>
    </div>
  );
}

function Forward({ step, s, onNext, onFinish }: { step: StepId; s: Snapshot; onNext: () => void; onFinish: () => void }) {
  const primary = (label: string, onClick: () => void) => (
    <button className="btn btn-primary" onClick={onClick}>
      {label} <Icon of={ArrowRight} size="button" />
    </button>
  );
  const quiet = (label: string, onClick: () => void) => (
    <button className="btn btn-quiet" onClick={onClick}>
      {label}
    </button>
  );
  switch (step) {
    case "welcome":
      return primary("Get started", onNext);
    case "done":
      return primary("Open AnyAppAgent", onFinish);
    case "phone-get":
      return primary("It's on my phone", onNext);
    case "github":
      if (isDone("github", s)) return primary("Continue", onNext);
      return quiet("Skip this step", async () => {
        await api.githubSkip(true);
        onNext();
      });
    case "phone-pair":
      return isDone(step, s) ? primary("Continue", onNext) : quiet("Skip, I'll connect later", onNext);
    default:
      return isDone(step, s) ? primary("Continue", onNext) : quiet("Do this later", onNext);
  }
}

// ------------------------------------------------------------------ building blocks

function Head({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: ReactNode }) {
  return (
    <>
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="hero">{title}</h1>
      <p className="lede">{lede}</p>
    </>
  );
}

function How({ items, flush }: { items: [string, string][]; flush?: boolean }) {
  return (
    <ol className="how" style={flush ? { marginTop: 0 } : undefined}>
      {items.map(([title, line], i) => (
        <li key={i}>
          <span className="how-n mono">{i + 1}</span>
          <div>
            <strong className="body">{title}</strong>
            <span className="callout">{line}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

type CardState = "todo" | "working" | "ready" | "problem";

function CheckCard({ state, icon, title, status, action }: { state: CardState; icon: LucideIcon; title: string; status: ReactNode; action?: ReactNode }) {
  return (
    <div className="card check-card" role="status">
      <span className={`badge ${state === "ready" ? "ready" : state === "problem" ? "problem" : ""}`}>
        {state === "ready" ? <Icon of={Check} size="md" /> : state === "working" ? <Spinner /> : <Icon of={icon} size="md" />}
      </span>
      <div className="check-text">
        <strong>{title}</strong>
        <span className={state === "problem" ? "problem-text" : undefined}>{status}</span>
      </div>
      {action}
    </div>
  );
}

const stepOf = (id: StepId) => `Step ${ORDER.indexOf(id) + 1} of ${RAIL.length}`;

// ------------------------------------------------------------------ steps

function Welcome() {
  const loop: [LucideIcon, string, string][] = [
    [Smartphone, "You describe it", "On your phone or on this PC, in your own words."],
    [Monitor, "This PC makes it", "Claude writes the app and this PC builds it."],
    [Download, "It appears on your phone", "Ready to open. Ask for changes any time."],
  ];
  return (
    <>
      <div className="eyebrow">Welcome</div>
      <h1 className="hero">Make your own Android apps by describing them</h1>
      <p className="lede">AnyAppAgent turns your ideas into real apps. You tell it what you want, on your phone or right here, and this PC does the rest.</p>
      <div className="loop">
        {loop.map(([of, title, line], i) => (
          <Fragment key={title}>
            <div className="card loop-step">
              <span className="badge">
                <Icon of={of} size="md" />
              </span>
              <strong className="body">{title}</strong>
              <span className="label">{line}</span>
            </div>
            {i < loop.length - 1 && (
              <span className="loop-arrow">
                <Icon of={ArrowRight} size="sm" />
              </span>
            )}
          </Fragment>
        ))}
      </div>
      <p className="label secondary" style={{ marginTop: "var(--aa-space-2xl)" }}>
        Setting up takes about five minutes. Nothing here needs technical knowledge.
      </p>
    </>
  );
}

function ClaudeStep({ s }: { s: Snapshot }) {
  const c = s.checks.claude;
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const state: CardState = c.state === "done" ? "ready" : c.signingIn || c.state === "checking" ? "working" : c.state === "problem" ? "problem" : "todo";
  const status =
    c.state === "done"
      ? `${c.summary}${c.plan ? `, Claude ${c.plan}` : ""}`
      : c.signingIn
        ? "Finish signing in on the page that opened in your browser. This moves on by itself."
        : c.state === "checking"
          ? "Checking…"
          : (c.error ?? c.summary);
  return (
    <>
      <Head
        eyebrow={stepOf("claude")}
        title="Claude writes your apps"
        lede="Claude is an AI from Anthropic. AnyAppAgent asks it to write each app for you. It needs a paid Claude plan (Pro or Max), signed in once on this PC."
      />
      <How
        items={[
          ["Sign in with your Claude account", "A page opens in your browser. Nothing to type here."],
          ["You need Claude Pro or Max", "The free plan cannot write apps for you."],
          ["It stays signed in", "You only do this once on this PC."],
        ]}
      />
      <CheckCard
        state={state}
        icon={KeyRound}
        title="Claude"
        status={status}
        action={
          c.state !== "done" && !c.signingIn && c.state !== "checking" ? (
            <button className="btn btn-primary" onClick={() => api.claudeSignIn()}>
              Sign in to Claude <Icon of={ExternalLink} size="sm" />
            </button>
          ) : c.signingIn ? (
            <button className="btn btn-quiet btn-sm" onClick={() => api.claudeCancel()}>
              Cancel
            </button>
          ) : undefined
        }
      />
      <div className="under-card">
        {c.signingIn && (
          <div className="row wrap" style={{ gap: "var(--aa-space-lg)" }}>
            {c.loginUrl && (
              <button className="btn btn-text label" onClick={() => api.openExternal(c.loginUrl!)}>
                Open the sign-in page again
              </button>
            )}
            <button className="btn btn-text label" onClick={() => setShowCode(!showCode)}>
              The page shows a code?
            </button>
          </div>
        )}
        {c.signingIn && showCode && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void api.claudeSubmitCode(code.trim());
              setCode("");
            }}
          >
            <input className="field" style={{ flex: 1 }} placeholder="Paste the code from the page" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            <button className="btn btn-quiet" type="submit">
              Use this code
            </button>
          </form>
        )}
        {c.state !== "done" && !c.signingIn && (
          <button className="btn btn-text label" onClick={() => api.openExternal("https://claude.com/pricing")}>
            No Claude plan yet? See the plans
          </button>
        )}
      </div>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span>{k}</span>
      <span className="v">{v}</span>
    </>
  );
}

function ToolsStep({ s }: { s: Snapshot }) {
  const t = s.checks.tools;
  const install = t.install;
  const pct = Math.round((install?.progress ?? 0) * 100);
  const state: CardState = t.state === "done" ? "ready" : install?.running || t.state === "checking" ? "working" : install?.error ? "problem" : "todo";
  const status =
    t.state === "done"
      ? `${t.summary} ${t.pieces.map((p) => p.label).join(", ")}.`
      : install?.running
        ? `${install.label}…`
        : install?.error
          ? install.error
          : t.state === "checking"
            ? "Looking for them on this PC…"
            : `Still needed: ${t.pieces
                .filter((p) => !p.ok)
                .map((p) => p.label)
                .join(", ")}.`;
  return (
    <>
      <Head
        eyebrow={stepOf("tools")}
        title="Tools for building apps"
        lede="Turning code into an Android app needs a few free tools from Google, Microsoft and others. AnyAppAgent gets them and sets them up for you, in its own folder."
      />
      <How
        items={[
          ["One download, about 2.5 GB", "It takes a few minutes on a good connection."],
          ["Nothing else on your PC changes", "Tools you already have are used as they are."],
          ["Licences accepted for you", "AnyAppAgent accepts the Android SDK licence on your behalf."],
        ]}
      />
      <CheckCard
        state={state}
        icon={Wrench}
        title="App-making tools"
        status={status}
        action={
          t.state === "needed" && !install?.running ? (
            <button className="btn btn-primary" onClick={() => api.toolsInstall()}>
              {install?.error ? "Try again" : "Get the tools"}
            </button>
          ) : install?.running ? (
            <button className="btn btn-quiet btn-sm" onClick={() => api.toolsCancel()}>
              Stop
            </button>
          ) : undefined
        }
      />
      <div className="under-card">
        {install?.running && (
          <>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="row label secondary" style={{ justifyContent: "space-between" }}>
              <span>{install.detail ?? " "}</span>
              <span className="mono">{pct}%</span>
            </div>
          </>
        )}
        <button className="btn btn-text label" onClick={() => api.openExternal("https://developer.android.com/studio/terms")}>
          Read the Android SDK licence
        </button>
        <details className="adv">
          <summary>Advanced</summary>
          <div className="kv">
            {t.pieces.map((p) => (
              <KV key={p.id} k={p.label} v={`${p.ok ? "ok" : "missing"}${p.version ? `, ${p.version}` : ""}${p.path ? `, ${p.path}` : ""}${p.missing?.length ? `, needs ${p.missing.join(" ")}` : ""}`} />
            ))}
            <KV k="Tools folder" v={s.advanced.toolsDir} />
          </div>
        </details>
      </div>
    </>
  );
}

function GitHubStep({ s }: { s: Snapshot }) {
  const g = s.checks.github;
  const flow = g.flow;
  const showCode = (flow?.phase === "code" || flow?.phase === "waiting") && !!flow.code;
  const state: CardState = g.state === "done" ? "ready" : flow || g.state === "checking" ? "working" : g.state === "problem" ? "problem" : "todo";
  const status =
    g.state === "done"
      ? `${g.summary}. Every app is backed up there by itself.`
      : g.state === "skipped"
        ? "Skipped. Your apps are kept on this PC only."
        : flow?.phase === "downloading"
          ? `Getting the GitHub helper… ${Math.round((flow.progress ?? 0) * 100)}%`
          : flow?.phase === "starting"
            ? "Getting a sign-in code from GitHub…"
            : flow?.phase === "waiting"
              ? "Waiting for you to finish on GitHub…"
              : flow?.phase === "code"
                ? "Enter this code on GitHub."
                : flow?.phase === "finishing"
                  ? "Connected. Finishing up…"
                  : (g.error ?? "Not signed in yet");
  const action = showCode ? (
    <button
      className="btn btn-primary"
      onClick={async () => {
        await api.copyText(flow!.code!);
        await api.githubOpenPage();
      }}
    >
      Open GitHub <Icon of={ExternalLink} size="sm" />
    </button>
  ) : flow ? (
    <button className="btn btn-quiet btn-sm" onClick={() => api.githubCancel()}>
      Cancel
    </button>
  ) : g.state === "needed" || g.state === "problem" ? (
    <button className="btn btn-primary" onClick={() => api.githubStart()}>
      Sign in to GitHub <Icon of={ExternalLink} size="sm" />
    </button>
  ) : g.state === "skipped" ? (
    <button className="btn btn-quiet btn-sm" onClick={() => api.githubSkip(false).then(() => api.githubStart())}>
      Set it up now
    </button>
  ) : undefined;
  return (
    <>
      <Head
        eyebrow={`${stepOf("github")}, optional`}
        title="A safe copy of your apps"
        lede="AnyAppAgent can keep a private copy of every app you make on GitHub, a free service for storing apps. If this PC ever breaks, nothing is lost."
      />
      {/* While a code shows, the list gives way so the code and its instructions stay in view. */}
      {!showCode && <How
        items={[
          ["Sign in to GitHub", "Or make a free account. It takes about a minute."],
          ["We make one private copy per app", "Only you can see them. Nothing is shared."],
          ["It stays up to date by itself", "Every change you ask for is saved there too."],
        ]}
      />}
      <CheckCard state={state} icon={Cloud} title="GitHub" status={status} action={action} />
      {showCode && (
        <div className="under-card">
          <div className="code-plate">
            <span className="code">{flow!.code}</span>
            <button className="btn btn-quiet btn-sm" onClick={() => api.copyText(flow!.code!)}>
              <Icon of={Copy} size="sm" /> Copy
            </button>
          </div>
          <p className="label secondary">Open GitHub copies the code for you. Paste it when GitHub asks, click Authorize, then come back here.</p>
        </div>
      )}
    </>
  );
}

function PhoneGetStep() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Start "connect from anywhere" now: its first start takes a few minutes, and this step covers that.
    void api.easyConnectAuto();
  }, []);
  return (
    <>
      <Head eyebrow={stepOf("phone-get")} title="Put AnyAppAgent on your phone" lede="Your phone needs the AnyAppAgent app. It downloads from AnyAppAgent's page on GitHub, not from the Play Store." />
      <div className="code-cta">
        <button className="btn btn-primary" onClick={() => setShow(true)} data-testid="show-download-code">
          <Icon of={Download} size="button" /> Show download code
        </button>
      </div>
      <How
        items={[
          ["Point your phone's camera at the code", "Tap the link it shows. The download starts."],
          ["Open the downloaded file", "It takes a moment."],
          ["Allow installing from this source", "Android asks once because it is not from the Play Store. Then tap Install."],
        ]}
      />
      {show && <GetPhoneAppDialog onClose={() => setShow(false)} />}
    </>
  );
}

function PhonePairStep({ s, onPaired }: { s: Snapshot; onPaired: () => void }) {
  const startCount = useRef(s.checks.phone.pairedCount);
  const [justPaired, setJustPaired] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (s.checks.phone.pairedCount > startCount.current && !justPaired) {
      setJustPaired(true);
      const t = setTimeout(onPaired, 2600);
      return () => clearTimeout(t);
    }
  }, [s.checks.phone.pairedCount, justPaired, onPaired]);
  const name = s.admin?.devices.at(-1)?.name;
  return (
    <>
      <Head eyebrow={stepOf("phone-pair")} title="Connect your phone" lede="Show the pairing code here, then scan it with AnyAppAgent on your phone. Your phone and this PC then stay connected." />
      {justPaired ? (
        <CheckCard state="ready" icon={Smartphone} title={name ? `${name} is connected` : "Your phone is connected"} status="Your phone and this PC can make apps together now." />
      ) : (
        <>
          {s.checks.phone.pairedCount > 0 && <CheckCard state="ready" icon={Smartphone} title={s.checks.phone.summary} status="You can connect another phone too, or carry on." />}
          <div className="code-cta">
            <button className="btn btn-primary" onClick={() => setShow(true)} data-testid="show-pairing-code">
              <Icon of={QrCode} size="button" /> Show pairing code
            </button>
            <p className="label secondary">Keep the code private: anyone who scans it can use this PC to make apps.</p>
          </div>
          {show && <PairingDialog s={s} title="Connect your phone" onClose={() => setShow(false)} />}
        </>
      )}
    </>
  );
}

function DoneStep() {
  return (
    <>
      <div className="eyebrow">All set</div>
      <h1 className="hero">Now make your first app</h1>
      <p className="lede">Everything on this PC is ready. Start an app on your phone or right here in this window.</p>
      <How
        items={[
          ["Tap New app and describe it", "In AnyAppAgent on your phone or here, in your own words, like “a shopping list I can share with my family”."],
          ["Wait a few minutes", "This PC makes it, and it appears on your phone, ready to open."],
          ["Ask for changes in its chat", "From your phone or from this PC. Each new version goes to your phone by itself."],
        ]}
      />
      <p className="label secondary" style={{ marginTop: "var(--aa-space-2xl)", maxWidth: "var(--aa-size-reading-width)" }}>
        AnyAppAgent keeps working next to the clock, even when this window is closed. Keep this PC on while it makes apps.
      </p>
    </>
  );
}
