import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import pin from "../../../phone-release.json";
import { download } from "./download.ts";

export const PHONE_PIN = pin;
export const pinnedPhoneUrl = `https://github.com/maddada/Kiwimake/releases/download/v${pin.version}/AnyAppAgent.apk`;
export const universalPhoneUrl = `https://github.com/maddada/Kiwimake/releases/download/v${pin.version}/AnyAppAgent-universal.apk`;
export const phoneCachePath = (stateDir: string): string => join(stateDir, "downloads", `phone-${pin.version}-${pin.sha256.slice(0, 12)}.apk`);

export async function validPhone(file: string): Promise<boolean> {
  if (!existsSync(file) || statSync(file).size !== pin.bytes) return false;
  const hash = createHash("sha256");
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest("hex") === pin.sha256;
}
let pending: Promise<string> | undefined;
export function ensurePhone(stateDir: string): Promise<string> {
  return pending ??= (async () => {
    const dest = phoneCachePath(stateDir);
    if (await validPhone(dest)) return dest;
    await download({ url: pinnedPhoneUrl, dest, checksum: `sha256:${pin.sha256}`, signal: AbortSignal.timeout(5 * 60_000) });
    if (!await validPhone(dest)) throw new Error("The phone download did not pass verification. Please try again.");
    return dest;
  })().finally(() => { pending = undefined; });
}
