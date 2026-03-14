#!/bin/bash
# Obliance Agent Installer for macOS (Intel + Apple Silicon)
#
# Recommended usage (key pre-injected by server):
#   sudo bash -c "$(curl -fsSL 'https://your-server/api/agent/installer/macos?key=<apikey>')"
#
# Manual usage:
#   sudo bash install-macos.sh --url https://your-server --key <apikey>

set -e

SERVER_URL="__SERVER_URL__"
API_KEY="__API_KEY__"
TMP_BINARY="/tmp/obliance-agent-install"

# ── Parse optional override args ──────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --url)   SERVER_URL="$2"; shift 2 ;;
    --url=*) SERVER_URL="${1#*=}"; shift ;;
    --key)   API_KEY="$2"; shift 2 ;;
    --key=*) API_KEY="${1#*=}"; shift ;;
    *) shift ;;
  esac
done

if [ -z "$SERVER_URL" ] || [ "$SERVER_URL" = "__SERVER_URL__" ]; then
  echo "Error: Server URL not set."
  echo "Use the URL provided in the Obliance admin panel, or pass --url <serverUrl>."
  exit 1
fi
if [ -z "$API_KEY" ] || [ "$API_KEY" = "__API_KEY__" ]; then
  echo "Error: API key not set."
  echo "Use the URL provided in the Obliance admin panel, or pass --key <apiKey>."
  exit 1
fi

# ── Require root ──────────────────────────────────────────────────────────────

if [ "$EUID" -ne 0 ]; then
  echo "Error: This installer requires administrator privileges."
  echo ""
  echo "Please run:"
  echo "  sudo bash -c \"\$(curl -fsSL '${SERVER_URL}/api/agent/installer/macos?key=${API_KEY}')\""
  exit 1
fi

echo "=============================="
echo " Obliance Agent Installer"
echo " macOS"
echo "=============================="
echo "Server : $SERVER_URL"
echo ""

# ── 1. Detect architecture ────────────────────────────────────────────────────

ARCH=$(uname -m)
case "$ARCH" in
  arm64)  BINARY_SUFFIX="darwin-arm64"  ;;   # Apple Silicon (M1/M2/M3/M4)
  x86_64) BINARY_SUFFIX="darwin-amd64"  ;;   # Intel Mac
  *)
    echo "Unsupported architecture: $ARCH (supported: arm64, x86_64)"
    exit 1
    ;;
esac

echo "[1/3] Architecture: $ARCH → obliance-agent-${BINARY_SUFFIX}"

# ── 2. Download agent binary ──────────────────────────────────────────────────

echo "[2/3] Downloading binary..."
curl -fsSL "${SERVER_URL}/api/agent/download/obliance-agent-${BINARY_SUFFIX}" \
  -o "$TMP_BINARY"
chmod +x "$TMP_BINARY"

# ── 3. Install (binary writes config, copies itself, registers launchd service)

echo "[3/3] Installing service..."

# The binary's "install" subcommand:
#   - Writes /etc/obliance-agent/config.json (generates device UUID)
#   - Copies itself to /usr/local/bin/obliance-agent
#   - Writes /Library/LaunchDaemons/com.obliance.agent.plist
#   - Runs: launchctl load <plist>
"$TMP_BINARY" --url "$SERVER_URL" --key "$API_KEY" install

# Clean up temp binary (the binary already copied itself to /usr/local/bin/)
rm -f "$TMP_BINARY"

echo ""
echo "=============================="
echo " Installation complete!"
echo ""
echo " The agent is now running and"
echo " will appear in the Obliance"
echo " admin panel once approved."
echo ""
echo " To uninstall:"
echo "   sudo obliance-agent uninstall"
echo "=============================="
