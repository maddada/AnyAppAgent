#!/usr/bin/env bash
# Runs one git command with a GitHub token read from stdin (the one-repo installation token the
# runner gets from Convex, docs/CLOUD.md section 3). The token goes to git only through
# GIT_CONFIG_* environment variables of this one process: never argv, never a file, never logged.
#   printf %s "$TOKEN" | git-with-token.sh <dir> push origin HEAD:main
#   printf %s "$TOKEN" | git-with-token.sh /data/apps clone https://github.com/o/r.git r
set -euo pipefail
dir=$1
shift
IFS= read -r token || true
[ -n "$token" ] || { echo "no token on stdin" >&2; exit 2; }
basic=$(printf 'x-access-token:%s' "$token" | base64 -w0)
unset token
cd "$dir"
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0="http.https://github.com/.extraHeader" \
GIT_CONFIG_VALUE_0="Authorization: Basic $basic" \
GIT_TERMINAL_PROMPT=0 \
  exec git "$@"
