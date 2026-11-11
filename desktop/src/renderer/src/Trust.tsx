// The desktop side of docs/TRUST.md: "Never lose your apps" (the backup in Settings and the restore
// on a new PC), the usage meter (Settings and under each message), and "Keep my apps healthy" (the
// yellow sign on an app that is behind, its "Update it", and the monthly reminder).
import { useState } from "react";
import { CloudUpload, FolderOpen, Gauge, RotateCcw, TriangleAlert } from "lucide-react";
import type { App, AppUsage, CareState, ChatItem, UsageState } from "../../../../shared/protocol.ts";
import { BEHIND_LABEL, cacheLine, formatTokens, headsUp, type HeadsUp, newTokens, PLAN_UNKNOWN, planLines, reminderText, usageLine, usageRows } from "../../../../shared/chat/index.ts";
import type { Snapshot } from "../../shared/types.ts";
import { Icon } from "./ui.tsx";

const api = window.anyapp;

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return sameDay ? `today at ${time}` : `${d.toLocaleDateString(undefined, { day: "numeric", month: "long" })} at ${time}`;
}

// ------------------------------------------------------------------ keep my apps healthy

/** The yellow sign on an app's icon while it is behind the newest template. */
export function HealthBadge({ app }: { app: App }) {
  if (!app.health?.behind) return null;
  return (
    <span className="health-badge" title={BEHIND_LABEL} aria-label={BEHIND_LABEL} data-testid={`behind-${app.slug}`}>
      !
    </span>
  );
}

/** Above an app's chat while it is behind: what is behind, and "Update it" (after a heads-up). */
export function HealthNotice({ app, care, online }: { app: App; care: CareState | null; online: boolean }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!app.health?.behind) return null;
  const h = headsUp({ text: "", keepHealthy: true, usage: care?.usage, appUsage: app.usage })!;
  const go = async () => {
    setBusy(true);
    setError(null);
    const r = await api.keepHealthy(app.id);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That didn't send. Try again.");
    setAsking(false);
  };
  return (
    <div className="health-notice" data-testid="health-notice">
      <span className="health-badge big" aria-hidden>
        !
      </span>
      <div className="grow">
        <div className="body">{app.name} is behind the newest template</div>
        {app.health.reasons.map((r) => (
          <div key={r} className="label secondary">
            {r}
          </div>
        ))}
        {asking && <p className="label heads-up-body">{h.body}</p>}
        {error && <div className="label problem-text">{error}</div>}
      </div>
      {asking ? (
        <div className="row">
          <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setAsking(false)}>
            Not now
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy || !online} onClick={() => void go()} data-testid="keep-healthy-send">
            {busy ? "Sending..." : h.send}
          </button>
        </div>
      ) : (
        <button className="btn btn-primary btn-sm" disabled={!online || app.status === "creating"} onClick={() => setAsking(true)} data-testid="keep-healthy">
          Update it
        </button>
      )}
    </div>
  );
}

/** The monthly reminder, at the top of the app list. */
export function ReminderCard({ care }: { care: CareState | null }) {
  const words = reminderText(care?.health);
  if (!words) return null;
  return (
    <div className="card notice apps-notice reminder" data-testid="health-reminder">
      <span className="health-badge" aria-hidden>
        !
      </span>
      <div className="grow">
        <div className="body">{words.title}</div>
        <div className="label secondary">{words.body}</div>
      </div>
      <button className="btn btn-quiet btn-sm" onClick={() => void api.dismissReminder()}>
        Got it
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ the usage meter

/** Under a message from the person: what its work used. */
export function UsageNote({ item }: { item: ChatItem }) {
  const line = usageLine(item.usage);
  if (!line) return null;
  return (
    <div className="usage-note caption" title={cacheLine(item.usage) ?? undefined} data-testid="usage-note">
      <Icon of={Gauge} size="sm" /> {line}
    </div>
  );
}

/** The heads-up before a big job, above the composer. */
export function HeadsUpCard({ h, onSend, onCancel, busy }: { h: HeadsUp; onSend: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <div className="heads-up card" role="alertdialog" aria-label={h.title} data-testid="heads-up">
      <Icon of={TriangleAlert} size="sm" />
      <div className="grow">
        <div className="body">{h.title}</div>
        <div className="label secondary">{h.body}</div>
      </div>
      <div className="row">
        <button className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
          Not now
        </button>
        <button className="btn btn-primary btn-sm" onClick={onSend} disabled={busy} data-testid="heads-up-send">
          {h.send}
        </button>
      </div>
    </div>
  );
}

export function bigJob(text: string, app: App, usage: UsageState | undefined): HeadsUp | null {
  return headsUp({ text, usage, appUsage: app.usage });
}

function monthName(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "long" });
}

