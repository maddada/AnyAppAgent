// Where things live. In development the companion and its siblings are the repo folders next to
// desktop/; in a packaged app electron-builder copies them under resources/companion/.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Paths {
  /** The folder that holds server/, shared/, builder/, template/. */
  repoRoot: string;
  serverDir: string;
  /** %USERPROFILE%\.anyappagent (the companion's state dir unless ANYAPP_STATE_DIR is set). */
  home: string;
  stateDir: string;
  appsDir: string;
  /** Where the desktop app installs JDK, Android SDK, Node, Git and gh. */
  toolsDir: string;
  /** The Kiwimake phone app (APK) the desktop offers for download. */
  phoneApkCandidates: string[];
}

export function resolvePaths(options: { packaged: boolean; resourcesPath: string; appPath: string; env?: NodeJS.ProcessEnv }): Paths {
  const env = options.env ?? process.env;
  const home = join(homedir(), ".anyappagent");
  const repoRoot = options.packaged ? join(options.resourcesPath, "companion") : resolve(options.appPath, "..");
  const stateDir = resolve(env.ANYAPP_STATE_DIR ?? home);
  return {
    repoRoot,
    serverDir: join(repoRoot, "server"),
    home,
    stateDir,
    appsDir: resolve(env.ANYAPP_APPS_DIR ?? (process.platform === "win32" ? "C:\\aa\\apps" : join(homedir(), "aa", "apps"))),
    toolsDir: resolve(env.ANYAPP_TOOLS_DIR ?? join(home, "tools")),
    phoneApkCandidates: [
      join(options.resourcesPath, "phone", "AnyAppAgent.apk"),
      join(repoRoot, "app", "dist", "AnyAppAgent.apk"),
      join(repoRoot, "app", "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
    ],
  };
}

export function firstExisting(paths: (string | undefined)[]): string | undefined {
  return paths.find((p) => !!p && existsSync(p));
}
