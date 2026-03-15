#!/bin/bash
# Obliance Agent Installer for Linux
# Usage: curl -fsSL "https://your-server/api/agent/installer/linux?key=<apikey>" | bash
# Or:    bash install.sh --url https://your-server --key <apikey>

set -e

SERVER_URL="__SERVER_URL__"
API_KEY="__API_KEY__"
INSTALL_DIR="/opt/obliance-agent"
CONFIG_DIR="/etc/obliance-agent"
SERVICE_NAME="obliance-agent"
BINARY_NAME="obliance-agent"

# Parse args (override injected values)
for i in "$@"; do
  case $i in
    --url=*) SERVER_URL="${i#*=}" ;;
    --key=*) API_KEY="${i#*=}" ;;
    --url) SERVER_URL="$2"; shift ;;
    --key) API_KEY="$2"; shift ;;
  esac
done

if [ -z "$SERVER_URL" ] || [ "$SERVER_URL" = "__SERVER_URL__" ]; then
  echo "Error: --url is required"; exit 1
fi
if [ -z "$API_KEY" ] || [ "$API_KEY" = "__API_KEY__" ]; then
  echo "Error: --key is required"; exit 1
fi

echo "=============================="
echo " Obliance Agent Installer"
echo "=============================="
echo "Server URL : $SERVER_URL"
echo "Install dir: $INSTALL_DIR"
echo ""

# ── 1. Detect architecture ────────────────────────────────────────────────────

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  BINARY_SUFFIX="linux-amd64" ;;
  aarch64) BINARY_SUFFIX="linux-arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH (supported: x86_64, aarch64)"
    exit 1
    ;;
esac

echo "[1/5] Architecture: $ARCH"

# ── 2. Download binary ────────────────────────────────────────────────────────

echo "[2/5] Downloading agent binary..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "${SERVER_URL}/api/agent/download/obliance-agent-${BINARY_SUFFIX}" \
  -o "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"

# ── 3. Write config ───────────────────────────────────────────────────────────

echo "[3/5] Writing configuration..."
mkdir -p "$CONFIG_DIR"

DEVICE_UUID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || \
              python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || \
              cat /dev/urandom | tr -dc 'a-f0-9' | head -c 32 | \
              sed 's/\(.\{8\}\)\(.\{4\}\)\(.\{4\}\)\(.\{4\}\)\(.\{12\}\)/\1-\2-\3-\4-\5/')

cat > "$CONFIG_DIR/config.json" <<EOF
{
  "serverUrl": "$SERVER_URL",
  "apiKey": "$API_KEY",
  "deviceUuid": "$DEVICE_UUID",
  "checkIntervalSeconds": 60,
  "agentVersion": "1.0.0"
}
EOF

# ── 4. Set up VNC server for remote-access sessions ──────────────────────────

echo "[4/5] Setting up VNC for remote access..."

# Detect whether a graphical environment is present.
# We check for running X11 lock files, display sockets, or environment variables.
HAS_DISPLAY=0
if ls /tmp/.X*-lock 2>/dev/null | head -1 | grep -q .; then
  HAS_DISPLAY=1
elif [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
  HAS_DISPLAY=1
elif [ -S /tmp/.X11-unix/X0 ] 2>/dev/null; then
  HAS_DISPLAY=1
fi

if [ "$HAS_DISPLAY" = "1" ]; then
  echo "    Graphical environment detected — installing x11vnc..."
  if command -v apt-get &>/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq x11vnc 2>/dev/null || true
  elif command -v dnf &>/dev/null; then
    dnf install -y -q x11vnc 2>/dev/null || true
  elif command -v yum &>/dev/null; then
    yum install -y x11vnc 2>/dev/null || true
  fi

  if command -v x11vnc &>/dev/null; then
    # Use -find so x11vnc auto-discovers the running X session regardless of
    # which display number or user owns it.  More robust than a hardcoded
    # DISPLAY= when running as root in a systemd service context.
    cat > "/etc/systemd/system/obliance-vnc.service" <<'VNCEOF'
[Unit]
Description=Obliance VNC Server (x11vnc)
After=graphical-session.target network.target
Wants=graphical-session.target

[Service]
Type=simple
Restart=on-failure
RestartSec=5
ExecStart=/usr/bin/x11vnc -find -forever -nopw -shared -localhost -rfbport 5900 -quiet -o /var/log/obliance-x11vnc.log
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical.target
VNCEOF

    systemctl daemon-reload
    systemctl enable obliance-vnc 2>/dev/null || true
    systemctl start obliance-vnc 2>/dev/null || true
    echo "    x11vnc service installed and started (port 5900, localhost only)."
  else
    echo "    x11vnc not available — VNC auto-start will be attempted on first remote session."
  fi
else
  echo "    No graphical environment detected — skipping VNC setup."
  echo "    Remote access requires a VNC server on port 5900 (e.g. x11vnc or TigerVNC)."
fi

# ── 5. Install systemd service ────────────────────────────────────────────────

echo "[5/5] Installing service..."

if command -v systemctl &>/dev/null; then
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Obliance Monitoring Agent
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=10
User=root
ExecStart=$INSTALL_DIR/$BINARY_NAME
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"

  echo ""
  systemctl status "$SERVICE_NAME" --no-pager -l || true

elif [ -d /etc/init.d ]; then
  cat > "/etc/init.d/${SERVICE_NAME}" <<INITEOF
#!/bin/bash
# chkconfig: 2345 80 20
DAEMON="$INSTALL_DIR/$BINARY_NAME"
PIDFILE=/var/run/${SERVICE_NAME}.pid
case "\$1" in
  start)   \$DAEMON & echo \$! > \$PIDFILE; echo "Started" ;;
  stop)    kill \$(cat \$PIDFILE) 2>/dev/null; rm -f \$PIDFILE; echo "Stopped" ;;
  restart) \$0 stop; \$0 start ;;
  status)  [ -f \$PIDFILE ] && kill -0 \$(cat \$PIDFILE) 2>/dev/null && echo "Running" || echo "Stopped" ;;
esac
INITEOF
  chmod +x "/etc/init.d/${SERVICE_NAME}"
  chkconfig --add "$SERVICE_NAME" 2>/dev/null || true
  service "$SERVICE_NAME" start

else
  echo "No service manager found. Start manually:"
  echo "  $INSTALL_DIR/$BINARY_NAME &"
fi

echo ""
echo "=============================="
echo " Installation complete!"
echo " The agent will appear in"
echo " the Obliance admin panel"
echo " once approved."
echo "=============================="
