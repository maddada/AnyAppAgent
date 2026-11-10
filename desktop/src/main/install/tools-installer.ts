// "Get the tools": downloads and installs what the builder and Claude Code need into the app's own
// tools folder (%USERPROFILE%\.anyappagent\tools unless ANYAPP_TOOLS_DIR is set). Only missing
// pieces are installed; a toolchain already on the PC is never touched.
//
//   jdk          Microsoft Build of OpenJDK 21 (zip, sha256 from Microsoft)
//   android-sdk  Android command-line tools (sha1 from Google's repository XML), then sdkmanager
//                accepts the licences and installs REQUIRED_SDK_PACKAGES + EXTRA_SDK_PACKAGES
//   node         Node.js 24 LTS (zip, sha256 from SHASUMS256.txt)
//   git          PortableGit (Git with Git Bash, which Claude Code uses on Windows; sha256 from GitHub)
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { ToolPiece } from "../../shared/types.ts";
import { killTree, spawnHidden } from "../exec.ts";
import { EXTRA_SDK_PACKAGES, REQUIRED_SDK_PACKAGES, sdkPackageDir } from "../detect/tools.ts";
import { download, extractZip, fetchJson, fetchText, formatBytes } from "./download.ts";

export interface InstallProgress {
  progress: number; // 0..1
  label: string;
  detail?: string;
}

export interface InstallPlanStep {
  id: string;
  label: string; // plain words shown to the user
  weight: number; // rough size in MB, for the overall progress bar
}

/** What will be installed, given what detection found. Pure. */
export function planInstall(pieces: ToolPiece[], sdkMissing: string[] = []): InstallPlanStep[] {
  const steps: InstallPlanStep[] = [];
  const need = (id: ToolPiece["id"]) => !pieces.find((p) => p.id === id)?.ok;
  if (need("jdk")) steps.push({ id: "jdk", label: "Getting the Java kit", weight: 200 });
  if (need("sdk")) {
    steps.push({ id: "cmdline-tools", label: "Getting the Android kit", weight: 160 });
    steps.push({ id: "licenses", label: "Accepting the Android licences for you", weight: 5 });
    const onlyNinja = sdkMissing.length === 1 && sdkMissing[0] === "ninja";
    if (onlyNinja) {
      steps.length = steps.length - 2; // the SDK is there: no command-line tools or licences needed
    } else {
      const wanted = sdkMissing.length ? [...sdkMissing.filter((p) => p !== "licenses" && p !== "ninja"), ...EXTRA_SDK_PACKAGES] : [...REQUIRED_SDK_PACKAGES, ...EXTRA_SDK_PACKAGES];
      for (const pkg of [...new Set(wanted)]) steps.push({ id: `sdk:${pkg}`, label: sdkLabel(pkg), weight: sdkWeight(pkg) });
    }
    steps.push({ id: "ninja", label: "Fixing the native build helper for long folder names", weight: 3 });
  }
  if (need("node")) steps.push({ id: "node", label: "Getting Node.js", weight: 35 });
  if (need("git")) steps.push({ id: "git", label: "Getting Git", weight: 60 });
  return steps;
}

function sdkLabel(pkg: string): string {
  if (pkg.startsWith("ndk")) return "Getting the Android native kit (the biggest part)";
  if (pkg.startsWith("platforms")) return "Getting Android 17 for building";
  if (pkg.startsWith("build-tools")) return "Getting the Android build tools";
  if (pkg === "platform-tools") return "Getting the phone connection tools";
  if (pkg.startsWith("cmake")) return "Getting the native build helper";
  return `Getting ${pkg}`;
}

function sdkWeight(pkg: string): number {
  if (pkg.startsWith("ndk")) return 800;
  if (pkg.startsWith("platforms")) return 70;
  if (pkg.startsWith("build-tools")) return 60;
  if (pkg.startsWith("cmake")) return 30;
  return 10;
}

/** Parses sdkmanager's progress lines: "[=====    ] 45% Downloading android-ndk-r27b-windows.zip...". */
export function parseSdkProgress(chunk: string): number | undefined {
  const all = [...chunk.matchAll(/(\d{1,3})%/g)];
  if (all.length === 0) return undefined;
  const pct = Number(all[all.length - 1][1]);
  return pct >= 0 && pct <= 100 ? pct / 100 : undefined;
}

