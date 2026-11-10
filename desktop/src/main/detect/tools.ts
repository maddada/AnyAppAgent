// The app-making tools the builder and Claude Code need: a JDK, the Android SDK pieces, Node.js
// (npm) and Git. Each is looked for in our own tools folder first, then where a PC usually has it.
// A toolchain already on the PC is used as is and never modified.
import * as realFs from "node:fs";
import { join } from "node:path";
import type { ToolPiece, ToolsCheck } from "../../shared/types.ts";
import type { Runner } from "../exec.ts";

/** What the template needs (docs/ENVIRONMENT.md: Expo SDK 58, compileSdk 37, buildTools 37.0.0, NDK 27.1.12297006). */
export const REQUIRED_SDK_PACKAGES = ["platform-tools", "platforms;android-37.0", "build-tools;37.0.0", "ndk;27.1.12297006"];
/** Installed too: React Native's own CMake (3.30.5) and AGP's default (3.22.1), so native modules
 *  do not fetch one during the first build (a fetched one would bring the old ninja, see below). */
export const EXTRA_SDK_PACKAGES = ["cmake;3.30.5", "cmake;3.22.1"];
/** ninja 1.12+ handles paths over 260 characters; SDK CMake bundles 1.10.2, which breaks the
 *  React Native C++ build (docs/ENVIRONMENT.md, pitfall 1). */
export const MIN_NINJA: [number, number] = [1, 12];

