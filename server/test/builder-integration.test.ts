import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BuildProgress, isEnvironmentFailure, plainBuildError } from "../src/build-progress.ts";
import { REPO_DIR } from "../src/config.ts";
import { fromEnvScript } from "../src/toolchain.ts";

describe("toolchain from scripts/android-env.ps1", () => {
  it("reads JAVA_HOME and ANDROID_HOME the way the script sets them", () => {
    const text = readFileSync(join(REPO_DIR, "scripts", "android-env.ps1"), "utf8");
    expect(fromEnvScript(text)).toEqual({ javaHome: join("D:\\tools\\android", "jdk"), androidHome: join("D:\\tools\\android", "sdk") });
  });

  it("also reads literal assignments", () => {
    expect(fromEnvScript("$env:JAVA_HOME = 'C:\\jdk'\n$env:ANDROID_HOME = 'C:\\sdk'\n")).toEqual({ javaHome: "C:\\jdk", androidHome: "C:\\sdk" });
  });
});

describe("BuildProgress", () => {
  it("turns builder lines into plain steps that only move forward", () => {
    const p = new BuildProgress(true);
    expect(p.text).toBe("Getting things ready");
    expect(p.line("Building com.anyapp.x #1 in C:\\aa\\apps\\x")).toBe(false);
    expect(p.line("Generating the native project (expo prebuild)…")).toBe(true);
    expect(p.text).toBe("Preparing your app's settings");
    expect(p.line("Running Gradle assembleRelease…")).toBe(true);
    expect(p.text).toBe("Putting your app together. The first time takes a few minutes");
    expect(p.line("> Task :app:configureCMakeRelWithDebInfo[x86_64]")).toBe(true);
    expect(p.line("> Task :app:createBundleReleaseJsAndAssets")).toBe(true);
    expect(p.text).toBe("Packing in your app's screens");
    expect(p.line("> Task :expo-modules-core:compileReleaseKotlin")).toBe(false);
    expect(p.line("> Task :app:packageRelease")).toBe(true);
    expect(p.line("APK ready: C:\\aa\\apps\\x\\build\\apk\\x-1.apk (55.0 MB) in 290.1s")).toBe(true);
    expect(p.text).toBe("Checking the new version");
  });

  it("never shows tool output", () => {
    const p = new BuildProgress(false);
    for (const line of ["BUILD SUCCESSFUL in 25s", "w: warning: deprecated", "> Configure project :app", "npm warn deprecated"]) p.line(line);
    expect(p.text).toBe("Getting things ready");
    p.line("Running Gradle assembleRelease…");
    expect(p.text).toBe("Putting your app together");
  });
});

describe("plain build errors", () => {
  it("says one plain sentence per kind of failure", () => {
    expect(plainBuildError("Build #3 failed.\nsrc/App.tsx(4,7): error TS2322: Type 'string' is not assignable")).toBe("A mistake in the app's code stopped the build.");
    expect(plainBuildError("Build #3 failed.\nMetro: Unable to resolve module ./x")).toBe("A mistake in the app's code stopped the build.");
    expect(plainBuildError("Build #3 failed.\n* What went wrong: Execution failed for task ':app:compileReleaseKotlin'")).toBe("The app could not be put together.");
    expect(isEnvironmentFailure("buildApk: a build of C:\\aa\\apps\\x is already running")).toBe(true);
    expect(isEnvironmentFailure("error TS2322")).toBe(false);
  });
});
