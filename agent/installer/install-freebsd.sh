#!/bin/sh
# Obliance Agent Installer for FreeBSD
# Usage: fetch -qo - "https://your-server/api/agent/installer/freebsd?key=<apikey>" | sh
# Or:    sh install-freebsd.sh --url https://your-server --key <apikey>

set -e

SERVER_URL="__SERVER_URL__"
API_KEY="__API_KEY__"
INSTALL_DIR="/usr/local/sbin"
CONFIG_DIR="/etc/obliance-agent"
SERVICE_NAME="obliance_agent"
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
echo " (FreeBSD)"
echo "=============================="
echo "Server URL : $SERVER_URL"
echo "Install dir: $INSTALL_DIR"
echo ""

# ── 1. Detect architecture ────────────────────────────────────────────────────

ARCH=$(uname -m)
case "$ARCH" in
  amd64|x86_64) BINARY_SUFFIX="freebsd-amd64" ;;
  *)
    echo "Unsupported architecture: $ARCH (supported: amd64)"
    exit 1
    ;;
esac

echo "[1/4] Architecture: $ARCH"

# ── 2. Download binary ────────────────────────────────────────────────────────

echo "[2/4] Downloading agent binary..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "${SERVER_URL}/api/agent/download/obliance-agent-${BINARY_SUFFIX}" \
    -o "$INSTALL_DIR/$BINARY_NAME"
elif command -v fetch >/dev/null 2>&1; then
  fetch -qo "$INSTALL_DIR/$BINARY_NAME" \
    "${SERVER_URL}/api/agent/download/obliance-agent-${BINARY_SUFFIX}"
else
  echo "Error: neither curl nor fetch is available"
  exit 1
fi
chmod +x "$INSTALL_DIR/$BINARY_NAME"

# ── 3. Write config ───────────────────────────────────────────────────────────

echo "[3/4] Writing configuration..."
mkdir -p "$CONFIG_DIR"

DEVICE_UUID=$(uuidgen 2>/dev/null || \
              python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || \
              cat /dev/urandom | od -N 16 -x | head -1 | awk '{printf "%s%s-%s-%s-%s-%s%s%s", $2,$3,$4,$5,$6,$7,$8,$9}')

cat > "$CONFIG_DIR/config.json" <<EOF
{
  "serverUrl": "$SERVER_URL",
  "apiKey": "$API_KEY",
  "deviceUuid": "$DEVICE_UUID",
  "checkIntervalSeconds": 60,
  "agentVersion": "1.0.0"
}
EOF

# ── 4. Install rc.d service ──────────────────────────────────────────────────

echo "[4/4] Installing service..."

cat > "/usr/local/etc/rc.d/${SERVICE_NAME}" <<RCEOF
#!/bin/sh

# PROVIDE: obliance_agent
# REQUIRE: NETWORKING SERVERS
# KEYWORD: shutdown

. /etc/rc.subr

name="obliance_agent"
rcvar="obliance_agent_enable"
pidfile="/var/run/\${name}.pid"

command="$INSTALL_DIR/$BINARY_NAME"
command_args=">> /var/log/obliance-agent.log 2>&1 & echo \\\$! > \${pidfile}"

start_cmd="\${name}_start"
stop_cmd="\${name}_stop"
status_cmd="\${name}_status"

obliance_agent_start() {
    if [ -f "\${pidfile}" ] && kill -0 "\$(cat "\${pidfile}")" 2>/dev/null; then
        echo "\${name} is already running (pid \$(cat "\${pidfile}"))."
        return 0
    fi
    echo "Starting \${name}..."
    eval "\${command}" \${command_args}
}

obliance_agent_stop() {
    if [ ! -f "\${pidfile}" ]; then
        echo "\${name} is not running."
        return 0
    fi
    echo "Stopping \${name}..."
    kill "\$(cat "\${pidfile}")" 2>/dev/null
    rm -f "\${pidfile}"
}

obliance_agent_status() {
    if [ -f "\${pidfile}" ] && kill -0 "\$(cat "\${pidfile}")" 2>/dev/null; then
        echo "\${name} is running (pid \$(cat "\${pidfile}"))."
    else
        echo "\${name} is not running."
        return 1
    fi
}

load_rc_config \$name
: \${obliance_agent_enable:="NO"}
run_rc_command "\$1"
RCEOF

chmod +x "/usr/local/etc/rc.d/${SERVICE_NAME}"

# Enable and start
sysrc obliance_agent_enable=YES
service "$SERVICE_NAME" start

echo ""
echo "=============================="
echo " Installation complete!"
echo " The agent will appear in"
echo " the Obliance admin panel"
echo " once approved."
echo "=============================="
