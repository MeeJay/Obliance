#!/bin/bash
# Obli Shell / Obliance Android — setup script for Claude Code cloud sessions
# (Ubuntu 24.04, JDK 21 preinstalled). Paste it in the cloud environment's
# "Setup script" field. It runs as root before the session and its result is
# cached (~7 days), so the SDK is not downloaded on every session.
#
# Network: set the environment to "Custom" access and allow dl.google.com
# (the SDK downloads) in addition to the defaults (Maven Central, Google
# Maven, Gradle are already allowed).
#
# SIGNING: never put the release keystore or its password in a cloud
# environment. Cloud sessions build debug / unsigned APKs and run the tests;
# the signed release is built on the Windows build host (mobile/build-android.ps1).
set -u

SDK=/opt/android-sdk
mkdir -p "$SDK/cmdline-tools"

if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  apt-get update -qq && apt-get install -y -qq unzip wget >/dev/null || true
  # Newest command-line tools listed by Google's repository index.
  ZIP=$(wget -qO- https://dl.google.com/android/repository/repository2-3.xml \
        | grep -o 'commandlinetools-linux-[0-9]*_latest\.zip' | sort -V | tail -1)
  if [ -z "$ZIP" ]; then echo "cannot resolve cmdline-tools version (is dl.google.com allowed?)"; exit 1; fi
  wget -q "https://dl.google.com/android/repository/$ZIP" -O /tmp/cmdline-tools.zip
  unzip -q /tmp/cmdline-tools.zip -d "$SDK/cmdline-tools"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -f /tmp/cmdline-tools.zip
fi

SM="$SDK/cmdline-tools/latest/bin/sdkmanager"
yes | "$SM" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
# compileSdk 37 + build-tools 37 (the project's app/build.gradle.kts). Install
# every android-37 platform revision the index offers (e.g. android-37.0).
# Newer sdkmanager builds list packages as "platforms/android-37.0" instead of
# "platforms;android-37.0": accept both, skip previews, install with ";".
PLATFORMS=$("$SM" --sdk_root="$SDK" --list 2>/dev/null | grep -oE 'platforms[;/]android-37[^ ]*' \
            | grep -vE -- '-(beta|rc|preview)' | sed 's#/#;#' | sort -u | tr '\n' ' ')
"$SM" --sdk_root="$SDK" "platform-tools" "build-tools;37.0.0" $PLATFORMS >/dev/null || true

cat > /etc/profile.d/android.sh <<EOF
export ANDROID_HOME=$SDK
export ANDROID_SDK_ROOT=$SDK
export PATH=\$PATH:$SDK/platform-tools:$SDK/cmdline-tools/latest/bin
EOF
echo "Android SDK ready in $SDK ($PLATFORMS)"
exit 0
