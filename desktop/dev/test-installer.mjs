// Artifact-only installer for an isolated smoke test. Different identity means NSIS cannot
// upgrade, stop, or unregister a user's Kiwimake installation. Never publish this artifact.
// The installer must not share the app executable's name: on an upgrade the old uninstaller closes
// every running process with that name, which would end this installer (exit 1, nothing installed).
import { build, Platform } from "electron-builder";
await build({ targets: Platform.WINDOWS.createTarget("nsis"), publish: "never", config: {
  appId: "com.anyappagent.desktop.size-test",
  productName: "Kiwimake Size Test",
  executableName: "Kiwimake-Size-Test",
  directories: { output: "dist-test" },
  win: { signExecutable: false },
  nsis: { guid: "48e06c48-4078-4322-b22d-172d2fd155e3", artifactName: "Kiwimake-Size-Test-Setup.exe", shortcutName: "Kiwimake Size Test", createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false },
} });
