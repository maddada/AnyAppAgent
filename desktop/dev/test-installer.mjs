// Artifact-only installer for an isolated smoke test. Different identity means NSIS cannot
// upgrade, stop, or unregister a user's Kiwimake installation. Never publish this artifact.
import { build, Platform } from "electron-builder";
await build({ targets: Platform.WINDOWS.createTarget("nsis"), publish: "never", config: {
  appId: "com.anyappagent.desktop.size-test",
  productName: "Kiwimake Size Test",
  executableName: "Kiwimake-Size-Test",
  directories: { output: "dist-test" },
  win: { signExecutable: false },
  nsis: { guid: "48e06c48-4078-4322-b22d-172d2fd155e3", artifactName: "Kiwimake-Size-Test.exe", shortcutName: "Kiwimake Size Test", createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false },
} });
