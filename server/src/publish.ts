// Publishing a version of a shared app as a GitHub release, and pulling one back
// (docs/DISTRIBUTION.md, "The release format"). The APKs published are the ones the PC already
// built and the owner already ran: nothing is built again here.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, BuildInfo, PublishedRelease, PublishRequest } from "../../shared/protocol.ts";
import { HttpError } from "./http-error.ts";
import { scanApk } from "./apk-scan.ts";
import { describeSecrets, findSecrets } from "./secrets.ts";
import { releasesReadme } from "./sharing.ts";

export const TESTING_TAG = "testing";
export const UPDATE_JSON = "update.json";
export const UPDATE_TESTING_JSON = "update-testing.json";

export interface ReleaseApi {
  createRelease(full: string, tag: string, opts: { title: string; notesFile: string; files: string[]; prerelease: boolean; latest: boolean }): Promise<void>;
  uploadAssets(full: string, tag: string, files: string[]): Promise<void>;
  editRelease(full: string, tag: string, opts: { title?: string; prerelease?: boolean; latest?: boolean }): Promise<void>;
  releaseExists(full: string, tag: string): Promise<boolean>;
  putFile(full: string, path: string, content: Buffer, message: string): Promise<void>;
}

export interface ApkFile {
  abi: string; // "universal" for the full APK
  path: string;
  size: number;
  sha256: string;
}

export interface PublishDeps {
  github: ReleaseApi;
  apks: ApkFile[]; // the newest build's APKs, the full one first
  /** Certificate SHA-256 of the app's signing key now (null when unknown: the fake builder). */
  currentSigner(): Promise<string | null>;
  /** Default notes: what changed in the builds after `afterBuild` up to `build`. */
  notesBetween(afterBuild: number, build: number): Promise<string>;
  log(...parts: unknown[]): void;
}

/** The newest build was signed by a key the app no longer uses (made before its key moved). */
export class StaleSignerError extends HttpError {
  constructor() {
    super(409, "This version was made before the app got its own key. It is being built again; publish again when it is ready.");
  }
}

export interface UpdateJson {
  format: 1;
  package: string;
  build: number;
  version: string;
  channel: "stable" | "testing";
  notes: string;
  publishedAt: string;
  apks: { abi: string; name: string; size: number; sha256: string }[];
  signer: string;
  blocked: number[];
}

