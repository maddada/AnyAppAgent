#!/usr/bin/env bash
# The helpers UI proof (docs/APP-COORDINATOR.md): one companion on its own port and state folder,
# its own desktop app (started with --remote-debugging-port=9339) and the phone app on
# emulator-5560, paired with it and showing the app's chat. Takes light and dark screenshots of
# both sides at each moment, while two helpers work at the same time.
# Usage: run-helpers-proof.sh <appId> [shots folder]
set -u
APP="$1"
SHOTS="${2:-C:\\aa\\e2e\\helpers}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APPDIR="$HERE/../../../app"
ADB=/d/tools/android/sdk/platform-tools/adb.exe
SERIAL=emulator-5560
T0=$(date +%s)
say() { echo "[$(( $(date +%s) - T0 ))s] $*"; }
desk() { node "$HERE/desk.mjs" "$@"; }
api() { node "$HERE/api.mjs" "$@"; }
ui() { node "$APPDIR/dev/ui.mjs" --serial "$SERIAL" "$@"; }
latest() { ui tap jump-to-latest >/dev/null 2>&1; sleep 1; }
phone_tap_row() { # scrolls up until the helper's row is on screen, then taps it
  latest
  for i in 1 2 3 4 5 6; do
    ui tap "helper-row-$1" >/dev/null 2>&1 && return 0
    "$ADB" -s "$SERIAL" shell input swipe 540 900 540 1700 300
    sleep 1
  done
  return 1
}
phone_shot() { # name: light and dark (the app follows the phone's dark mode)
  "$ADB" -s "$SERIAL" shell cmd uimode night no >/dev/null; sleep 1.5
  "$ADB" -s "$SERIAL" exec-out screencap -p > "$SHOTS/phone-$1-light.png"
  "$ADB" -s "$SERIAL" shell cmd uimode night yes >/dev/null; sleep 1.5
  "$ADB" -s "$SERIAL" exec-out screencap -p > "$SHOTS/phone-$1-dark.png"
  "$ADB" -s "$SERIAL" shell cmd uimode night no >/dev/null
  say "phone $1 (light, dark)"
}
desk_shot() {
  desk shot "$SHOTS\\desktop-$1-light.png" light >/dev/null
  desk shot "$SHOTS\\desktop-$1-dark.png" dark >/dev/null
  desk shot "$SHOTS\\desktop-$1-light.png" light >/dev/null # back to light for the next clicks
  say "desktop $1 (light, dark)"
}
working() { api helpers "$APP" | awk '$2=="working"||$2=="waiting"||$2=="building"{n++} END{print n+0}'; }

say "1. two changes at once"
api send "$APP" "Two separate changes, one helper each, both at once please: 1) add a History screen that keeps the last 10 bills with the date, the total and what each person paid, opened from a small button on the main screen. 2) add a Settings screen where I pick the currency symbol and the default tip, kept between launches."
api wait "$APP" helpers-working=2 240 || exit 1
mapfile -t IDS < <(api helpers "$APP" | awk '$2=="working"{print $1}')
A="${IDS[0]}"; B="${IDS[1]}"
say "helpers working: $A $B"

say "2. the main chat answers while both helpers work"
SEQ=$(api lastseq "$APP")
api send "$APP" "Quick question while they work: what colour is the big panel that shows what each person pays? One sentence."
api wait "$APP" "replied-after=$SEQ" 120
say "helpers still at work: $(working)"
api helpers "$APP"
desk click '[data-testid="helper-close"]' >/dev/null
sleep 1
desk_shot two-helpers
latest
phone_shot two-helpers

say "3. a helper's chat, on both sides"
desk click "[data-testid=\"helper-row-$A\"]" >/dev/null; sleep 2
desk_shot helper-chat
phone_tap_row "$A" || say "phone: row $A not found"
sleep 2
phone_shot helper-chat

say "4. stop helper $B from its own Stop (desktop)"
desk click "[data-testid=\"helper-row-$B\"]" >/dev/null; sleep 2
say "click Stop: $(desk click '[data-testid="helper-stop"]')"
for i in $(seq 1 40); do api helpers "$APP" | grep -q "^$B stopped" && break; sleep 1; done
api helpers "$APP"
sleep 2
desk_shot helper-stopped
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_BACK; sleep 1
phone_tap_row "$B" || say "phone: row $B not found"
sleep 2
phone_shot helper-stopped
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_BACK; sleep 1
latest
phone_shot main-after-stop
desk click '[data-testid="helper-close"]' >/dev/null; sleep 1
desk_shot main-after-stop
say "helpers at work now: $(working)"
say "done"
