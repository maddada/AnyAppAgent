// Pairing: the Easy Connect QR when the companion says it is ready (works from anywhere), otherwise
// the same-network QR with the address and 6-digit code for typing. While Easy Connect starts (a
// few minutes the first time), the same-network QR works and its progress shows underneath.
import { useEffect, useRef, useState } from "react";
import { Globe, RefreshCw, Wifi } from "lucide-react";
import type { Snapshot } from "../../shared/types.ts";
import { size as sizeTokens } from "../../../../shared/theme/tokens.ts";
import { Icon, QrPlate, Spinner } from "./ui.tsx";

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

/** Asks for a fresh code when Easy Connect is on but its one-time code was used or expired. */
export function useFreshCode(s: Snapshot): void {
  const asked = useRef(false);
  const needs = s.pairing.needsNewCode;
  useEffect(() => {
    if (needs && !asked.current) {
      asked.current = true;
      void api.newPairingCode();
    }
    if (!needs) asked.current = false;
  }, [needs]);
}

/** The full pairing block: big QR on the left, words on the right. */
export function PairingPanel({ s }: { s: Snapshot }) {
  const p = s.pairing;
  const [typeInstead, setTypeInstead] = useState(false);
  useFreshCode(s);
  if (p.kind === "none" || !p.qrSvg) {
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
                  <p className="label secondary">On the same Wi-Fi as this PC, you can type this instead:</p>
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
