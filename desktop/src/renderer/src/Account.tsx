// The Account page (docs/CLOUD.md section 3, "One account, two places", cloud milestone 7): the
// PC link. Making apps on this PC needs no account; linking it lets the PC share apps, publish
// web apps and move apps to the cloud for its owner. Signed in once, on either side: the phone
// links its PC (or is asked to here), or this PC signs in in the browser and its phone can then
// use the same account. Notices and cards keep their buttons below the text, aligned right.
import { useState } from "react";
import { Globe, Link2, Smartphone, UserRound } from "lucide-react";
import type { AccountLinkInfo } from "../../../../shared/protocol.ts";
import type { Snapshot } from "../../shared/types.ts";
import { Icon, Spinner } from "./ui.tsx";

const api = window.anyapp;

type Note = { text: string; problem?: boolean } | null;

function since(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : ` on ${d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`;
}

function who(a: AccountLinkInfo): string {
  return a.account?.email ?? a.account?.name ?? (a.account?.test ? "A test account (dev)" : "Your Kiwimake account");
}

export function AccountPage({ s }: { s: Snapshot }) {
  const a = s.admin?.account;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const run = async (what: string, fn: () => Promise<{ ok: true; phones?: number } | { ok: false; error: string }>, done?: (phones?: number) => Note) => {
    setBusy(what);
    setNote(null);
    try {
      const r = await fn();
      if (!r.ok) setNote({ text: r.error, problem: true });
      else if (done) setNote(done(r.phones));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page" data-testid="account-page">
      <header className="dm-head">
        <h1 className="title">Account</h1>
      </header>
      <p className="callout secondary">
        Making apps on this PC needs no account. Link it to your Kiwimake account to share apps with your family, put web apps online and move apps to the cloud.
      </p>
      {!a ? (
        <section className="list">
          <div className="srow">
            <div className="srow-main">
              <span className="body">Not available yet</span>
              <span className="sub">Linking needs a newer Kiwimake companion. Restart Kiwimake after it updates.</span>
            </div>
          </div>
        </section>
      ) : a.state === "linked" ? (
        <section className="list" data-testid="account-linked">
          <div className="srow">
            <Icon of={UserRound} size="sm" />
            <div className="srow-main">
              <span className="body">{who(a)}</span>
              <span className="sub">
                {a.linkedFrom === "phone" ? `Linked from ${a.linkedFromName ?? "your phone"}${since(a.linkedAt)}.` : `Signed in in the browser${since(a.linkedAt)}.`}
                {a.canHandOff ? " Your phone can use this account too: on the phone, Settings, Account, Use my PC's account." : ""}
              </span>
            </div>
            <div className="notice-actions">
              <button className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => run("unlink", api.accountUnlink, () => ({ text: "This PC is not linked any more. Your apps stay on it, as they are." }))}>
                {busy === "unlink" ? <Spinner /> : null}
                Unlink this PC
              </button>
            </div>
          </div>
        </section>
      ) : a.state === "signingIn" && a.signIn ? (
        <section className="list" data-testid="account-signing-in">
          <div className="srow">
            <Icon of={Globe} size="sm" />
            <div className="srow-main">
              <span className="body">Finish signing in in your browser</span>
              <span className="sub">Check that the page shows the same code, then sign in there. This page updates by itself.</span>
              <div className="code-plate" style={{ marginTop: "var(--aa-space-sm)" }}>
                <span className="code" data-testid="account-code">
                  {a.signIn.code}
                </span>
              </div>
            </div>
            <div className="notice-actions">
              <button className="btn btn-text btn-sm" disabled={busy !== null} onClick={() => run("cancel", api.accountCancel)}>
                Cancel
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => void api.accountOpenPage()}>
                Open the page again
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="list" data-testid="account-none">
          <div className="srow">
            <Icon of={Smartphone} size="sm" />
            <div className="srow-main">
              <span className="body">Link from my phone</span>
              <span className="sub">If Kiwimake on your phone is signed in, it links this PC with one tap. No sign-in here.</span>
            </div>
            <div className="notice-actions">
              <button
                className="btn btn-quiet btn-sm"
                disabled={busy !== null || s.admin?.devices.every((d) => !d.connected)}
                onClick={() =>
                  run("ask", api.accountAskPhone, (phones) =>
                    phones ? { text: `Asked your phone. Tap Link on it.` } : { text: "No phone is connected right now. Open Kiwimake on your phone, then try again.", problem: true },
                  )
                }
              >
                {busy === "ask" ? <Spinner /> : null}
                Ask my phone
              </button>
            </div>
          </div>
          <div className="srow">
            <Icon of={Link2} size="sm" />
            <div className="srow-main">
              <span className="body">Sign in in the browser</span>
              <span className="sub">Opens a Kiwimake page in your browser: sign in there with Google or a code by email. Your phone can then use the same account.</span>
            </div>
            <div className="notice-actions">
              <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => run("sign-in", api.accountSignIn)} data-testid="account-sign-in">
                {busy === "sign-in" ? <Spinner /> : null}
                Sign in in the browser
              </button>
            </div>
          </div>
        </section>
      )}
      {a?.error ? <p className="callout problem-text">{a.error}</p> : null}
      {note ? <p className={`callout${note.problem ? " problem-text" : " secondary"}`}>{note.text}</p> : null}
    </div>
  );
}
