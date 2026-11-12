#!/usr/bin/env bash
# Runs a command as the `agent` Unix user with the agent's environment (docs/CLOUD.md section 6):
# the runner starts the agent, Gradle and the builder through
#   sudo -n -u agent -H /opt/kiwi/agent.sh <command> [args...]
# sudo gives a clean environment; this sets only what the agent's work needs. The AI key is
# Instabox's Secrets proxy placeholder (ibsec_...), never a real key: the proxy swaps it in on the
# way out, so the agent cannot print the key. Installed by cloud/box/provision-v1.sh.
set -euo pipefail
umask 002
export HOME=/home/agent
export USER=agent
export LANG=C.UTF-8
export PATH=/usr/local/bin:/usr/bin:/bin:/opt/npm/bin
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
# The builder's caches (deps cache, spares) shared with the image's warm copy.
export ANYAPP_HOME=/data/shared/anyapp-home
export GRADLE_USER_HOME=/data/shared/gradle
# Instabox's TLS proxy re-signs every HTTPS connection with its own CA.
for ca in /run/instabox/ca.pem /usr/local/share/ca-certificates/instabox-proxy.crt; do
  if [ -r "$ca" ]; then export NODE_EXTRA_CA_CERTS="$ca"; break; fi
done
export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
# The proxy placeholder, written by the runner for this box (readable by the agent on purpose).
if [ -r /opt/kiwi/agent-env ]; then
  # shellcheck disable=SC1091
  . /opt/kiwi/agent-env
fi
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
cd "${KIWI_CWD:-$PWD}" 2>/dev/null || true
exec "$@"
