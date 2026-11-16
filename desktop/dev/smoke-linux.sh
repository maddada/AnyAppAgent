#!/usr/bin/env bash
# Starts a built Linux Kiwimake the way a desktop launcher does (bare PATH, its own state folder,
# apps folder and port), waits until its companion answers, then stops it. Never uses port 8787 or
# ~/.anyappagent, so it is safe next to a running Kiwimake.
#   dev/smoke-linux.sh dist/Kiwimake-x86_64.AppImage
#   dev/smoke-linux.sh /opt/Kiwimake/kiwimake          (after installing the .deb)
# In CI, run it under `xvfb-run -a`.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <kiwimake executable or AppImage> [args...]" >&2; exit 2; }
port="${KIWIMAKE_SMOKE_PORT:-8797}"
[ "$port" != 8787 ] || { echo "Use a port other than 8787." >&2; exit 2; }
work="$(mktemp -d)"
mkdir -p "$work/state" "$work/apps"

setsid env -i HOME="$HOME" USER="${USER:-$(id -un)}" LOGNAME="${USER:-$(id -un)}" SHELL="${SHELL:-/bin/bash}" \
  PATH=/usr/bin:/bin LANG="${LANG:-C.UTF-8}" \
  ${DISPLAY:+DISPLAY="$DISPLAY"} ${XAUTHORITY:+XAUTHORITY="$XAUTHORITY"} ${WAYLAND_DISPLAY:+WAYLAND_DISPLAY="$WAYLAND_DISPLAY"} \
  ${XDG_RUNTIME_DIR:+XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"} ${DBUS_SESSION_BUS_ADDRESS:+DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"} \
  ${APPIMAGE_EXTRACT_AND_RUN:+APPIMAGE_EXTRACT_AND_RUN="$APPIMAGE_EXTRACT_AND_RUN"} \
  ANYAPP_STATE_DIR="$work/state" ANYAPP_APPS_DIR="$work/apps" ANYAPP_PORT="$port" ANYAPP_ENGINE_UPDATES=off \
  "$@" >"$work/output.log" 2>&1 </dev/null &
pid=$!

stop() {
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -KILL -- "-$pid" 2>/dev/null || true
  [ -n "${KIWIMAKE_SMOKE_KEEP:-}" ] || rm -rf "$work"
}
trap stop EXIT

answered=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then answered=1; break; fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
log="$work/state/desktop/logs/desktop.log"
grep -E "\[desktop\] (start|shell environment)|Android tools" "$log" 2>/dev/null || true
if [ "$answered" != 1 ]; then
  echo "Kiwimake's companion did not answer on port $port." >&2
  tail -40 "$work/output.log" >&2 || true
  tail -40 "$log" >&2 || true
  exit 1
fi
# The AppImage's launcher adds --no-sandbox only where user namespaces are blocked (Ubuntu 23.10+ AppArmor).
for p in $(pgrep -s "$pid" 2>/dev/null || true); do
  cmd="$( { tr '\0' ' ' <"/proc/$p/cmdline"; } 2>/dev/null || true)"
  case "$cmd" in
    *--type=*|*.mjs*|"") ;;
    *kiwimake*) echo "app process: ${cmd:0:200}"; break ;;
  esac
done
echo "Kiwimake started and its companion answered on port $port."
