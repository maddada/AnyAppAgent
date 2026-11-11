// "Share with others" (docs/DISTRIBUTION.md, "GitHub"): the app's code stays in its private repo,
// and a second, public repo anyapp-<slug>-releases holds only a README, the icon and (stage 3) the
// published versions. The first share also moves the app to its own signing key if it still uses
// the PC's shared key, and nothing goes public before a secrets scan.
import type { App, AppSharing } from "../../shared/protocol.ts";
import * as github from "./github.ts";
import { HttpError } from "./http-error.ts";
import { describeSecrets, findSecrets } from "./secrets.ts";

export interface GithubApi {
  login(): Promise<string>;
  visibility(full: string): Promise<"PUBLIC" | "PRIVATE" | "INTERNAL" | null>;
  createPublic(full: string, description: string): Promise<void>;
  setVisibility(full: string, visibility: "public" | "private"): Promise<void>;
  putFile(full: string, path: string, content: Buffer, message: string): Promise<void>;
}

export const realGithub: GithubApi = {
  login: github.ghLogin,
  visibility: github.repoVisibility,
  createPublic: github.createPublicRepo,
  setVisibility: github.setVisibility,
  putFile: github.putFile,
};

export interface ShareDeps {
  github: GithubApi;
  /** Makes sure the app's private code repo exists (creates it if GitHub failed when the app was made). */
  ensureCodeRepo(): Promise<void>;
  /** The app's signing key kind, and moving it off the shared key (builder, stage 1). */
  keys?: { kind(packageName: string): "shared" | "own" | "moved"; move(packageName: string): Promise<void> };
  iconPng(): Buffer;
  log(...parts: unknown[]): void;
}

export interface PublishedVersion {
  version: string;
  build: number;
  publishedAt: string;
}

export function releasesRepoName(slug: string): string {
  return `anyapp-${slug}-releases`;
}

export function sharingUrls(owner: string, slug: string): Pick<AppSharing, "releasesRepoUrl" | "installUrl" | "feedUrl"> {
  const repo = `https://github.com/${owner}/${releasesRepoName(slug)}`;
  return {
    releasesRepoUrl: repo,
    installUrl: `${repo}/releases/latest/download/${slug}.apk`,
    feedUrl: `${repo}/releases/latest/download/update.json`,
  };
}

/** The public README: only the app's name, its icon and how to install. Nothing from the code. */
export function releasesReadme(app: Pick<App, "name" | "slug">, owner: string, latest?: PublishedVersion): string {
  const { installUrl } = sharingUrls(owner, app.slug);
  const status = latest
    ? `Latest version: **${latest.version}** (build ${latest.build}), published ${latest.publishedAt.slice(0, 10)}.`
    : "No version is published yet.";
  return [
    `# ${app.name}`,
    "",
    `<img src="icon.png" alt="${app.name}" width="96" height="96">`,
    "",
    "An Android app made with AnyAppAgent.",
    "",
    status,
    "",
    "## Install",
    "",
    `1. On your Android phone, open [${app.slug}.apk](${installUrl}).`,
    "2. Android asks you to allow installing apps from your browser: allow it, then tap Install.",
    "3. From then on the app tells you when a new version is out. Tap the notification to update.",
    "",
  ].join("\n");
}

export async function shareApp(app: App, deps: ShareDeps): Promise<{ sharing: AppSharing; movedKey: boolean }> {
  // Nothing goes anywhere before the scan (the name is the only app text in the README).
  const hits = findSecrets(releasesReadme(app, "owner"), "README.md");
  if (hits.length) throw new HttpError(400, describeSecrets(hits));

  const owner = await wrap("GitHub is not reachable", () => deps.github.login());
  await wrap("The app's private repository could not be made", () => deps.ensureCodeRepo());

  let movedKey = false;
  if (deps.keys && deps.keys.kind(app.packageName) === "shared") {
    // Before the first share: an app of its own key, so the PC's shared key cannot sign its updates.
    await wrap("The app could not get its own signing key", () => deps.keys!.move(app.packageName));
    movedKey = true;
    deps.log(`[${app.slug}] moved to its own signing key before sharing`);
  }

  const full = `${owner}/${releasesRepoName(app.slug)}`;
  const visibility = await wrap("GitHub is not reachable", () => deps.github.visibility(full));
  if (visibility === null) {
    await wrap("The public releases repository could not be made", () => deps.github.createPublic(full, `${app.name}: installs and updates (made with AnyAppAgent)`));
  } else if (visibility !== "PUBLIC") {
    await wrap("The releases repository could not be made public", () => deps.github.setVisibility(full, "public"));
  }
  if (!app.sharing) {
    await wrap("The releases repository could not be filled", async () => {
      await deps.github.putFile(full, "README.md", Buffer.from(releasesReadme(app, owner)), "README: how to install");
      await deps.github.putFile(full, "icon.png", deps.iconPng(), "The app's icon");
    });
  }
  deps.log(`[${app.slug}] shared: ${full} is public`);
  return { sharing: { shared: true, ...sharingUrls(owner, app.slug), since: app.sharing?.since ?? new Date().toISOString() }, movedKey };
}

export async function unshareApp(app: App, deps: Pick<ShareDeps, "github" | "log">): Promise<AppSharing> {
  if (!app.sharing) throw new HttpError(409, "This app is not shared.");
  const full = app.sharing.releasesRepoUrl.replace(/^https:\/\/github\.com\//, "");
  const visibility = await wrap("GitHub is not reachable", () => deps.github.visibility(full));
  if (visibility === "PUBLIC") await wrap("The releases repository could not be made private", () => deps.github.setVisibility(full, "private"));
  deps.log(`[${app.slug}] not shared any more: ${full} is private`);
  return { ...app.sharing, shared: false };
}

async function wrap<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const detail = (error as Error).message.split(/\r?\n/)[0].slice(0, 200);
    throw new HttpError(502, `${what}: ${detail}`);
  }
}
