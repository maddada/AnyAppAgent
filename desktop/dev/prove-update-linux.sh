#!/usr/bin/env bash
# Proves the AppImage updates itself end to end (docs/RELEASING.md, "Updates of the desktop app"):
# an older Kiwimake, started with its own state folder, apps folder and port, finds the newer one in a
# stand-in feed on this PC, downloads and checks it, shows "Restart to update", and after the click
# replaces its own file, starts the new version on the same port and keeps its settings and state.
# Never uses port 8787, ~/.anyappagent or ~/.cache, so it is safe next to a running Kiwimake.
#   dev/prove-update-linux.sh <older AppImage> <newer AppImage> <newer version> [screenshot folder]
set -euo pipefail
[ $# -ge 3 ] || { echo "usage: $0 <older AppImage> <newer AppImage> <newer version> [screenshot folder]" >&2; exit 2; }
old="$(realpath "$1")"
new="$(realpath "$2")"
version="$3"
shots="${4:-}"
desktop="$(cd "$(dirname "$0")/.." && pwd)"
port="${KIWIMAKE_PROOF_PORT:-8798}"
feed_port="${KIWIMAKE_PROOF_FEED_PORT:-8796}"
cdp="${KIWIMAKE_PROOF_CDP_PORT:-9334}"
[ "$port" != 8787 ] || { echo "Use a port other than 8787." >&2; exit 2; }
work="$(mktemp -d)"
image="$work/Kiwimake-x86_64.AppImage"
mkdir -p "$work/state/desktop" "$work/apps" "$work/feed" "$work/cache"
cp "$old" "$image"
cp "$new" "$work/feed/Kiwimake-x86_64.AppImage"
# The stand-in feed: the newer AppImage only (dev/update-feed.mjs's format; a release lists the .deb too).
node --input-type=module -e "
  import { feedYaml, sha512 } from '$desktop/dev/update-feed.mjs';
  import { statSync, writeFileSync } from 'node:fs';
  const f = '$work/feed/Kiwimake-x86_64.AppImage';
  writeFileSync('$work/feed/latest-linux.yml', feedYaml({ version: '$version', files: [{ name: 'Kiwimake-x86_64.AppImage', size: statSync(f).size, sha512: sha512(f) }], releaseDate: new Date().toISOString() }));
"
# Past the setup steps, so the apps list (and its update notice) shows.
printf '{ "onboardingDone": true, "hexSkipped": true, "githubSkipped": true }\n' > "$work/state/desktop/settings.json"

python3 -m http.server "$feed_port" --bind 127.0.0.1 --directory "$work/feed" > "$work/feed.log" 2>&1 &
feed_pid=$!

setsid env -i HOME="$HOME" USER="${USER:-$(id -un)}" LOGNAME="${USER:-$(id -un)}" SHELL="${SHELL:-/bin/bash}" \
  PATH=/usr/bin:/bin LANG="${LANG:-C.UTF-8}" XDG_CACHE_HOME="$work/cache" \
  ${DISPLAY:+DISPLAY="$DISPLAY"} ${XAUTHORITY:+XAUTHORITY="$XAUTHORITY"} ${WAYLAND_DISPLAY:+WAYLAND_DISPLAY="$WAYLAND_DISPLAY"} \
  ${XDG_RUNTIME_DIR:+XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"} ${DBUS_SESSION_BUS_ADDRESS:+DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"} \
  ANYAPP_STATE_DIR="$work/state" ANYAPP_APPS_DIR="$work/apps" ANYAPP_PORT="$port" ANYAPP_ENGINE_UPDATES=off \
  ANYAPP_UPDATE_FEED="http://127.0.0.1:$feed_port/" ANYAPP_UPDATE_FIRST_CHECK_MS=3000 \
  "$image" --remote-debugging-port="$cdp" > "$work/output.log" 2>&1 < /dev/null &
pid=$!
log="$work/state/desktop/logs/desktop.log"

stop() {
  kill -TERM -- "-$pid" 2>/dev/null || true
  # The new copy runs in a session of its own (electron-updater starts it detached).
  pkill -TERM -f "$work/" 2>/dev/null || true
  sleep 3
  pkill -KILL -f "$work/" 2>/dev/null || true
  kill "$feed_pid" 2>/dev/null || true
  [ -n "${KIWIMAKE_PROOF_KEEP:-}" ] && echo "kept: $work" || rm -rf "$work"
}
trap stop EXIT

health() { curl -fsS "http://127.0.0.1:$port/api/health" > /dev/null 2>&1; }
wait_for() { # <seconds> <what> <command...>
  local n="$1" what="$2"
  shift 2
  for _ in $(seq 1 "$n"); do "$@" && return 0; sleep 1; done
  echo "Timed out waiting for: $what" >&2
  tail -30 "$log" >&2 || true
  exit 1
}
drive() { node "$desktop/dev/drive.mjs" --port "$cdp" "$@"; }

wait_for 120 "the older copy's companion" health
old_version="$(grep -o '\[desktop\] start [0-9.]*' "$log" | head -1 | awk '{print $3}')"
echo "started: Kiwimake $old_version from $image, companion on port $port"
# State the update must keep: every file the companion and the desktop wrote (not caches or logs),
# and the content of those that do not change while it runs (keys, pairing, config).
# The companion rewrites a few at every start: the pairing code, the `anyapp` launchers (they name
# the AppImage's mount folder) and its download cache; those only have to be there.
state_files() { ( cd "$work/state" && find . -type f ! -path './desktop/*' ! -path './tools/*' ! -path './cache/*' ! -name '*.log' | sort ); }
state_files > "$work/files-before.txt"
( cd "$work/state" && grep -vE '^\./(bin/|pairing-code\.txt$)' "$work/files-before.txt" | xargs -r -d '\n' sha256sum ) > "$work/sums-before.txt"
drive wait "is ready" 120
echo "notice: $(drive eval 'document.querySelector("[data-testid=update-notice]")?.innerText')"
[ -z "$shots" ] || { mkdir -p "$shots"; drive shot "$shots/update-ready.png" > /dev/null; drive --theme dark shot "$shots/update-ready-dark.png" > /dev/null; }
grep -E "\[update\]" "$log" | tail -5
if [ -n "$shots" ]; then
  drive click "Settings" > /dev/null
  drive eval '[...document.querySelectorAll("h2")].find((h) => h.textContent === "Updates")?.scrollIntoView({ block: "start" })' > /dev/null
  drive shot "$shots/settings-updates.png" > /dev/null
  drive click "Apps" > /dev/null
fi
cp "$work/state/desktop/settings.json" "$work/settings-before.json"
drive click "Restart to update"
wait_for 60 "the older copy to leave" bash -c "! kill -0 $pid 2>/dev/null"
wait_for 120 "Kiwimake $version to start" grep -q "\[desktop\] start $version " "$log"
wait_for 120 "the new copy's companion" health
cmp "$image" "$work/feed/Kiwimake-x86_64.AppImage"
echo "the AppImage at $image is now the $version file (same path and name)"
missing="$(comm -23 "$work/files-before.txt" <(state_files))"
[ -z "$missing" ] || { echo "Files gone after the update: $missing" >&2; exit 1; }
( cd "$work/state" && sha256sum -c --quiet "$work/sums-before.txt" )
cmp "$work/settings-before.json" "$work/state/desktop/settings.json"
echo "state kept: all $(wc -l < "$work/files-before.txt") state files still there ($(paste -sd' ' "$work/files-before.txt")), $(wc -l < "$work/sums-before.txt") byte for byte, settings.json byte for byte"
[ -z "$shots" ] || { sleep 3; echo "(the new copy was started without a debugging port, so no screenshot of it)"; }
grep -E "\[desktop\] (start|restarting to update)|\[update\] (installing|installer)" "$log"
echo "PROVED: $old_version updated itself to $version and its companion answers again on port $port."