/** Picks the Windows command-line tools zip from Google's repository2-3.xml. */
export function pickCmdlineTools(xml: string): { url: string; sha1: string } | undefined {
  const start = xml.indexOf('<remotePackage path="cmdline-tools;latest">');
  if (start < 0) return undefined;
  const block = xml.slice(start, xml.indexOf("</remotePackage>", start));
  const archives = block.split("<archive>").slice(1);
  for (const archive of archives) {
    if (!/<host-os>windows<\/host-os>/.test(archive)) continue;
    const url = archive.match(/<url>([^<]+)<\/url>/)?.[1];
    const sha1 = archive.match(/<checksum type="sha1">([0-9a-f]+)<\/checksum>/)?.[1];
    if (url && sha1) return { url: `https://dl.google.com/android/repository/${url}`, sha1 };
  }
  return undefined;
}

export interface ToolsInstallerOptions {
  toolsDir: string;
  pieces: ToolPiece[];
  onProgress: (p: InstallProgress) => void;
  log?: (line: string) => void;
  /** For tests: limit the SDK packages (e.g. only platform-tools). */
  sdkPackages?: string[];
  /** For tests: run only these step ids (e.g. ["sdk:cmake;3.30.5", "ninja"]). */
  only?: string[];
}

export class ToolsInstaller {
  private readonly abort = new AbortController();
  private child: ChildProcess | undefined;
  private readonly opts: ToolsInstallerOptions;
  private done = 0;
  private total = 1;

  constructor(opts: ToolsInstallerOptions) {
    this.opts = opts;
  }

  cancel(): void {
    this.abort.abort();
    killTree(this.child);
  }

  private get downloads(): string {
    return join(this.opts.toolsDir, "downloads");
  }

  async run(): Promise<void> {
    const { toolsDir, pieces } = this.opts;
    mkdirSync(this.downloads, { recursive: true });
    const sdkPiece = pieces.find((p) => p.id === "sdk");
    let steps = planInstall(pieces, sdkPiece?.missing);
    if (this.opts.sdkPackages) {
      steps = steps.filter((s) => !s.id.startsWith("sdk:")).concat(this.opts.sdkPackages.map((pkg) => ({ id: `sdk:${pkg}`, label: sdkLabel(pkg), weight: sdkWeight(pkg) })));
    }
    if (this.opts.only) steps = this.opts.only.map((id) => steps.find((s) => s.id === id) ?? { id, label: id, weight: 10 });
    // Keep sdk:* after licenses even when the test filter appended them.
    steps.sort((a, b) => order(a.id) - order(b.id));
    this.total = steps.reduce((sum, s) => sum + s.weight, 0) || 1;
    this.done = 0;
    for (const step of steps) {
      if (this.abort.signal.aborted) throw new Error("Stopped.");
      const report = (fraction: number, detail?: string) =>
        this.opts.onProgress({ progress: Math.min(1, (this.done + step.weight * Math.max(0, Math.min(1, fraction))) / this.total), label: step.label, detail });
      report(0);
      this.log(`step ${step.id}`);
      if (step.id === "jdk") await this.installJdk(report);
      else if (step.id === "cmdline-tools") await this.installCmdlineTools(report);
      else if (step.id === "licenses") await this.acceptLicences();
      else if (step.id.startsWith("sdk:")) await this.installSdkPackage(step.id.slice(4), report);
      else if (step.id === "ninja") await this.installNinja(report);
      else if (step.id === "node") await this.installNode(report);
      else if (step.id === "git") await this.installGit(report);
      report(1);
      this.done += step.weight;
    }
    rmSync(this.downloads, { recursive: true, force: true });
    this.opts.onProgress({ progress: 1, label: "All set" });
    void toolsDir;
  }

  private log(line: string): void {
    this.opts.log?.(`[tools] ${line}`);
  }

  private bytes(report: (f: number, d?: string) => void) {
    return (received: number, total: number | undefined) =>
      report(total ? received / total : 0, total ? `${formatBytes(received)} of ${formatBytes(total)}` : formatBytes(received));
  }

  private async installJdk(report: (f: number, d?: string) => void): Promise<void> {
    const url = "https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip";
    const sum = (await fetchText(`${url}.sha256sum.txt`, this.abort.signal)).trim().split(/\s+/)[0];
    const zip = join(this.downloads, "jdk.zip");
    await download({ url, dest: zip, signal: this.abort.signal, checksum: `sha256:${sum}`, onProgress: this.bytes((f, d) => report(f * 0.85, d)) });
    report(0.9, "Unpacking…");
    await extractZip(zip, join(this.opts.toolsDir, "jdk"), { flatten: true });
  }

  private sdkDir(): string {
    return join(this.opts.toolsDir, "android-sdk");
  }

