#!/usr/bin/env bash
# Starts the spike's runner with fixed arguments; stdin (the secrets JSON) goes straight to it.
# Called as one word (`bash /opt/anyapp/cloud/runner/start.sh <convex-site-url>`), so no quoting
# on the way can turn stdin into a script for another program.
set -euo pipefail
site=${1:?convex site url}
[[ $site =~ ^https://[a-z0-9-]+\.convex\.site$ ]] || { echo "bad convex site url" >&2; exit 2; }
exec node /opt/anyapp/cloud/runner/spike-runner.mjs --convex "$site" --app /data/apps/spike --once
