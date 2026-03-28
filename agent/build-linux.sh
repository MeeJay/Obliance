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
echo "  [3/3] freebsd/amd64..."
GOOS=freebsd GOARCH=amd64 go build \
  -ldflags="-s -w -X main.agentVersion=${VERSION}" \
  -o dist/obliance-agent-freebsd-amd64 .

echo "Done. Binaries:"
ls -lh dist/obliance-agent-linux-* dist/obliance-agent-freebsd-*