export function parseNinjaVersion(output: string): [number, number] | undefined {
  const m = output.trim().match(/^(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

export function ninjaOk(version: [number, number] | undefined): boolean {
  return !!version && (version[0] > MIN_NINJA[0] || (version[0] === MIN_NINJA[0] && version[1] >= MIN_NINJA[1]));
}
export const MIN_JAVA = 17;
export const MIN_NODE = 20;

export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
}

/** "platforms;android-37.0" -> "platforms/android-37.0" (the folder sdkmanager installs into). */
export function sdkPackageDir(pkg: string): string {
  return pkg.split(";").join("/");
}

export function javaMajor(releaseFile: string): number | undefined {
  const m = releaseFile.match(/^JAVA_VERSION="?(\d+)(?:\.(\d+))?/m);
  if (!m) return undefined;
  const first = Number(m[1]);
  return first === 1 && m[2] ? Number(m[2]) : first; // 1.8 -> 8
}

export function checkJdk(dir: string, fs: FsLike = realFs): { ok: boolean; version?: string; why?: string } {
  const java = join(dir, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!fs.existsSync(java)) return { ok: false, why: "no java" };
  let release = "";
  try {
    release = fs.readFileSync(join(dir, "release"), "utf8");
  } catch {
    return { ok: false, why: "no release file" };
  }
  const major = javaMajor(release);
  if (!major || major < MIN_JAVA) return { ok: false, version: major ? String(major) : undefined, why: "too old" };
  const full = release.match(/^JAVA_VERSION="?([\d.]+)/m)?.[1];
  return { ok: true, version: full };
}

export function missingSdkPackages(dir: string, fs: FsLike = realFs, required = REQUIRED_SDK_PACKAGES): string[] {
  const missing = required.filter((pkg) => !fs.existsSync(join(dir, sdkPackageDir(pkg), "source.properties")) && !fs.existsSync(join(dir, sdkPackageDir(pkg), "package.xml")));
  if (!fs.existsSync(join(dir, "licenses", "android-sdk-license"))) missing.push("licenses");
  return missing;
}

/** Candidate JDK / SDK folders: ours first, then the environment, then the usual places. */
export function toolchainCandidates(toolsDir: string, env: NodeJS.ProcessEnv): { jdk: { path: string; source: "tools" | "system" }[]; sdk: { path: string; source: "tools" | "system" }[] } {
  const jdk: { path: string; source: "tools" | "system" }[] = [{ path: join(toolsDir, "jdk"), source: "tools" }];
  const sdk: { path: string; source: "tools" | "system" }[] = [{ path: join(toolsDir, "android-sdk"), source: "tools" }];
  const add = (list: typeof jdk, p: string | undefined) => {
    if (p && !list.some((c) => c.path.toLowerCase() === p.toLowerCase())) list.push({ path: p, source: "system" });
  };
  add(jdk, env.ANYAPP_JAVA_HOME);
  add(jdk, env.JAVA_HOME);
  add(sdk, env.ANYAPP_ANDROID_HOME);
  add(sdk, env.ANDROID_HOME);
  add(sdk, env.ANDROID_SDK_ROOT);
  if (process.platform === "win32") {
    const pf = env.ProgramFiles ?? "C:\\Program Files";
    add(jdk, join(pf, "Android", "Android Studio", "jbr"));
    if (env.LOCALAPPDATA) add(sdk, join(env.LOCALAPPDATA, "Android", "Sdk"));
    // A shared toolchain folder like the one on the developer's PC (and the builder's default).
    for (const drive of ["C", "D", "E"]) {
      add(jdk, `${drive}:\\tools\\android\\jdk`);
      add(sdk, `${drive}:\\tools\\android\\sdk`);
    }
  }
  return { jdk, sdk };
}

export function parseNodeVersion(output: string): number | undefined {
  const m = output.trim().match(/^v?(\d+)\.\d+/);
  return m ? Number(m[1]) : undefined;
}

function onPath(env: NodeJS.ProcessEnv, names: string[], fs: FsLike): string | undefined {
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of (env.PATH ?? env.Path ?? "").split(sep)) {
    if (!dir.trim()) continue;
    for (const name of names) {
      const p = join(dir.trim(), name);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

/** The ninja.exe of every CMake in an SDK whose version is too old for long paths. */
export async function oldNinjas(sdk: string, runner: Runner, fs: FsLike & { readdirSync?: (p: string) => string[] } = realFs): Promise<string[]> {
  const cmakeDir = join(sdk, "cmake");
  if (!fs.existsSync(cmakeDir) || !fs.readdirSync) return [];
  const old: string[] = [];
  for (const v of fs.readdirSync(cmakeDir)) {
    const ninja = join(cmakeDir, v, "bin", process.platform === "win32" ? "ninja.exe" : "ninja");
    if (!fs.existsSync(ninja)) continue;
    const r = await runner(ninja, ["--version"], { timeoutMs: 10_000 });
    if (!ninjaOk(parseNinjaVersion(r.stdout))) old.push(ninja);
  }
  return old;
}

export interface ToolsDetectOptions {
  toolsDir: string;
  env: NodeJS.ProcessEnv;
  runner: Runner;
  fs?: FsLike;
}

export async function detectTools({ toolsDir, env, runner, fs = realFs }: ToolsDetectOptions): Promise<ToolsCheck> {
  const win = process.platform === "win32";
  const cands = toolchainCandidates(toolsDir, env);
  const pieces: ToolPiece[] = [];

  // JDK
  let jdkPiece: ToolPiece = { id: "jdk", label: "Java kit", ok: false, source: "none" };
  for (const c of cands.jdk) {
    const r = checkJdk(c.path, fs);
    if (r.ok) {
      jdkPiece = { id: "jdk", label: "Java kit", ok: true, path: c.path, source: c.source, version: r.version };
      break;
    }
  }
  pieces.push(jdkPiece);

  // Android SDK: the first complete one wins; otherwise report our own folder (what we would fix).
  let sdkPiece: ToolPiece | undefined;
  for (const c of cands.sdk) {
    if (!fs.existsSync(c.path)) continue;
    const missing = missingSdkPackages(c.path, fs);
    if (missing.length === 0 && (await oldNinjas(c.path, runner, fs as FsLike & { readdirSync?: (p: string) => string[] })).length > 0) {
      // A complete SDK whose CMake has the old ninja: ours gets fixed, someone else's is not touched.
      if (c.source === "tools") {
        sdkPiece = { id: "sdk", label: "Android kit", ok: false, path: c.path, source: "tools", missing: ["ninja"] };
        break;
      }
      continue;
    }
    if (missing.length === 0) {
      sdkPiece = { id: "sdk", label: "Android kit", ok: true, path: c.path, source: c.source };
      break;
    }
  }
  if (!sdkPiece) {
    const own = cands.sdk[0].path;
    sdkPiece = { id: "sdk", label: "Android kit", ok: false, path: own, source: "none", missing: missingSdkPackages(own, fs) };
  }
  pieces.push(sdkPiece);

  // Node.js (npm): ours, then PATH.
  const ownNode = join(toolsDir, "node", win ? "node.exe" : "bin/node");
  const nodePath = fs.existsSync(ownNode) ? ownNode : onPath(env, [win ? "node.exe" : "node"], fs);
  let nodePiece: ToolPiece = { id: "node", label: "Node.js", ok: false, source: "none" };
  if (nodePath) {
    const r = await runner(nodePath, ["--version"], { env, timeoutMs: 10_000 });
    const major = parseNodeVersion(r.stdout);
    nodePiece = {
      id: "node",
      label: "Node.js",
      ok: !!major && major >= MIN_NODE,
      path: nodePath,
      source: nodePath === ownNode ? "tools" : "system",
      version: r.stdout.trim() || undefined,
    };
  }
  pieces.push(nodePiece);

  // Git (with Git Bash, which Claude Code uses on Windows).
  const ownGit = join(toolsDir, "git", "cmd", win ? "git.exe" : "git");
  const programGit = win ? join(env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd", "git.exe") : undefined;
  const gitPath = fs.existsSync(ownGit) ? ownGit : (onPath(env, [win ? "git.exe" : "git"], fs) ?? (programGit && fs.existsSync(programGit) ? programGit : undefined));
  pieces.push({ id: "git", label: "Git", ok: !!gitPath, path: gitPath, source: gitPath ? (gitPath === ownGit ? "tools" : "system") : "none" });

  const ok = pieces.every((p) => p.ok);
  const fromPc = pieces.every((p) => p.source === "system");
  return {
    state: ok ? "done" : "needed",
    summary: ok ? (fromPc ? "Ready. Found on this PC." : "Ready.") : "Needs a one-time download (about 2.5 GB).",
    pieces,
    env: toolsEnv(pieces, toolsDir),
  };
}

/** The environment the companion gets: JAVA_HOME, ANDROID_HOME and PATH entries in front. */
export function toolsEnv(pieces: ToolPiece[], toolsDir: string): ToolsCheck["env"] {
  const jdk = pieces.find((p) => p.id === "jdk" && p.ok);
  const sdk = pieces.find((p) => p.id === "sdk" && p.ok);
  const node = pieces.find((p) => p.id === "node" && p.ok);
  const git = pieces.find((p) => p.id === "git" && p.ok);
  const path: string[] = [];
  if (jdk?.path) path.push(join(jdk.path, "bin"));
  if (sdk?.path) path.push(join(sdk.path, "platform-tools"));
  if (node?.source === "tools") path.push(join(toolsDir, "node"));
  let gitBash: string | undefined;
  if (git?.source === "tools") {
    path.push(join(toolsDir, "git", "cmd"), join(toolsDir, "git", "usr", "bin"));
    gitBash = join(toolsDir, "git", "bin", "bash.exe");
  }
  return { JAVA_HOME: jdk?.path, ANDROID_HOME: sdk?.path, path, gitBash };
}
