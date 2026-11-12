# The box image as an OCI image, for `instabox snapshot import` (docs/CLOUD.md section 3). The
# spike built the same thing on a box instead and saved it with `instabox snapshot save` (no
# registry, no multi-GB upload from a PC; cloud/box/README.md). This file is the reproducible
# recipe for milestone 1: build it in CI, push to a private registry, import it.
# NOT BUILT OR IMPORTED YET (the spike used the box route); milestone 1 proves it.
#
#   docker build -t <registry>/anyapp-box:<tag> -f cloud/box/Dockerfile .   (from the repo root)
FROM debian:trixie

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip git openjdk-21-jdk-headless sudo \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (the boxes' templates carry 22 too).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*

# The Android SDK pieces docs/ENVIRONMENT.md pins.
COPY cloud/box/provision-sdk.sh /tmp/provision-sdk.sh
RUN useradd -m -u 1000 builder && echo 'builder ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/builder
USER builder
RUN bash /tmp/provision-sdk.sh
USER root

# The agent runtime (the ACP adapter over the Claude Agent SDK, as server/package.json pins it),
# the builder, the template and the runner.
RUN npm i -g @agentclientprotocol/claude-agent-acp@0.102.0 --no-audit --no-fund
COPY builder /opt/anyapp/repo/builder
COPY template /opt/anyapp/repo/template
COPY shared /opt/anyapp/repo/shared
COPY cloud/runner /opt/anyapp/runner
COPY cloud/box /opt/anyapp/box
RUN useradd -m -s /bin/bash agent && chown -R 1000:1000 /opt/anyapp

# A warm Gradle and npm cache: one full build of the template app at image build time.
USER builder
ENV ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
RUN cd /opt/anyapp/repo \
    && node builder/cli.mjs create /tmp/warm --name Warm --package com.anyappcloud.warm \
    && ANYAPP_SIGN_LATER=1 node builder/cli.mjs build /tmp/warm --build-number 1 \
    && rm -rf /tmp/warm
USER root
