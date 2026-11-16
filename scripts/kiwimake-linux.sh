#!/usr/bin/env bash
# Runs the Kiwimake desktop app from this checkout on Linux (development): builds the latest code,
# then opens it. The desktop app runs the companion (port 8787) for the phone.
# Extra arguments go to the app, e.g. --hidden to start in the tray.
set -eu
here="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$here/desktop"
[ -d node_modules ] || npm ci --no-audit --no-fund
[ -x node_modules/electron/dist/electron ] || node node_modules/electron/install.js
npx electron-vite build >/dev/null
exec node_modules/electron/dist/electron . "$@"
