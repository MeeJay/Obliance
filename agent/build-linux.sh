#!/usr/bin/env bash
set -euo pipefail

# Build Obliance Agent for Linux (amd64 + arm64).
# Runs on a Linux host — called remotely via SSH from 000-RegularUpdate.bat.
# Usage: bash build-linux.sh

cd "$(dirname "$0")"
VERSION=$(cat VERSION 2>/dev/null || echo "0.0.0")

echo "Building Obliance Agent v${VERSION} for Linux..."

export CGO_ENABLED=0
mkdir -p dist

# amd64
echo "  [1/2] linux/amd64..."
GOOS=linux GOARCH=amd64 go build \
  -ldflags="-s -w -X main.agentVersion=${VERSION}" \
  -o dist/obliance-agent-linux-amd64 .

# arm64
echo "  [2/2] linux/arm64..."
GOOS=linux GOARCH=arm64 go build \
  -ldflags="-s -w -X main.agentVersion=${VERSION}" \
  -o dist/obliance-agent-linux-arm64 .

echo "Done. Binaries:"
ls -lh dist/obliance-agent-linux-*
