// The newest Kiwimake release and its phone APK (docs/RELEASING.md, "Updates of the phone app").
// Pure functions, no React: dev/releaseFeed.test.mjs runs them with `node --test`.
//
// Copied from Ghostex's src/updates/androidSelfUpdate.ts (read only, never imported). Every GitHub
// release of maddada/AnyAppAgent is tagged v<version> and carries two phone APKs: AnyAppAgent.apk
// (arm64-v8a, nearly every phone) and AnyAppAgent-universal.apk (arm64-v8a and x86_64: the emulator
// and x86 tablets). GitHub gives each asset its size and SHA-256 (`digest`), which the download is
// checked against before Android sees it.

export const APK_ARM64 = "AnyAppAgent.apk";
export const APK_UNIVERSAL = "AnyAppAgent-universal.apk";

export type SemanticVersion = readonly [major: number, minor: number, patch: number];

export type ReleaseApk = { name: string; url: string; size: number; sha256: string | null };

export type LatestRelease = {
  /** `v0.3.4` */
  tag: string;
  /** `0.3.4` */
  version: string;
  /** The APK for this phone's processor, or null when the release has none for it yet. */
  apk: ReleaseApk | null;
};

/** `0.3.4` or `v0.3.4`; anything else is not a release version. */
export function parseVersion(text: string): SemanticVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(text.trim());
  if (match === null) throw new Error(`Version "${text}" is not MAJOR.MINOR.PATCH.`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is strictly newer than `installed`. */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(installed);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * The APK for a phone with these ABIs (best first): the arm64-v8a one when that is its own
 * processor, else the universal one (an x86_64 emulator also lists arm64-v8a, through translation).
 */
export function apkNameFor(abis: string[]): string {
  return abis.length === 0 || abis[0] === "arm64-v8a" ? APK_ARM64 : APK_UNIVERSAL;
}

type Asset = { name?: unknown; browser_download_url?: unknown; size?: unknown; digest?: unknown };

function toApk(asset: Asset | undefined): ReleaseApk | null {
  if (!asset || typeof asset.name !== "string" || typeof asset.browser_download_url !== "string" || typeof asset.size !== "number") return null;
  const digest = typeof asset.digest === "string" ? /^sha256:([0-9a-f]{64})$/iu.exec(asset.digest)?.[1]?.toLowerCase() ?? null : null;
  return { name: asset.name, url: asset.browser_download_url, size: asset.size, sha256: digest };
}

/** Reads GitHub's `releases/latest` answer: its version and the APK this phone takes. */
export function readRelease(body: unknown, abis: string[]): LatestRelease {
  if (typeof body !== "object" || body === null) throw new Error("GitHub sent an unexpected answer.");
  const release = body as { tag_name?: unknown; assets?: unknown };
  if (typeof release.tag_name !== "string" || !Array.isArray(release.assets)) throw new Error("GitHub sent a release without a version or files.");
  const [major, minor, patch] = parseVersion(release.tag_name);
  const assets = release.assets as Asset[];
  const wanted = apkNameFor(abis);
  // A phone that runs arm64 can take the universal APK when the small one is missing.
  const apk = toApk(assets.find((a) => a.name === wanted)) ?? (wanted === APK_ARM64 ? toApk(assets.find((a) => a.name === APK_UNIVERSAL)) : null);
  return { tag: release.tag_name, version: `${major}.${minor}.${patch}`, apk };
}

/** A failed answer from GitHub, in a sentence. */
export function describeFeedFailure(status: number, rateLimitRemaining: string | null, rateLimitReset: string | null): string {
  if ((status === 403 || status === 429) && rateLimitRemaining === "0") {
    const at = rateLimitReset === null ? null : new Date(Number(rateLimitReset) * 1000);
    return at === null || Number.isNaN(at.getTime())
      ? "GitHub is busy. Try again later."
      : `GitHub is busy. Try again after ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`;
  }
  if (status === 404) return "There is no Kiwimake release on GitHub yet.";
  return `GitHub answered with error ${status}.`;
}

/** `29881800` -> `29 MB`. */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
