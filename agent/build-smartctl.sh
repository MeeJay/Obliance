#!/usr/bin/env bash
set -euo pipefail

# Build a STATIC smartctl (musl, fully self-contained) for Linux into
# agent/dist/tools/. This is a ONE-TIME artifact for the Obliance native
# disk-health collector: the server ships it to Linux agents that don't have
# smartmontools installed, so no distro package / repo access is needed.
#
# Requires Docker (uses Alpine to produce a musl-static binary that runs on
# every glibc AND musl distro). Re-run only to bump the smartmontools version.
#
# Usage:  bash agent/build-smartctl.sh
# arm64 additionally needs qemu registered once:
#   docker run --rm --privileged multiarch/qemu-user-static --reset -p yes

cd "$(dirname "$0")"
mkdir -p dist/tools
VER="${SMARTMONTOOLS_VERSION:-7.4}"

build_one() {
  arch="$1"; platform="$2"
  echo ">>> Building static smartctl ${VER} for linux/${arch} ..."
  docker run --rm --platform "$platform" -e VER="$VER" -e ARCH="$arch" \
    -v "$PWD/dist/tools:/out" alpine:3.20 sh -eux -c '
      apk add --no-cache build-base curl tar >/dev/null
      cd /tmp
      curl -fsSL -o s.tgz "https://downloads.sourceforge.net/project/smartmontools/smartmontools/${VER}/smartmontools-${VER}.tar.gz"
      tar xzf s.tgz
      cd "smartmontools-${VER}"
      ./configure --without-libcap-ng --without-selinux \
        LDFLAGS="-static -static-libstdc++ -static-libgcc" >/dev/null
      make -j"$(nproc)" smartctl >/dev/null
      strip smartctl
      cp smartctl "/out/smartctl-linux-${ARCH}"
    '
  echo "    -> dist/tools/smartctl-linux-${arch}"
}

build_one amd64 linux/amd64

# arm64 is optional — only if this host can run arm64 containers (qemu).
if docker run --rm --platform linux/arm64 alpine:3.20 true >/dev/null 2>&1; then
  build_one arm64 linux/arm64
else
  echo ">>> Skipping arm64 (no qemu emulation). Register it once with:"
  echo "    docker run --rm --privileged multiarch/qemu-user-static --reset -p yes"
fi

echo "Done:"
ls -lh dist/tools/ || true

# Sanity: confirm the binaries are static (no interpreter) and runnable.
for f in dist/tools/smartctl-linux-*; do
  [ -f "$f" ] || continue
  echo "--- $f"
  file "$f" 2>/dev/null || true
done