  private async installCmdlineTools(report: (f: number, d?: string) => void): Promise<void> {
    const xml = await fetchText("https://dl.google.com/android/repository/repository2-3.xml", this.abort.signal);
    const pick = pickCmdlineTools(xml);
    if (!pick) throw new Error("Could not find the Android tools download. Please try again later.");
    const zip = join(this.downloads, "cmdline-tools.zip");
    await download({ url: pick.url, dest: zip, signal: this.abort.signal, checksum: `sha1:${pick.sha1}`, onProgress: this.bytes((f, d) => report(f * 0.85, d)) });
    report(0.9, "Unpacking…");
    await extractZip(zip, join(this.sdkDir(), "cmdline-tools", "latest"), { flatten: true });
  }

  private javaHome(): string {
    const ours = join(this.opts.toolsDir, "jdk");
    if (existsSync(join(ours, "bin", "java.exe"))) return ours;
    const found = this.opts.pieces.find((p) => p.id === "jdk" && p.ok)?.path;
    if (!found) throw new Error("The Java kit is missing.");
    return found;
  }

  /** Runs sdkmanager.bat with JAVA_HOME set; answers "y" to every licence question. */
  private sdkmanager(args: string[], onOutput?: (chunk: string) => void): Promise<void> {
    const bat = join(this.sdkDir(), "cmdline-tools", "latest", "bin", "sdkmanager.bat");
    const javaHome = this.javaHome();
    return new Promise((resolve, reject) => {
      const child = spawnHidden(bat, [`--sdk_root=${this.sdkDir()}`, ...args], {
        env: { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, "bin")};${process.env.PATH ?? ""}` },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      child.stdin?.on("error", () => {}); // EPIPE once it exits
      let tail = "";
      const yes = setInterval(() => child.stdin?.write("y\n"), 500);
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        tail = (tail + text).slice(-4000);
        onOutput?.(text);
        if (/\(y\/N\)|Accept\?/i.test(text)) child.stdin?.write("y\n");
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (e) => {
        clearInterval(yes);
        reject(e);
      });
      child.on("close", (code) => {
        clearInterval(yes);
        this.child = undefined;
        if (this.abort.signal.aborted) reject(new Error("Stopped."));
        else if (code === 0) resolve();
        else reject(new Error(`The Android kit could not be installed.\n${tail.split(/\r?\n/).filter((l) => l.trim() && !/^\[=*\s*\]/.test(l.trim())).slice(-8).join("\n")}`));
      });
    });
  }

  /**
   * cmdline-tools 23 made sdkmanager a wrapper around the new `android sdk` CLI: `--licenses` only
   * prints "no longer needed" and the licence is recorded when a package installs. Older tools
   * still ask, so we run it (answering "y"), and if no licence file exists afterwards we write the
   * same file the new CLI writes. The UI tells the user we accept the Android SDK licence for them.
   */
  private async acceptLicences(): Promise<void> {
    await this.sdkmanager(["--licenses"]).catch((e) => this.log(`--licenses: ${(e as Error).message}`));
    const file = join(this.sdkDir(), "licenses", "android-sdk-license");
    if (!existsSync(file)) {
      mkdirSync(join(this.sdkDir(), "licenses"), { recursive: true });
      writeFileSync(file, `\n${ANDROID_SDK_LICENSE_HASH}`);
    }
  }

  /** sdkmanager 23 prints no percentages, so progress creeps towards 90% by expected time. */
  private async installSdkPackage(pkg: string, report: (f: number, d?: string) => void): Promise<void> {
    const expectedMs = sdkWeight(pkg) * 120; // roughly 8 MB/s download plus unpacking
    const started = Date.now();
    let phase = "Downloading…";
    let fromTool: number | undefined;
    const tick = setInterval(() => {
      const t = (Date.now() - started) / expectedMs;
      report(fromTool ?? 0.9 * (1 - Math.exp(-2 * t)), phase);
    }, 500);
    try {
      await this.sdkmanager(["--install", pkg], (chunk) => {
        if (/Unzipping|Installing|Unpacking/i.test(chunk)) phase = "Unpacking…";
        const f = parseSdkProgress(chunk);
        if (f !== undefined) fromTool = f;
      });
    } finally {
      clearInterval(tick);
    }
    if (!existsSync(join(this.sdkDir(), sdkPackageDir(pkg)))) throw new Error(`The Android kit piece ${pkg} did not install.`);
  }

  /**
   * Replaces the ninja.exe that SDK CMake bundles (1.10.2, no long paths) with the official ninja
   * release (1.12+), keeping the original beside it, exactly as docs/ENVIRONMENT.md pitfall 1 does.
   * Only ever inside our own tools folder.
   */
  private async installNinja(report: (f: number, d?: string) => void): Promise<void> {
    const rel = await fetchJson<{ assets: { name: string; browser_download_url: string; digest?: string }[] }>("https://api.github.com/repos/ninja-build/ninja/releases/latest", this.abort.signal);
    const asset = rel.assets.find((a) => a.name === (process.arch === "arm64" ? "ninja-winarm64.zip" : "ninja-win.zip"));
    if (!asset) throw new Error("Could not find the ninja download.");
    const zip = join(this.downloads, asset.name);
    await download({ url: asset.browser_download_url, dest: zip, signal: this.abort.signal, checksum: asset.digest, onProgress: this.bytes((f, d) => report(f * 0.6, d)) });
    const unpacked = join(this.downloads, "ninja");
    await extractZip(zip, unpacked);
    const fresh = join(unpacked, "ninja.exe");
    const cmakeRoot = join(this.sdkDir(), "cmake");
    if (!existsSync(cmakeRoot)) return;
    for (const v of readdirSync(cmakeRoot)) {
      const bin = join(cmakeRoot, v, "bin");
      const target = join(bin, "ninja.exe");
      if (!existsSync(target)) continue;
      const backup = join(bin, "ninja-bundled.exe");
      if (!existsSync(backup)) copyFileSync(target, backup);
      copyFileSync(fresh, target);
      this.log(`ninja replaced in ${bin}`);
    }
  }

  private async installNode(report: (f: number, d?: string) => void): Promise<void> {
    const index = await fetchJson<{ version: string; lts: string | false; files: string[] }[]>("https://nodejs.org/dist/index.json", this.abort.signal);
    const pick = index.find((v) => v.version.startsWith("v24.") && v.files.includes("win-x64-zip")) ?? index.find((v) => v.lts && v.files.includes("win-x64-zip"));
    if (!pick) throw new Error("Could not find a Node.js download.");
    const name = `node-${pick.version}-win-x64.zip`;
    const sums = await fetchText(`https://nodejs.org/dist/${pick.version}/SHASUMS256.txt`, this.abort.signal);
    const sum = sums.split("\n").find((l) => l.trim().endsWith(name))?.split(/\s+/)[0];
    const zip = join(this.downloads, name);
    await download({ url: `https://nodejs.org/dist/${pick.version}/${name}`, dest: zip, signal: this.abort.signal, checksum: sum ? `sha256:${sum}` : undefined, onProgress: this.bytes((f, d) => report(f * 0.85, d)) });
    report(0.9, "Unpacking…");
    await extractZip(zip, join(this.opts.toolsDir, "node"), { flatten: true });
  }

  private async installGit(report: (f: number, d?: string) => void): Promise<void> {
    const rel = await fetchJson<{ assets: { name: string; browser_download_url: string; digest?: string }[] }>("https://api.github.com/repos/git-for-windows/git/releases/latest", this.abort.signal);
    const asset = rel.assets.find((a) => /^PortableGit-.*-64-bit\.7z\.exe$/.test(a.name));
    if (!asset) throw new Error("Could not find the Git download.");
    const exe = join(this.downloads, asset.name);
    await download({ url: asset.browser_download_url, dest: exe, signal: this.abort.signal, checksum: asset.digest, onProgress: this.bytes((f, d) => report(f * 0.8, d)) });
    report(0.85, "Unpacking…");
    const dest = join(this.opts.toolsDir, "git");
    rmSync(dest, { recursive: true, force: true });
    // PortableGit is a 7-Zip self-extractor: -o<dir> -y unpacks without questions.
    await new Promise<void>((resolve, reject) => {
      const child = spawnHidden(exe, [`-o${dest}`, "-y"], { stdio: "ignore" });
      this.child = child;
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Git could not be unpacked (exit ${code}).`))));
    });
    if (!existsSync(join(dest, "cmd", "git.exe"))) throw new Error("Git did not install.");
    writeFileSync(join(dest, ".installed-by-anyappagent"), new Date().toISOString());
  }
}

/** The licence file content the Android tools write when the Android SDK licence is accepted. */
export const ANDROID_SDK_LICENSE_HASH = "24333f8a63b6825ea9c5514f83c2829b004d1fee";

function order(id: string): number {
  if (id === "jdk") return 0;
  if (id === "cmdline-tools") return 1;
  if (id === "licenses") return 2;
  if (id.startsWith("sdk:")) return 3;
  if (id === "ninja") return 4;
  return 5;
}
