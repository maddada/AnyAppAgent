#!/usr/bin/env bash
# The phone part of the helpers UI proof on a shared emulator, without tapping through screens:
# each screen of the proof copy (com.anyappagent.helperproof) opens by deep link, aimed at that
# package only, for a few seconds per screenshot; the app that was in front gets it back after.
# Usage: phone-links.sh <appId> <stoppedHelperId> [shots folder]
set -u
APP="$1"; STOPPED="$2"
SHOTS="${3:-C:\\aa\\e2e\\helpers}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ADB=/d/tools/android/sdk/platform-tools/adb.exe
SERIAL=emulator-5560
PKG=com.anyappagent.helperproof
T0=$(date +%s)
say() { echo "[$(( $(date +%s) - T0 ))s] $*"; }
api() { node "$HERE/api.mjs" "$@"; }
front() { "$ADB" -s "$SERIAL" shell dumpsys activity activities | grep -m1 topResumedActivity | sed 's/.*u0 //;s/\/.*//'; }
BEFORE=$(front)
open() { # a screen of the proof copy, by deep link to that package only
  "$ADB" -s "$SERIAL" shell am start -W -a android.intent.action.VIEW -d "anyappagent://$1" -p "$PKG" >/dev/null 2>&1
  sleep 3
  [ "$(front)" = "$PKG" ] || { say "ABORT: $PKG is not in front ($(front))"; return 1; }
}
shot() {
  [ "$(front)" = "$PKG" ] || { say "skip $1: $PKG not in front"; return 1; }
  "$ADB" -s "$SERIAL" shell cmd uimode night no >/dev/null; sleep 1.2
  "$ADB" -s "$SERIAL" exec-out screencap -p > "$SHOTS/phone-$1-light.png"
  "$ADB" -s "$SERIAL" shell cmd uimode night yes >/dev/null; sleep 1.2
  "$ADB" -s "$SERIAL" exec-out screencap -p > "$SHOTS/phone-$1-dark.png"
  "$ADB" -s "$SERIAL" shell cmd uimode night no >/dev/null
  say "phone $1 (light, dark)"
}
give_back() { [ -n "$BEFORE" ] && [ "$BEFORE" != "$PKG" ] && "$ADB" -s "$SERIAL" shell monkey -p "$BEFORE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; say "front: $(front)"; }

say "front before: $BEFORE"
api send "$APP" "Two more separate changes, one helper each, both at once please: 1) let me name each person in an uneven split. 2) add a share button that sends the result as text."
api wait "$APP" helpers-working=2 240 || exit 1
mapfile -t IDS < <(api helpers "$APP" | awk '$2=="working"{print $1}')
say "helpers working: ${IDS[*]}"
open "chat/$APP" && shot two-helpers
open "helper/$APP/${IDS[0]}" && shot helper-chat
open "helper/$APP/$STOPPED" && shot helper-stopped
give_back
api helpers "$APP" | tail -2
