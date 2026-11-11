# AnyAppAgent

Make your own Android apps from your phone. Describe the app you want, an agent on your PC builds
it, and the finished app installs itself on your phone. Ask for a change, and the new version
installs over the old one.

## How it works

- **The phone app** (`app/`): your apps in a grid. Tap one to open it or to ask for a change. Tap
  New app to make another.
- **The desktop app** (`desktop/`, Windows): sets up your PC (Claude Code, GitHub, the Android
  tools) with a guided onboarding, and runs the companion. You can follow and chat with each app's
  agent from the PC too.
- **The companion** (`server/`): runs one Claude Code session per app over ACP, builds the APK,
  keeps each app in its own private GitHub repository, and sends every new version to the phone.
- **Easy Connect**: the phone reaches your PC from anywhere, not only on the same Wi-Fi.

## Install

1. On your PC, download `AnyAppAgent-Setup.exe` from the
   [latest release](https://github.com/maddada/AnyAppAgent/releases/latest) and follow its setup.
2. On your phone, scan the QR code on the desktop app's home screen, or download
   [AnyAppAgent.apk](https://github.com/maddada/AnyAppAgent/releases/latest/download/AnyAppAgent.apk)
   and open it. Android asks you to allow installing apps from your browser: allow it.
3. In the desktop app, click Connect a phone and scan the code from the phone app.

The installer is not code signed yet, so Windows SmartScreen shows a warning: choose More info,
then Run anyway.

## For developers

Read [`AGENTS.md`](AGENTS.md), [`docs/SPEC.md`](docs/SPEC.md) and
[`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

## License

[MIT](LICENSE). The fonts in `shared/theme/fonts` are under the SIL Open Font License, and the
Lucide icons under their own license (see the files next to them).