/** Settings: the plan's limits as Claude reported them, and this month's use per app. */
export function UsageGroup({ s }: { s: Snapshot }) {
  const care = s.care;
  if (!care) return null;
  const lines = planLines(care.usage);
  const rows = usageRows(s.apps);
  const month = newTokens(care.usage.month);
  return (
    <section className="settings-group" data-testid="usage-group">
      <h2 className="heading">Claude plan use</h2>
      <p className="callout secondary">What your apps' agents used, as Claude reports it. Each change shows its own use under your message in the chat.</p>
      <div className="list">
        {lines.length > 0 ? (
          lines.map((l) => (
            <div key={l.text} className="srow">
              <div className="srow-main">
                <span className={`body${l.kind === "out" ? " problem-text" : ""}`}>{l.text}</span>
                {l.percent !== undefined && (
                  <span className={`meter${l.kind !== "ok" ? " near" : ""}`} aria-hidden>
                    <span style={{ width: `${l.percent}%` }} />
                  </span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="srow">
            <div className="srow-main">
              <span className="sub">{PLAN_UNKNOWN}</span>
            </div>
          </div>
        )}
        <div className="srow">
          <div className="srow-main">
            <span className="body">
              {monthName(care.usage.monthKey)}: {formatTokens(month)} tokens
            </span>
            <span className="sub">All your apps together this month. Re-reading the chat from Claude's memory is not counted here: it counts for much less.</span>
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.appId} className="srow usage-row">
            <div className="srow-main">
              <div className="usage-top">
                <span className="body">{r.name}</span>
                <span className="mono label">{formatTokens(r.tokens)}</span>
              </div>
              <span className="bar" aria-hidden>
                <span style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }} />
              </span>
              <span className="sub">
                {r.changes} {r.changes === 1 ? "change" : "changes"}
                {r.perChange ? `, about ${formatTokens(r.perChange)} tokens each` : ""}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function appUsageText(u: AppUsage | undefined): string | null {
  if (!u) return null;
  return `${formatTokens(newTokens(u.month))} tokens this month`;
}

// ------------------------------------------------------------------ never lose your apps

type Note = { text: string; problem?: boolean } | null;

/** Settings: one switch backs up keys, code and chats to a folder; Restore on a new PC. */
export function BackupGroup({ s }: { s: Snapshot }) {
  const b = s.admin?.backup;
  const [mode, setMode] = useState<"on" | "restore" | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  if (!b) return null;
  const close = () => {
    setMode(null);
    setPw("");
    setPw2("");
  };
  const tooShort = pw.length < 8;
  const mismatch = mode === "on" && pw2 !== pw;
  const go = async () => {
    if (!mode || tooShort || mismatch) return;
    setBusy(true);
    setNote(null);
    try {
      const r = mode === "on" ? await api.backupOn(pw) : await api.backupRestore(pw);
      if ("cancelled" in r) return;
      if (!r.ok) return setNote({ text: r.error, problem: true });
      close();
      if (r.restored) {
        const back = r.restored.apps.filter((a) => a.outcome === "restored");
        const failed = r.restored.apps.filter((a) => a.outcome === "failed");
        const parts = [back.length ? `Brought back ${back.length} ${back.length === 1 ? "app" : "apps"}: ${back.map((a) => a.name).join(", ")}.` : "Every app in that backup is already here."];
        if (r.restored.rebuilding) parts.push("Each is building once now; your phone then updates it in place, keeping its data.");
        for (const f of failed) parts.push(`${f.name} could not be brought back (${f.reason}).`);
        for (const c of r.restored.keys?.conflicts ?? []) parts.push(`Kept this PC's own key for ${c.id}.`);
        setNote({ text: parts.join(" "), problem: failed.length > 0 });
      } else {
        setNote({ text: "Backups are on. Keep the password somewhere safe: without it nobody can open the backup, not even this PC." });
      }
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setNote(null);
    const r = await api.backupRun();
    setBusy(false);
    if ("ok" in r && !r.ok) setNote({ text: r.error, problem: true });
  };
  const last = day(b.lastBackupAt);
  return (
    <section className="settings-group" data-testid="backup-group">
      <h2 className="heading">Never lose your apps</h2>
      <p className="callout secondary">
        Keeps a locked copy of what cannot be made again: each app's signing key (without it, phones refuse its updates), its code with every version, and its chat. Pick a OneDrive or USB folder, so the copy is not only on this PC.
      </p>
      <div className="list">
        <div className="srow">
          <Icon of={CloudUpload} size="sm" />
          <div className="srow-main">
            <span className="body">Back up my apps</span>
            {b.enabled ? (
              <>
                <span className="sub">
                  {b.running ? "Backing up now..." : last ? `Last backup ${last}: ${b.apps} ${b.apps === 1 ? "app" : "apps"} and ${b.keys} ${b.keys === 1 ? "key" : "keys"}.` : "Not backed up yet."} It backs up by itself after every new version and once a day.
                </span>
                {b.folder && <span className="sub mono">{b.folder}</span>}
                {b.onGithub > 0 && <span className="sub">{b.onGithub === 1 ? "One app's code is" : `${b.onGithub} apps' code is`} also in its private GitHub repo.</span>}
                {b.lastError && <span className="sub problem-text">{b.lastError}</span>}
              </>
            ) : (
              <span className="sub">Off. Your apps' keys are only on this PC.</span>
            )}
          </div>
          {b.enabled && (
            <button className="btn btn-quiet btn-sm" disabled={busy || b.running} onClick={() => void run()} data-testid="backup-now">
              Back up now
            </button>
          )}
          <button
            type="button"
            className={`switch${b.enabled ? " on" : ""}`}
            role="switch"
            aria-checked={b.enabled}
            aria-label="Back up my apps"
            disabled={busy}
            data-testid="backup-switch"
            onClick={() => {
              setNote(null);
              if (b.enabled) void api.backupOff();
              else setMode(mode === "on" ? null : "on");
            }}
          />
        </div>
        <div className="srow">
          <Icon of={RotateCcw} size="sm" />
          <div className="srow-main">
            <span className="body">Restore on a new PC</span>
            <span className="sub">Brings back every app from a backup folder, with its key, so your phone keeps updating the apps it already has.</span>
          </div>
          <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => (setNote(null), setMode(mode === "restore" ? null : "restore"))} data-testid="backup-restore">
            Restore
          </button>
        </div>
        {mode && (
          <form
            className="srow"
            onSubmit={(e) => {
              e.preventDefault();
              void go();
            }}
          >
            <div className="srow-main">
              <span className="sub">
                {mode === "on"
                  ? "Choose a password for the backup (at least 8 characters). It is never saved: this PC backs up without it, but only the password opens a backup."
                  : "The password you chose when you turned backups on. Apps and keys this PC already has are kept as they are."}
              </span>
              <div className="row wrap">
                <input className="field field-small" type="password" autoFocus autoComplete="new-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="backup-password" />
                {mode === "on" && <input className="field field-small" type="password" autoComplete="new-password" placeholder="Same password again" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="backup-password2" />}
              </div>
              {mode === "on" && pw2.length > 0 && mismatch && <span className="sub problem-text">The two passwords are not the same.</span>}
            </div>
            <div className="row">
              <button className="btn btn-quiet btn-sm" type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" type="submit" disabled={busy || tooShort || mismatch} data-testid="backup-go">
                <Icon of={FolderOpen} size="sm" /> {busy ? "Working..." : mode === "on" ? "Choose the folder" : "Choose the backup folder"}
              </button>
            </div>
          </form>
        )}
        {note && (
          <div className="srow">
            <div className="srow-main">
              <span className={`sub${note.problem ? " problem-text" : ""}`} data-testid="backup-note">
                {note.text}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
