# AnyAppAgent desktop (Windows)

The one program a user installs on their PC. It runs the companion (`../server/`) for them, walks
them through setup in plain words, shows their apps, and connects their phone. No terminal anywhere.

## Run it

```
cd desktop
npm install
npm run dev        # development, with hot reload of the window
npm start          # build, then run
npm test           # unit tests (detection of Claude, GitHub, tools; installer helpers)
npm run typecheck
npm run dist       # Windows installer in dist/ (electron-builder, NSIS)
```

Useful environment variables (all optional):

| Variable | Meaning |
| --- | --- |
| `ANYAPP_PORT`, `ANYAPP_STATE_DIR`, `ANYAPP_APPS_DIR`, `ANYAPP_BUILDER`, `ANYAPP_GITHUB` | Passed through to the companion (see `../server/README.md`). Use another port and state folder for tests. |
| `ANYAPP_TOOLS_DIR` | Where "Get the tools" installs (default `%USERPROFILE%\.anyappagent\tools`). |
| `ANYAPP_DESKTOP_COMPANION=fake` | Run `dev/fake-companion.mjs` instead of the real companion. `FAKE_SEED=1` adds example apps. |
| `ANYAPP_DESKTOP_USERDATA` | A separate settings folder (a fresh onboarding) for tests. |
| `ANYAPP_HOST_APK` | The phone app's APK, if not set in Settings, Advanced, and not in `../app/dist/AnyAppAgent.apk`. |
| `ANYAPP_DESKTOP_THEME=light/dark` | Force a theme. |
| `ANYAPP_DESKTOP_DIALOG_FILE` | Dev and proofs only: the file the key backup and restore dialogs answer with, so a script can drive them. |
| `ANYAPP_DESKTOP_SIMULATE` | Dev only, for screenshots: `claude=needed/signing-in,github=needed/code,tools=needed/installing,phone=none`. |
| `ANYAPP_DESKTOP_SHOTS=<folder>` | Dev only: walk every screen in light and dark, save PNGs, quit. `ANYAPP_DESKTOP_SHOTS_SET=flow/states/real`. |

## How it runs the companion

Electron's own executable in Node mode (`ELECTRON_RUN_AS_NODE=1`). Electron 45 embeds Node
24.22, which runs the companion's TypeScript sources directly, so a packaged app needs neither a
Node install nor a bundled `node.exe`. The companion starts the Claude ACP adapter with
`process.execPath`; that is Electron too and inherits `ELECTRON_RUN_AS_NODE`, so it works the same.

The child gets `ANYAPP_ADMIN_TOKEN` (random per launch), `ANYAPP_STOP_ON_STDIN_END=1` with an open
stdin pipe, `ANYAPP_HOST_APK` (the phone app, served at `/download/anyappagent.apk` for the install
QR), `JAVA_HOME` / `ANDROID_HOME` (and `ANYAPP_JAVA_HOME` / `ANYAPP_ANDROID_HOME`) from the tools
step, and PATH entries for tools it installed. It is restarted with back-off if it dies (4 quick
failures in a row show "needs attention") and restarted after the tools install. When the app
quits it closes the companion's stdin and waits up to 20 s for a clean exit (Claude sessions and
the Easy Connect helper included); only then would it end the process tree. If the desktop app
itself dies, the pipe closes and the companion stops by itself. Closing the window keeps
everything running in the tray.

Easy Connect is off in a fresh companion. The phone step of the setup turns it on once (its first
start builds a helper, about two and a half minutes), and the pairing panel shows its `detail`
while it starts. Until it is ready, the same-network QR with address and code works.

## The tools step

Five pieces: the Java kit, the Android kit, Node.js, Git, and the app starter kit (the builder's
dependency cache, `npm ci` of the template into `%USERPROFILE%\.anyappagent\cache\deps-<hash>`).
Detection reads the hash from the builder itself (`builder/lib/template.mjs`), and "Get the tools"
fills a missing cache with `builder/cli.mjs warm` (about 3 minutes, needs the internet), so the
user's first app does not start with a silent wait.

## Layout

- `src/main/`: Electron main process. `index.ts` (window, tray, IPC, lifecycle), `companion.ts`
  (child process), `admin-client.ts` (talks to `/api/admin/*`, with a fallback for a companion
  without the admin routes), `detect/` (Claude, GitHub, tools), `signin.ts` (Claude and GitHub
  sign-in without a terminal), `install/` (the tools installer), `shots.ts` (dev screenshots).
- `src/preload/`: the typed bridge (`window.anyapp`); context isolation on, no Node in the page.
- `src/renderer/`: React. `Onboarding.tsx`, `MainWindow.tsx`, `Pairing.tsx`, `illustrations.tsx`.
- The look comes from the shared theme (`../shared/theme`): the renderer imports its `theme.css`
  (every value is a `--aa-*` variable, fonts bundled by Vite), code reads `tokens.ts`, and the window,
  installer and tray icons are `../shared/theme/mark/windows`. Nothing Workbench-specific lives here.
- `dev/`: the fake companion, the screenshot and proof scripts, `drive.mjs` (drives a running app
  started with `--remote-debugging-port`: click by text, screenshots, eval), and the electron-builder
  afterPack hook (copies only `server/node_modules`; the builder never uses `template/node_modules`).
- `docs/screens/`: screenshots of every screen, light and dark.