export function repoOf(app: App): string {
  if (!app.sharing) throw new HttpError(409, "Share this app first.");
  return app.sharing.releasesRepoUrl.replace(/^https:\/\/github\.com\//, "");
}

export function assetName(slug: string, abi: string): string {
  return abi === "universal" ? `${slug}.apk` : `${slug}-${abi}.apk`;
}

export function nextVersion(releases: PublishedRelease[], channel: "stable" | "testing", build: number): string {
  const stable = releases.filter((r) => r.channel === "stable").length;
  return channel === "stable" ? `1.${stable}` : `1.${stable}-test.${build}`;
}

export async function publishVersion(app: App, build: BuildInfo | undefined, req: PublishRequest, deps: PublishDeps): Promise<PublishedRelease[]> {
  if (!app.sharing?.shared) throw new HttpError(409, "Share this app first: turn on Share with others.");
  if (!build || build.status !== "succeeded" || deps.apks.length === 0) throw new HttpError(409, "This app has no finished version to publish yet.");
  const channel = req.channel === "testing" ? "testing" : "stable";
  const releases = app.sharing.releases ?? [];
  if (releases.some((r) => r.build === build.number && r.channel === channel && !r.pulledBack)) {
    throw new HttpError(409, `This version (build ${build.number}) is already published${channel === "testing" ? " for testing" : ""}.`);
  }
  if (channel === "stable" && releases.some((r) => r.channel === "stable" && !r.pulledBack && r.build > build.number)) {
    throw new HttpError(409, "A newer version is already published.");
  }

  const signer = await deps.currentSigner();
  if (signer && build.signerSha256 !== signer) throw new StaleSignerError();

  // Nothing goes public that looks like a secret: every text file and the code inside the APK.
  const hits = scanApk(deps.apks[0].path);
  const lastPublished = releases.find((r) => r.channel === "stable" && !r.pulledBack)?.build ?? 0;
  const notes = (req.notes?.trim() || (await deps.notesBetween(lastPublished, build.number)) || "Small improvements.").slice(0, 4000);
  hits.push(...findSecrets(notes, "the release notes"));
  if (hits.length) throw new HttpError(400, describeSecrets(hits, "published"));

  const full = repoOf(app);
  const version = nextVersion(releases, channel, build.number);
  const tag = channel === "stable" ? `v${version}-b${build.number}` : TESTING_TAG;
  const publishedAt = new Date().toISOString();
  const update: UpdateJson = {
    format: 1,
    package: app.packageName,
    build: build.number,
    version,
    channel,
    notes,
    publishedAt,
    apks: deps.apks.map((a) => ({ abi: a.abi, name: assetName(app.slug, a.abi), size: a.size, sha256: a.sha256 })),
    signer: signer ?? build.signerSha256 ?? "",
    blocked: releases.filter((r) => r.pulledBack).map((r) => r.build),
  };

  const dir = mkdtempSync(join(tmpdir(), "anyapp-publish-"));
  try {
    const files: string[] = [];
    for (const a of deps.apks) {
      const target = join(dir, assetName(app.slug, a.abi));
      copyFileSync(a.path, target);
      files.push(target);
    }
    const feed = join(dir, channel === "stable" ? UPDATE_JSON : UPDATE_TESTING_JSON);
    writeFileSync(feed, JSON.stringify(update, null, 2));
    files.push(feed);
    const notesFile = join(dir, "notes.md");
    writeFileSync(notesFile, `${notes}\n\nBuild ${build.number}. Install: open ${assetName(app.slug, "universal")} on your Android phone.\n`);
    const title = channel === "stable" ? `${app.name} ${version}` : `${app.name} ${version} (testing)`;
    if (channel === "testing" && (await deps.github.releaseExists(full, TESTING_TAG))) {
      // One Testing release whose files are replaced each time, so its address never changes.
      await deps.github.uploadAssets(full, TESTING_TAG, files);
      await deps.github.editRelease(full, TESTING_TAG, { title, prerelease: true });
    } else {
      await deps.github.createRelease(full, tag, { title, notesFile, files, prerelease: channel === "testing", latest: channel === "stable" });
    }
    if (channel === "stable") {
      await deps.github.putFile(full, "README.md", Buffer.from(releasesReadme(app, full.split("/")[0], { version, build: build.number, publishedAt })), `README: version ${version}`);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `GitHub did not take this version: ${(error as Error).message.split(/\r?\n/)[0].slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  deps.log(`[${app.slug}] published ${version} (build ${build.number}, ${channel}) to ${full}`);
  const release: PublishedRelease = { version, build: build.number, channel, tag, url: `https://github.com/${full}/releases/tag/${tag}`, notes, publishedAt };
  return [release, ...releases.filter((r) => !(r.channel === "testing" && channel === "testing"))];
}

/**
 * Pull back a stable version: it is no longer the latest (marked as a pre-release, which
 * releases/latest skips), the version before it becomes the latest again, and that version's
 * update.json lists the pulled build as blocked. Phones that already installed it keep it until a
 * newer version is published (Android never installs a lower build number).
 */
export async function pullBack(
  app: App,
  buildNumber: number,
  deps: { github: ReleaseApi; readUpdateJson(full: string, tag: string): Promise<UpdateJson>; writeAsset(full: string, tag: string, name: string, content: string): Promise<void>; log(...parts: unknown[]): void },
): Promise<PublishedRelease[]> {
  const releases = app.sharing?.releases ?? [];
  const bad = releases.find((r) => r.channel === "stable" && r.build === buildNumber);
  if (!bad) throw new HttpError(404, `Build ${buildNumber} was never published.`);
  if (bad.pulledBack) return releases;
  const full = repoOf(app);
  const blocked = [...new Set([...releases.filter((r) => r.pulledBack).map((r) => r.build), buildNumber])];
  const previous = releases.find((r) => r.channel === "stable" && !r.pulledBack && r.build < buildNumber);
  try {
    await deps.github.editRelease(full, bad.tag, { title: `${app.name} ${bad.version} (pulled back)`, prerelease: true });
    if (previous) {
      const update = await deps.readUpdateJson(full, previous.tag);
      await deps.writeAsset(full, previous.tag, UPDATE_JSON, JSON.stringify({ ...update, blocked }, null, 2));
      await deps.github.editRelease(full, previous.tag, { latest: true });
      await deps.github.putFile(full, "README.md", Buffer.from(releasesReadme(app, full.split("/")[0], previous)), `README: back to version ${previous.version}`);
    } else {
      await deps.github.putFile(full, "README.md", Buffer.from(releasesReadme(app, full.split("/")[0])), "README: no version published");
    }
  } catch (error) {
    throw new HttpError(502, `GitHub did not take the change: ${(error as Error).message.split(/\r?\n/)[0].slice(0, 200)}`);
  }
  deps.log(`[${app.slug}] pulled back ${bad.version} (build ${buildNumber})${previous ? `; ${previous.version} is the latest again` : ""}`);
  return releases.map((r) => (r === bad ? { ...r, pulledBack: true } : r));
}

/** Reads a downloaded update.json (used by tests and the pull back path). */
export function parseUpdateJson(text: string): UpdateJson {
  const doc = JSON.parse(text) as UpdateJson;
  if (doc.format !== 1 || typeof doc.build !== "number") throw new Error("not an AnyAppAgent update.json");
  return doc;
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}
