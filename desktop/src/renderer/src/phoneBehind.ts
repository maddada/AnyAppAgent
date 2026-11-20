// Which connected phones run an older Kiwimake than the newest phone release (the desktop's pin,
// which the companion lists as AdminState.phoneRelease). Pure, for PhoneUpdateNotice and its test.
import type { PairedDevice } from "../../../../shared/protocol.ts";

/** `0.3.4` -> [0, 3, 4], or null. */
function parts(version: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `version` is older than `release`. */
export function olderThan(version: string, release: string): boolean {
  const a = parts(version);
  const b = parts(release);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * The connected phones that run an older Kiwimake than `release`: those that said an older version,
 * and those too old to say one (0.3.5 and earlier; 0.3.3 and earlier cannot update themselves).
 */
export function phonesBehind(devices: PairedDevice[], release: string | undefined): PairedDevice[] {
  if (!release || !parts(release)) return [];
  return devices.filter((d) => d.connected && (d.appVersion === undefined || olderThan(d.appVersion, release)));
}
