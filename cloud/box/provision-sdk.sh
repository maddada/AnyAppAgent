#!/usr/bin/env bash
# Installs the Android SDK pieces the builder needs, as pinned in docs/ENVIRONMENT.md.
# Runs on an Instabox box (Debian 13, Node 22 and OpenJDK 21 already there) as the machine user,
# with sudo. Idempotent. Used by the spike (milestone 0 of docs/CLOUD.md); the same steps go into
# cloud/box/Dockerfile for `instabox snapshot import`.
set -euo pipefail

SDK=/opt/android-sdk
CMDLINE_ZIP=commandlinetools-linux-16111833_latest.zip

sudo mkdir -p "$SDK"
sudo chown "$(id -u):$(id -g)" "$SDK"

if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  tmp=$(mktemp -d)
  curl -fsSL "https://dl.google.com/android/repository/$CMDLINE_ZIP" -o "$tmp/cl.zip"
  mkdir -p "$SDK/cmdline-tools"
  (cd "$tmp" && unzip -q cl.zip)
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$tmp"
fi

export ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK
SM="$SDK/cmdline-tools/latest/bin/sdkmanager"
yes | "$SM" --licenses >/dev/null 2>&1 || true
"$SM" --install \
  "platform-tools" \
  "platforms;android-37.0" \
  "platforms;android-36" \
  "build-tools;37.0.0" \
  "build-tools;36.0.0" \
  "ndk;27.1.12297006" \
  "cmake;3.22.1" >/dev/null

# Everyone's login shells see the SDK (the agent and the runner users too).
sudo tee /etc/profile.d/anyapp-android.sh >/dev/null <<EOF
export ANDROID_HOME=$SDK
export ANDROID_SDK_ROOT=$SDK
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH=$SDK/platform-tools:$SDK/build-tools/37.0.0:\$PATH
EOF
du -sh "$SDK"
