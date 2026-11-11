// Pairing: the Easy Connect QR when the companion says it is ready (works from anywhere), otherwise
// the same-network QR with the address and 6-digit code for typing. While Easy Connect starts (a
// few minutes the first time), the same-network QR works and its progress shows underneath.
//
// The pairing QR and code are secrets (whoever scans them gets a phone onto this PC), so they only
// ever show in the pairing popup (PairingDialog), and opening that popup is the only thing that
// makes a code: nothing renews one in the background while nothing shows it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Globe, RefreshCw, Wifi } from "lucide-react";
import type { Snapshot } from "../../shared/types.ts";
import { size as sizeTokens } from "../../../../shared/theme/tokens.ts";
import { Dialog, Icon, QrPlate, Spinner } from "./ui.tsx";

const api = window.anyapp;

function EasyConnectProgress({ detail }: { detail?: string }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = (now - started) / 1000;
  // About two and a half minutes the first time: creep towards 95% by then, never claim done.
  const pct = Math.round(95 * (1 - Math.exp(-elapsed / 70)));
  return (
    <div className="card ec-progress" role="status">
      <div className="row label" style={{ justifyContent: "space-between" }}>
        <span className="row">
          <Spinner /> Getting “connect from anywhere” ready
        </span>
        <span className="tertiary">{elapsed < 150 ? "A few minutes, the first time only" : "Almost there"}</span>
      </div>
      <div className="progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      {detail && <span className="caption secondary">{detail}</span>}
    </div>
  );
}

export function TypedCode({ s }: { s: Snapshot }) {
  const p = s.pairing;
  return (
    <div className="typed">
      <span className="k">Address</span>
      <span className="v">{p.address?.replace(/^https?:\/\//, "") ?? "not found"}</span>
      <span className="k">Code</span>
      <span className="v">{p.code}</span>
    </div>
  );
}

/**
 * Makes a fresh code once when the pairing popup opens (both the Easy Connect code and the 6-digit
 * one), and once more if Easy Connect finishes starting while the popup is open. A code that is
 * used or runs out while the popup is open is not replaced by itself: the popup says so and offers
 * a new one. True once the fresh code has arrived.
 */
function useCodeWhileOpen(s: Snapshot): boolean {
  const [fresh, setFresh] = useState(false);
  const made = useRef(false);
  useEffect(() => {
    if (made.current) return; // StrictMode runs effects twice; one popup, one code
    made.current = true;
    void api
      .newPairingCode()
      .catch(() => undefined)
      .finally(() => setFresh(true));
  }, []);
  const ec = s.pairing.easyConnect;
  const needs = !!s.pairing.needsNewCode;
  const was = useRef(ec);
  useEffect(() => {
    if (fresh && was.current !== "ready" && ec === "ready" && needs) void api.newPairingCode();
    was.current = ec;
  }, [fresh, ec, needs]);
  return fresh;
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-quiet btn-sm"
      style={{ alignSelf: "flex-start" }}
      onClick={async () => {
        await api.copyText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }}
    >
      <Icon of={copied ? Check : Copy} size="sm" /> {copied ? "Copied" : "Copy the link for your phone"}
    </button>
  );
}

/** The full pairing block: big QR on the left, words on the right. Only inside PairingDialog. */
function PairingPanel({ s }: { s: Snapshot }) {
  const p = s.pairing;
  const [typeInstead, setTypeInstead] = useState(false);
  const fresh = useCodeWhileOpen(s);
  if (fresh && p.needsNewCode) {
    // The code shown here was used by a phone or ran out (5 minutes): never fall back to another.
    return (
      <div className="pair-spent">
        <p className="callout secondary">This code was used or ran out. Codes work once, for 5 minutes.</p>
        <button className="btn btn-quiet btn-sm" onClick={() => api.newPairingCode()}>
          <Icon of={RefreshCw} size="sm" /> Show a new code
        </button>
      </div>
    );
  }
  if (!fresh || p.kind === "none" || !p.qrSvg) {
    return (
      <div className="row secondary" style={{ marginTop: "var(--aa-space-3xl)" }}>
        <Spinner /> {s.companion.phase === "failed" ? s.companion.message : "Getting a connection code ready…"}
      </div>
    );
  }
  const easy = p.kind === "easy-connect";
  return (
    <>
      <div className="pair">
        {/* The Easy Connect code is about 354 characters: twice the theme QR size so phones read it. */}
        <QrPlate svg={p.qrSvg} size={easy ? sizeTokens.qr * 2 : sizeTokens.qr * 1.5} label="Code to connect your phone" />
        <div className="pair-side">
          <p className="heading">In AnyAppAgent on your phone, tap Scan code and point it here.</p>
          {easy ? (
            <>
              <p className="row callout secondary" style={{ alignItems: "flex-start" }}>
                <Icon of={Globe} size="sm" /> Works from anywhere, not only at home.
              </p>
              {typeInstead ? (
                <>
                  {p.easyConnectLink && (
                    <>
                      <p className="label secondary">Phone can't scan? Send it this link (by email or a chat app, for example) and tap the link on the phone. It works from anywhere and only once.</p>
                      <CopyLink link={p.easyConnectLink} />
                    </>
                  )}
                  <p className="label secondary">Or, on the same Wi-Fi as this PC, type this in the app:</p>
                  <TypedCode s={s} />
                </>
              ) : (
                <button className="btn btn-text label" onClick={() => setTypeInstead(true)}>
                  Use a code instead
                </button>
              )}
            </>
          ) : (
            <>
              <p className="row callout secondary" style={{ alignItems: "flex-start" }}>
                <Icon of={Wifi} size="sm" /> Your phone needs to be on the same Wi-Fi as this PC.
              </p>
              <p className="label secondary">Can't scan? Type this in the app:</p>
              <TypedCode s={s} />
            </>
          )}
          {s.companion.adminRoutes && (
            <button className="btn btn-quiet btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => api.newPairingCode()}>
              <Icon of={RefreshCw} size="sm" /> New code
            </button>
          )}
        </div>
      </div>
      <div className="under-card">
        {p.easyConnect === "starting" && <EasyConnectProgress detail={p.easyConnectDetail} />}
        {p.easyConnect === "error" && p.easyConnectError && <p className="label secondary">{p.easyConnectError}</p>}
        {(p.easyConnect === "off" || p.easyConnect === "error") && s.companion.adminRoutes && (
          <button className="btn btn-text label" onClick={() => api.setEasyConnect(true)}>
            {p.easyConnect === "error" ? "Try “connect from anywhere” again" : "Also let my phone connect from anywhere, not only on this Wi-Fi"}
          </button>
        )}
      </div>
    </>
  );
}

/** The pairing popup: the only place the pairing QR and code show. `intro` goes above the code. */
export function PairingDialog({ s, onClose, title = "Connect a phone", intro }: { s: Snapshot; onClose: () => void; title?: string; intro?: ReactNode }) {
  return (
    <Dialog title={title} wide onClose={onClose}>
      {intro}
      <PairingPanel s={s} />
      <p className="caption tertiary pair-private">Keep this code private: anyone who scans it can use this PC to make apps. Close this when you are done.</p>
    </Dialog>
  );
}
