// Getting Kiwimake itself onto the phone: a QR code for the phone app on this project's public
// GitHub release (works on any network, with only the phone's camera). The same-Wi-Fi download
// from this PC stays as a fallback for when the release cannot be reached. The QR shows only in its
// popup (GetPhoneAppDialog), never straight on a screen.
import { useEffect, useState } from "react";
import { size as sizeTokens } from "../../../../shared/theme/tokens.ts";
import type { PhoneDownload, PhoneRelease } from "../../shared/types.ts";
import type { PairedDevice } from "../../../../shared/protocol.ts";
import { phonesBehind } from "./phoneBehind.ts";
import { Dialog, QrPlate, Spinner } from "./ui.tsx";

const api = window.anyapp;

export function usePhoneRelease(): PhoneRelease | null {
  const [release, setRelease] = useState<PhoneRelease | null>(null);
  useEffect(() => {
    let alive = true;
    void api.phoneRelease().then((r) => alive && setRelease(r));
    return () => {
      alive = false;
    };
  }, []);
  return release;
}

/** The QR, one plain line under it, and the same-Wi-Fi fallback. `big` for the onboarding step. */
export function GetPhoneApp({ big }: { big?: boolean }) {
  const release = usePhoneRelease();
  const [local, setLocal] = useState<PhoneDownload | null>(null);
  const [useLocal, setUseLocal] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => void api.phoneDownload().then((d) => alive && setLocal(d));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const localReady = !!(local?.available && local.qrSvg);
  const showLocal = useLocal && localReady;
  const svg = showLocal ? local!.qrSvg! : release?.qrSvg;
  const qr = big ? sizeTokens.qr * 1.5 : sizeTokens.qr;
  return (
    <div className={`get-phone${big ? " big" : ""}`} data-testid="get-phone-app">
      {svg ? <QrPlate svg={svg} size={qr} label="Download Kiwimake for your phone" /> : <Spinner />}
      <p className="label secondary get-phone-line">
        {showLocal
          ? "Your phone must be on the same Wi-Fi as this PC. Scan this with its camera, then open the downloaded file and allow installing."
          : "Scan this with your phone's camera, then open the downloaded file and allow installing."}
      </p>
      {!local && <p className="label secondary">Preparing the phone download on this PC…</p>}
      {local?.error && <div className="card" role="status"><p>{local.error}</p><div className="notice-actions"><button className="btn btn-quiet" onClick={() => { setLocal(null); void api.phoneDownload().then(setLocal); }}>Try download again</button></div></div>}
      {release?.universalUrl && <button className="btn btn-text btn-sm" onClick={() => api.openExternal(release.universalUrl!)}>Download for an x86 device</button>}
      {localReady && (
        <button className="btn btn-text btn-sm" onClick={() => setUseLocal(!useLocal)}>
          {useLocal ? (
            "Use the download from the internet"
          ) : (
            <span>
              Didn't download? <span className="keep">Get it from this PC over Wi-Fi</span>
            </span>
          )}
        </button>
      )}
    </div>
  );
}

/** The download popup: the only place the phone app's QR shows. */
export function GetPhoneAppDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Get Kiwimake on a phone" onClose={onClose}>
      <GetPhoneApp big />
    </Dialog>
  );
}

// ------------------------------------------------------------------ A phone on an older Kiwimake

const notNowKey = (d: PairedDevice, release: string) => `phone-update-not-now:${d.id}:${release}`;

function putAway(d: PairedDevice, release: string): boolean {
  try {
    return window.localStorage.getItem(notNowKey(d, release)) === "1";
  } catch {
    return false;
  }
}

/**
 * Over the apps list, under Kiwimake's own update: a connected phone runs an older Kiwimake than the
 * newest phone release. A phone that said its version updates itself (the notice on its home
 * screen); a phone too old to say may be one that cannot, so the download is offered too. Text full
 * width, buttons below it on the right (AGENTS.md, design).
 */
export function PhoneUpdateNotice({ devices, release, onGetApp }: { devices: PairedDevice[]; release: string | undefined; onGetApp: () => void }) {
  const [, setTick] = useState(0);
  const phone = phonesBehind(devices, release).find((d) => !putAway(d, release!));
  if (!phone || !release) return null;
  const notNow = () => {
    try {
      window.localStorage.setItem(notNowKey(phone, release), "1");
    } catch {
      // Not kept: it shows again next time.
    }
    setTick((n) => n + 1);
  };
  const known = phone.appVersion !== undefined;
  return (
    <div className="card notice apps-notice" data-testid="phone-update-notice" role="status">
      <div className="grow">
        <div className="body">{known ? `Kiwimake ${release} is ready for ${phone.name}` : `Is Kiwimake on ${phone.name} up to date?`}</div>
        <div className="label secondary">
          {known
            ? `${phone.name} runs Kiwimake ${phone.appVersion}. Open Kiwimake there and tap Install on its home screen. Your apps and the connection to this PC stay as they are.`
            : `Kiwimake ${release} is out. Phones with Kiwimake 0.3.3 or older can't update themselves: download it once on the phone and open the file. Your apps and the connection to this PC stay as they are.`}
        </div>
      </div>
      <div className="notice-actions">
        <button className="btn btn-quiet btn-sm" onClick={notNow} data-testid="phone-update-not-now">
          Not now
        </button>
        {!known && (
          <button className="btn btn-primary btn-sm" onClick={onGetApp} data-testid="phone-update-get">
            Get the phone app
          </button>
        )}
      </div>
    </div>
  );
}
