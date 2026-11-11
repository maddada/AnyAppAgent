// Getting AnyAppAgent itself onto the phone: a QR code for the phone app on this project's public
// GitHub release (works on any network, with only the phone's camera). The same-Wi-Fi download
// from this PC stays as a fallback for when the release cannot be reached. The QR shows only in its
// popup (GetPhoneAppDialog), never straight on a screen.
import { useEffect, useState } from "react";
import { size as sizeTokens } from "../../../../shared/theme/tokens.ts";
import type { PhoneDownload, PhoneRelease } from "../../shared/types.ts";
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
      {svg ? <QrPlate svg={svg} size={qr} label="Download AnyAppAgent for your phone" /> : <Spinner />}
      <p className="label secondary get-phone-line">
        {showLocal
          ? "Your phone must be on the same Wi-Fi as this PC. Scan this with its camera, then open the downloaded file and allow installing."
          : "Scan this with your phone's camera, then open the downloaded file and allow installing."}
      </p>
      {localReady && (
        <button className="btn btn-text btn-sm" onClick={() => setUseLocal(!useLocal)}>
          {useLocal ? "Use the download from the internet" : "Didn't download? Get it from this PC over Wi-Fi"}
        </button>
      )}
    </div>
  );
}

/** The download popup: the only place the phone app's QR shows. */
export function GetPhoneAppDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Get AnyAppAgent on a phone" onClose={onClose}>
      <GetPhoneApp big />
    </Dialog>
  );
}
