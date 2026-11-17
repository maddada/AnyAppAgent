#!/usr/bin/env bash
# Checks the Mac build in dist/ the way a Mac that downloaded it would (docs/RELEASING.md, macOS):
# the app inside each disk image and each zip is signed with Kiwimake's Developer ID, with hardened
# runtime, notarized and stapled, and Gatekeeper accepts it; each disk image is signed, notarized and
# stapled too. Prints what it checked; exits non-zero on the first failure.
#   dev/verify-mac.sh [--adhoc] [arm64] [x64]
# --adhoc: only checks the signatures are intact (an ad-hoc build is neither Developer ID nor notarized).
set -euo pipefail
cd "$(dirname "$0")/.."
adhoc=0
archs=()
for a in "$@"; do
  case "$a" in
    --adhoc) adhoc=1 ;;
    arm64|x64) archs+=("$a") ;;
    *) echo "usage: $0 [--adhoc] [arm64] [x64]" >&2; exit 2 ;;
  esac
done
[ ${#archs[@]} -gt 0 ] || archs=(arm64 x64)
team="${KIWIMAKE_APPLE_TEAM_ID:-KTKP595G3B}"
authority="Developer ID Application: Mohamad Youssef ($team)"
work="$(mktemp -d)"
mounted=""
cleanup() {
  [ -z "$mounted" ] || hdiutil detach "$mounted" -quiet || true
  rm -rf "$work"
}
trap cleanup EXIT

# Never `cmd | grep -q` here: with pipefail, grep leaving at the first match makes the writer fail
# with SIGPIPE (exit 141) and the check fail although it matched. Read the output first.
check_app() { # <Kiwimake.app> <arch> <where>
  local app="$1" arch="$2" where="$3"
  codesign --verify --deep --strict --verbose=2 "$app"
  local info
  info="$(codesign -dvv "$app" 2>&1)"
  local kind ents
  kind="$(file "$app/Contents/MacOS/Kiwimake")"
  grep -q "$([ "$arch" = x64 ] && echo x86_64 || echo arm64)" <<<"$kind" || { echo "$where: not a $arch app" >&2; exit 1; }
  if [ "$adhoc" = 1 ]; then
    echo "ok: $where is intact (ad-hoc signed, $arch)"
    return
  fi
  grep -qF "Authority=$authority" <<<"$info" || { echo "$where: not signed by $authority" >&2; grep Authority <<<"$info" >&2; exit 1; }
  grep -qF "TeamIdentifier=$team" <<<"$info" || { echo "$where: team is not $team" >&2; exit 1; }
  grep -Eq "flags=0x[0-9a-f]*\(runtime\)" <<<"$info" || { echo "$where: hardened runtime is off" >&2; exit 1; }
  grep -q "Timestamp=" <<<"$info" || { echo "$where: no secure timestamp" >&2; exit 1; }
  # The companion runs as Electron in Node mode and loads native modules: the entitlements must be there.
  ents="$(codesign -d --entitlements - --xml "$app" 2>/dev/null)"
  grep -q "com.apple.security.cs.disable-library-validation" <<<"$ents" || { echo "$where: entitlements missing" >&2; exit 1; }
  spctl --assess --type execute --verbose=2 "$app"
  xcrun stapler validate "$app"
  echo "ok: $where is Developer ID signed ($team), hardened, notarized and stapled ($arch)"
}

for arch in "${archs[@]}"; do
  dmg="dist/Kiwimake-mac-$arch.dmg"
  zip="dist/Kiwimake-mac-$arch.zip"
  [ -f "$dmg" ] && [ -f "$zip" ] || { echo "missing $dmg or $zip" >&2; exit 1; }
  if [ "$adhoc" = 0 ]; then
    codesign --verify --strict --verbose=2 "$dmg"
    dmg_info="$(codesign -dvv "$dmg" 2>&1)"
    grep -qF "Authority=$authority" <<<"$dmg_info" || { echo "$dmg: not signed by $authority" >&2; exit 1; }
    spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
    xcrun stapler validate "$dmg"
    echo "ok: $dmg is Developer ID signed, notarized and stapled"
  fi
  mounted="$work/mnt-$arch"
  mkdir -p "$mounted"
  hdiutil attach "$dmg" -nobrowse -readonly -noautoopen -mountpoint "$mounted" -quiet
  check_app "$mounted/Kiwimake.app" "$arch" "$dmg: Kiwimake.app"
  hdiutil detach "$mounted" -quiet
  mounted=""
  # The updater's zip, unpacked the way Squirrel.Mac does (ditto keeps the framework symlinks).
  mkdir -p "$work/zip-$arch"
  ditto -x -k "$zip" "$work/zip-$arch"
  check_app "$work/zip-$arch/Kiwimake.app" "$arch" "$zip: Kiwimake.app"
done
