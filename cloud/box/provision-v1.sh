#!/usr/bin/env bash
# The box image v1 (docs/CLOUD.md section 3), on top of anyapp-box-v0 (the spike's image): run on a
# box made from v0 as its login user, then save the box as `anyapp-box-v1`
# (`node cloud/scripts/box.mjs snapshot <id> anyapp-box-v1`). It adds:
#   - the Unix users' split (section 6): the runner is the login user; the agent, Gradle and the
#     builder run as `agent` (no sudo) through /opt/kiwi/agent.sh; both share the `kiwi` group for
#     the apps folder only;
#   - the shared caches the agent's builds use (Gradle, the builder's deps cache);
#   - the companion's dependencies (server/package-lock.json) the runner bundle links to.
# Expects /tmp/kiwi-v1/{agent.sh,package.json,package-lock.json} uploaded first.
set -euo pipefail
me=$(id -un)
src=/tmp/kiwi-v1

sudo groupadd -f kiwi
sudo usermod -aG kiwi "$me"
sudo usermod -aG kiwi agent
sudo usermod -g kiwi agent
# The agent never gets sudo.
if sudo -l -U agent 2>/dev/null | grep -q "may run"; then echo "agent has sudo rights: refusing" >&2; exit 1; fi

# The apps: the agent's, group-writable for the runner (setgid keeps the group on new files).
sudo mkdir -p /data/apps /data/shared /data/kiwi /opt/kiwi
sudo chown agent:kiwi /data/apps && sudo chmod 2775 /data/apps
# The runner's own state: nobody else reads it.
sudo chown "$me:$me" /data/kiwi && sudo chmod 700 /data/kiwi

# Shared caches, moved out of the login user's home (the spike warmed them there).
move_shared() {
  local from=$1 to=$2
  if [ -d "$from" ] && [ ! -L "$from" ]; then sudo rm -rf "$to"; sudo mv "$from" "$to"; fi
  sudo mkdir -p "$to"
  # The agent owns them: Gradle replaces files in its cache, which group rights do not allow.
  sudo chown -R agent:kiwi "$to"
  sudo chmod -R g+rwX "$to"
  sudo find "$to" -type d -exec chmod g+s {} +
  ln -sfn "$to" "$from"
}
move_shared "$HOME/.gradle" /data/shared/gradle
move_shared "$HOME/.anyappagent" /data/shared/anyapp-home
# The SDK: the agent's builds may accept licences or add a build tool.
sudo chgrp -R kiwi /opt/android-sdk && sudo chmod -R g+rwX /opt/android-sdk

# The agent's wrapper (sudo -n -u agent -H /opt/kiwi/agent.sh <command>).
sudo install -o root -g root -m 755 "$src/agent.sh" /opt/kiwi/agent.sh
sudo touch /opt/kiwi/agent-env && sudo chown "$me:kiwi" /opt/kiwi/agent-env && sudo chmod 640 /opt/kiwi/agent-env
sudo mkdir -p /home/agent/.claude && sudo chown -R agent:kiwi /home/agent

# The runner pushes from the agent's folders as itself.
git config --global safe.directory '*'

# The companion's dependencies, once, for runner bundles with the same lock file.
sudo mkdir -p /opt/kiwi/server-deps && sudo chown "$me:$me" /opt/kiwi/server-deps
cp "$src/package.json" "$src/package-lock.json" /opt/kiwi/server-deps/
(cd /opt/kiwi/server-deps && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
sha256sum /opt/kiwi/server-deps/package-lock.json | cut -d' ' -f1 > /opt/kiwi/server-deps/.lockhash

node -e 'console.log("node", process.version)'
echo "provisioned v1 as $me"
