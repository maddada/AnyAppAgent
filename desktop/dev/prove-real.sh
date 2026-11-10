#!/usr/bin/env bash
# Proves the desktop app against the REAL companion (server/), on its own port and state folder:
# starts the app, plays a phone (pairs with the 6-digit code, creates an app over HTTP), lets the
# app capture screens, then checks that quitting the app also stopped the companion.
#   bash dev/prove-real.sh <screens-folder>
# APP_CMD runs another build of the app, e.g. APP_CMD=dist/win-unpacked/AnyAppAgent.exe (packaged).
# PROOF_PORT and PROOF_DIR pick another port and folder name.
set -u
OUT="${1:?screens folder}"
PORT=${PROOF_PORT:-8941}
NAME=${PROOF_DIR:-aad-real}
ROOT="$(cygpath -w "$TEMP")\\$NAME"
rm -rf "$TEMP/$NAME"; mkdir -p "$TEMP/$NAME"
export ANYAPP_PORT=$PORT ANYAPP_STATE_DIR="$ROOT\state" ANYAPP_APPS_DIR="$ROOT\apps"
export ANYAPP_BUILDER=fake ANYAPP_GITHUB=off ANYAPP_DESKTOP_USERDATA="$ROOT\ud"
export ANYAPP_DESKTOP_SHOTS="$OUT" ANYAPP_DESKTOP_SHOTS_SET=real ANYAPP_DESKTOP_SHOTS_SETTLE_MS=8000
${APP_CMD:-npx electron .} > "$TEMP/$NAME/electron.out" 2>&1 &
EPID=$!
echo "desktop started (shell pid $EPID)"
for i in $(seq 1 120); do [ -f "$TEMP/$NAME/state/pairing-code.txt" ] && break; sleep 1; done
CPID=$(grep -o "started pid [0-9]*" "$TEMP/$NAME/ud/logs/desktop.log" | head -1 | awk '{print $3}')
echo "companion pid: $CPID"
curl -s "http://127.0.0.1:$PORT/api/health"; echo
sleep 14   # the app reaches the pairing screen first
CODE=$(tr -d '\r\n ' < "$TEMP/$NAME/state/pairing-code.txt")
TOKEN=$(curl -s -X POST "http://127.0.0.1:$PORT/api/pair" -H 'content-type: application/json' -d "{\"code\":\"$CODE\",\"deviceName\":\"Proof Phone\"}" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
echo "paired: token ${TOKEN:0:6}…"
sleep 6
curl -s -X POST "http://127.0.0.1:$PORT/api/apps" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Tap Counter","prompt":"A very simple counter app: one big plus button and the number in the middle. Keep it tiny, do not add anything else."}' | head -c 300; echo
wait $EPID
echo "desktop exited"
sleep 2
if [ -n "$CPID" ] && tasklist //FI "PID eq $CPID" | grep -q "$CPID"; then echo "COMPANION STILL RUNNING (pid $CPID)"; else echo "companion pid $CPID is gone"; fi
curl -s -m 3 "http://127.0.0.1:$PORT/api/health" && echo "PORT STILL ANSWERS" || echo "port $PORT closed"
grep -E "\[companion\]|\[desktop\]|\[shots\]|admin routes" "$TEMP/$NAME/ud/logs/desktop.log" | tail -30
grep -q "stopped cleanly" "$TEMP/$NAME/ud/logs/desktop.log" && echo "graceful stop: yes (stdin closed, companion exited by itself)" || echo "graceful stop: NO"
LEFT=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*$NAME*' -and \$_.Name -notmatch 'bash|powershell' }).Count")
echo "processes still mentioning the proof folder: ${LEFT:-0}"
