#!/usr/bin/env bash
# Starts the Kiwimake test emulator on Linux or macOS (the counterpart of start-emulator.ps1) and waits until
# Android has booted. Safe to call any number of times: returns at once when it is already up.
#
#   scripts/start-emulator.sh [--name anyapp] [--timeout 300] [--cold-boot]
#
# AVD "anyapp": Pixel 7, Android 15 (API 35) WITH Google Play (google_apis_playstore, x86_64), so
# Play Protect behaves as on a real phone. adb serial emulator-5560 (console port fixed at 5560).
# The AVD is created on first use. The emulator is started in its own session (setsid), so it keeps
# running after the agent shell that started it exits (docs/ENVIRONMENT.md, pitfall 4).
# macOS on Apple silicon uses the arm64-v8a image (x86_64 images do not run there). ANYAPP_AVD_IMAGE
# picks another system image (it must be installed in the SDK).
set -eu
name=anyapp
timeout=300
cold=
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name=$2; shift 2 ;;
    --timeout) timeout=$2; shift 2 ;;
    --cold-boot) cold=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$name" in
  anyapp) port=5560 ;;
  anyapp2) port=5562 ;;
  *) echo "--name must be anyapp or anyapp2" >&2; exit 2 ;;
esac

tools="${ANYAPP_TOOLS_DIR:-$HOME/.anyappagent/tools}"
export JAVA_HOME="${JAVA_HOME:-$tools/jdk}"
export ANDROID_HOME="${ANDROID_HOME:-$tools/android-sdk}" ANDROID_SDK_ROOT="${ANDROID_HOME:-$tools/android-sdk}"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$tools/avd}"
adb="$ANDROID_HOME/platform-tools/adb"
serial="emulator-$port"
abi=x86_64
[ "$(uname -s)-$(uname -m)" = Darwin-arm64 ] && abi=arm64-v8a
image="${ANYAPP_AVD_IMAGE:-system-images;android-35;google_apis_playstore;$abi}"
# BSD sed (macOS) needs an explicit empty backup suffix after -i.
sedi() { if [ "$(uname -s)" = Darwin ]; then sed -i '' "$@"; else sed -i "$@"; fi; }
logs="$tools/logs"
mkdir -p "$ANDROID_AVD_HOME" "$logs"

booted() { [ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; }

if booted; then echo "$name is up ($serial)"; exit 0; fi

if [ ! -f "$ANDROID_AVD_HOME/$name.ini" ]; then
  echo "Creating AVD $name (${image})…"
  echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n "$name" -k "$image" -d pixel_7 >/dev/null
  cfg="$ANDROID_AVD_HOME/$name.avd/config.ini"
  sedi -e 's/^hw.ramSize=.*/hw.ramSize=4096/' -e 's/^hw.keyboard=.*/hw.keyboard=yes/' -e 's/^disk.dataPartition.size=.*/disk.dataPartition.size=12G/' "$cfg"
  grep -q '^hw.cpu.ncore=' "$cfg" && sedi 's/^hw.cpu.ncore=.*/hw.cpu.ncore=4/' "$cfg" || echo 'hw.cpu.ncore=4' >>"$cfg"
  grep -q '^hw.gpu.enabled=' "$cfg" && sedi 's/^hw.gpu.enabled=.*/hw.gpu.enabled=yes/' "$cfg" || echo 'hw.gpu.enabled=yes' >>"$cfg"
fi

if ! pgrep -f -- "-avd $name( |$)" >/dev/null; then
  echo "Starting $name on port ${port}…"
  if command -v setsid >/dev/null; then
    setsid -f "$ANDROID_HOME/emulator/emulator" -avd "$name" -port "$port" -gpu auto ${cold:+-no-snapshot-load} \
      >"$logs/$name-emulator-stdout.log" 2>"$logs/$name-emulator-stderr.log" </dev/null
  else
    # macOS has no setsid command: Perl's POSIX::setsid gives the emulator its own session.
    perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die' "$ANDROID_HOME/emulator/emulator" -avd "$name" -port "$port" -gpu auto ${cold:+-no-snapshot-load} \
      >"$logs/$name-emulator-stdout.log" 2>"$logs/$name-emulator-stderr.log" </dev/null &
  fi
fi

"$adb" start-server >/dev/null 2>&1 || true
start=$(date +%s)
until booted; do
  if [ $(( $(date +%s) - start )) -ge "$timeout" ]; then
    echo "$name did not finish booting within ${timeout}s (logs: $logs/$name-emulator-*.log)" >&2
    exit 1
  fi
  sleep 3
done
echo "$name is up ($serial) after $(( $(date +%s) - start ))s"
