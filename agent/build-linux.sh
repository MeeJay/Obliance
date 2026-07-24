#!/usr/bin/env bash
set -euo pipefail

# Build Obliance Agent for Linux (amd64 + arm64).
# Runs on a Linux host — called remotely via SSH from 000-RegularUpdate.bat.
# Usage: bash build-linux.sh

cd "$(dirname "$0")"
VERSION=$(cat VERSION 2>/dev/null || echo "0.0.0")

echo "Building Obliance Agent v${VERSION} for Linux + FreeBSD..."

export CGO_ENABLED=0
mkdir -p dist

# Linux amd64
echo "  [1/3] linux/amd64..."
GOOS=linux GOARCH=amd64 go build \
  -ldflags="-s -w -X main.agentVersion=${VERSION}" \
  -o dist/obliance-agent-linux-amd64 .

# Linux arm64
echo "  [2/3] linux/arm64..."
GOOS=linux GOARCH=arm64 go build \
  -ldflags="-s -w -X main.agentVersion=${VERSION}" \
  -o dist/obliance-agent-linux-arm64 .

# FreeBSD amd64 (cross-compiled from Linux)
echo "  [3/6] freebsd/amd64..."
GOOS=freebsd GOARCH=amd64 go build \
  -ldflags="-s -w -X main.agentVersion=${VERSION}" \
  -o dist/obliance-agent-freebsd-amd64 .

# Watchdog binaries — tiny companion process that restarts the agent
# service if it dies. Installed alongside the agent by install.sh.
echo "  [4/6] watchdog linux/amd64..."
GOOS=linux GOARCH=amd64 go build \
  -ldflags="-s -w" \
  -o dist/obliance-watchdog-linux-amd64 ./cmd/watchdog/

echo "  [5/6] watchdog linux/arm64..."
GOOS=linux GOARCH=arm64 go build \
  -ldflags="-s -w" \
  -o dist/obliance-watchdog-linux-arm64 ./cmd/watchdog/

echo "  [6/6] watchdog freebsd/amd64..."
GOOS=freebsd GOARCH=amd64 go build \
  -ldflags="-s -w" \
  -o dist/obliance-watchdog-freebsd-amd64 ./cmd/watchdog/

# Linux install wizard — static binary with the just-built linux/amd64
# agent //go:embed'd. Distributed as a standalone executable for boxes
# that can't run `curl | bash` (outdated CA stores, no outbound HTTP,
# corporate TLS interception). Build wizard amd64 only — every Linux
# server we'd hand-deploy to is x86_64; can add arm64 later if needed.
echo "  [extra] install wizard linux/amd64..."
cp dist/obliance-agent-linux-amd64 cmd/wizard-linux/obliance-agent
GOOS=linux GOARCH=amd64 go build \
  -ldflags="-s -w -X main.version=${VERSION}" \
  -o dist/obliance-installer-wizard-linux-amd64 ./cmd/wizard-linux
rm -f cmd/wizard-linux/obliance-agent

# Static smartctl for the native disk-health collector (server ships it to
# Linux agents lacking smartmontools). One-time artifact — build it with
# agent/build-smartctl.sh (needs Docker). Non-fatal here: if the binaries are
# absent the server simply degrades to "smartctl-if-present" on Linux.
mkdir -p dist/tools
if ls dist/tools/smartctl-linux-* >/dev/null 2>&1; then
  echo "  [smartctl] present: $(ls dist/tools/smartctl-linux-* | tr '\n' ' ')"
else
  echo "  [smartctl] NOT built — run agent/build-smartctl.sh once (Linux self-provisioning disabled until then)"
fi

echo "Done. Binaries:"
ls -lh dist/obliance-agent-linux-* dist/obliance-agent-freebsd-* dist/obliance-watchdog-linux-* dist/obliance-watchdog-freebsd-* dist/obliance-installer-wizard-linux-*
