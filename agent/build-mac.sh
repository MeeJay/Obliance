#!/usr/bin/env bash
# =============================================================================
# Obliance Agent — Native macOS build (CGO_ENABLED=1)
#
# Why native? gopsutil's cpu.Percent(percpu=true) calls host_processor_info
# (Mach API) which requires CGO. Cross-compiled binaries skip this and fall
# back to `top`, which only gives overall CPU % — no per-core bars in the UI.
#
# This script must be run ON a Mac (Apple Silicon or Intel). It builds BOTH
# architectures: the native arch via CGO, and the other arch via clang -arch.
#
# Usage (run from the agent/ directory, or anywhere — it self-locates):
#   bash agent/build-mac.sh
#   # or from inside agent/:
#   bash build-mac.sh
#
# After running, copy both binaries to the Windows/Unraid build host at:
#   agent/dist/obliance-agent-darwin-arm64
#   agent/dist/obliance-agent-darwin-amd64
# Then run 000-RegularUpdate.bat (or 00-A2-docker-agent-push.bat) to rebuild.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Architecture detection ────────────────────────────────────────────────────

NATIVE_GOARCH="$(go env GOARCH 2>/dev/null || uname -m | sed 's/x86_64/amd64/')"
case "$NATIVE_GOARCH" in
  arm64) CROSS_GOARCH="amd64"; CROSS_CLANG_ARCH="x86_64" ;;
  amd64) CROSS_GOARCH="arm64"; CROSS_CLANG_ARCH="arm64"  ;;
  *)
    echo "ERROR: Unsupported Go architecture: $NATIVE_GOARCH" >&2
    echo "       Run this script on an Apple Silicon (arm64) or Intel (amd64) Mac." >&2
    exit 1
    ;;
esac

# ── Version ───────────────────────────────────────────────────────────────────

VERSION=""
if [ -f "VERSION" ]; then
  VERSION="$(tr -d '[:space:]' < VERSION)"
fi
if [ -z "$VERSION" ] || [ "$VERSION" = "dev" ]; then
  echo "WARNING: Could not read a release version from agent/VERSION, using 'dev'."
  echo "         Run 00-A0-bump-agent.bat first to set the version."
  VERSION="dev"
fi

OUT_DIR="dist"
mkdir -p "$OUT_DIR"

# ── Build native arch (full CGO) ──────────────────────────────────────────────

echo "Building Obliance Agent $VERSION for darwin/$NATIVE_GOARCH (native, CGO_ENABLED=1)..."
CGO_ENABLED=1 GOOS=darwin GOARCH="$NATIVE_GOARCH" \
  go build \
    -ldflags="-s -w -X main.agentVersion=$VERSION" \
    -o "$OUT_DIR/obliance-agent-darwin-$NATIVE_GOARCH" \
    .
echo "  → $OUT_DIR/obliance-agent-darwin-$NATIVE_GOARCH"

# ── Build cross arch (clang -arch) ────────────────────────────────────────────

echo ""
echo "Building Obliance Agent $VERSION for darwin/$CROSS_GOARCH (cross, clang -arch $CROSS_CLANG_ARCH)..."
if CGO_ENABLED=1 GOOS=darwin GOARCH="$CROSS_GOARCH" \
     CGO_CFLAGS="-arch $CROSS_CLANG_ARCH" \
     CGO_LDFLAGS="-arch $CROSS_CLANG_ARCH" \
     go build \
       -ldflags="-s -w -X main.agentVersion=$VERSION" \
       -o "$OUT_DIR/obliance-agent-darwin-$CROSS_GOARCH" \
       . 2>&1; then
  echo "  → $OUT_DIR/obliance-agent-darwin-$CROSS_GOARCH"
else
  echo "  WARNING: Cross-compilation to darwin/$CROSS_GOARCH failed — skipping."
  echo "           (The native $NATIVE_GOARCH binary was built successfully.)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

# ── Build tray for both architectures (CGO — needs Cocoa) ────────────────────
#
# The tray uses getlantern/systray, which on macOS binds to NSStatusBar via
# Cocoa. Cross-compilation works the same way as the agent (native CGO on
# the current arch, clang -arch trick for the other).

echo ""
echo "Building Obliance Tray $VERSION for darwin/$NATIVE_GOARCH (native, CGO_ENABLED=1)..."
CGO_ENABLED=1 GOOS=darwin GOARCH="$NATIVE_GOARCH" \
  go build \
    -ldflags="-s -w -X main.trayVersion=$VERSION" \
    -o "$OUT_DIR/obliance-tray-darwin-$NATIVE_GOARCH" \
    ./cmd/tray
echo "  → $OUT_DIR/obliance-tray-darwin-$NATIVE_GOARCH"

echo ""
echo "Building Obliance Tray $VERSION for darwin/$CROSS_GOARCH (cross, clang -arch $CROSS_CLANG_ARCH)..."
if CGO_ENABLED=1 GOOS=darwin GOARCH="$CROSS_GOARCH" \
     CGO_CFLAGS="-arch $CROSS_CLANG_ARCH" \
     CGO_LDFLAGS="-arch $CROSS_CLANG_ARCH" \
     go build \
       -ldflags="-s -w -X main.trayVersion=$VERSION" \
       -o "$OUT_DIR/obliance-tray-darwin-$CROSS_GOARCH" \
       ./cmd/tray 2>&1; then
  echo "  → $OUT_DIR/obliance-tray-darwin-$CROSS_GOARCH"
else
  echo "  WARNING: Cross-compilation of tray to darwin/$CROSS_GOARCH failed — skipping."
fi

# ── Build watchdog for both architectures (pure Go, no CGO needed) ───────────
echo ""
echo "Building Obliance Watchdog for darwin (both architectures, CGO_ENABLED=0)..."
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
  go build -ldflags="-s -w" \
    -o "$OUT_DIR/obliance-watchdog-darwin-arm64" \
    ./cmd/watchdog
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 \
  go build -ldflags="-s -w" \
    -o "$OUT_DIR/obliance-watchdog-darwin-amd64" \
    ./cmd/watchdog
echo "  → $OUT_DIR/obliance-watchdog-darwin-arm64"
echo "  → $OUT_DIR/obliance-watchdog-darwin-amd64"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "Built binaries:"
ls -lh "$OUT_DIR"/obliance-agent-darwin-* 2>/dev/null || true
ls -lh "$OUT_DIR"/obliance-tray-darwin-*  2>/dev/null || true
echo ""
echo "Next steps:"
echo "  1. The .bat script (00-A3-build-mac-agent.bat) retrieves both binaries automatically."
echo "  2. Run 000-RegularUpdate.bat (or 00-A2-docker-agent-push.bat) to rebuild"
echo "     the Docker image — the Dockerfile's last 'COPY agent/dist/' picks up"
echo "     both darwin binaries."
