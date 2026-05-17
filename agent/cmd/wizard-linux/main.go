// Obliance Agent — Linux Install Wizard
//
// Stand-alone Linux executable that mirrors the Windows wizard: drop on
// the target box (via scp / USB / paste), run as root, accept the
// pre-filled server URL + API key (or override them), service is
// installed and started. Designed for hostile environments where
// `curl | bash` falls apart:
//
//   - Old CentOS/RHEL with outdated CA bundles → can't validate the
//     Obliance TLS cert, every curl returns "SSL connect error".
//   - Restricted boxes with no outbound HTTP at all → the operator
//     hand-copies the wizard via SCP/SMB/USB and runs it offline.
//   - Custom corporate proxies / TLS-MITM appliances → the wizard
//     defaults `tlsInsecureSkipVerify=true` so the agent doesn't need
//     a working chain-of-trust to enrol.
//
// Build:
//   - CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w"
//   - The agent binary itself is embedded via //go:embed (build pipeline
//     copies agent/dist/obliance-agent-linux-amd64 next to this source
//     file before invoking `go build`, then removes the copy).
//
// Pre-filled config:
//   Same tail-blob protocol as the Windows wizard. Server endpoint
//   GET /api/agent/installer/wizard-linux-amd64?keyId=N streams the
//   binary then appends:
//       [json bytes][magic 8B "OBLI_CFG"][len uint32 LE]
//   The wizard reads its own tail at startup and pre-fills the prompts.

//go:build linux

package main

import (
	"bufio"
	_ "embed"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Embedded agent binary — placed next to this file by the build pipeline
// (cf. 000-RegularUpdate.bat step [9/10]). Removed after build.
//
//go:embed obliance-agent
var agentBinary []byte

// version is injected at link-time via -ldflags="-X main.version=...".
// Stays "dev" for ad-hoc local builds.
var version = "dev"

const cfgMagic = "OBLI_CFG"
const cfgMaxBytes = 1 << 20

type embeddedConfig struct {
	ServerURL string `json:"serverUrl"`
	APIKey    string `json:"apiKey"`
}

func main() {
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "✗ This installer must be run as root.")
		fmt.Fprintln(os.Stderr, "  Try:  sudo ./obliance-installer-wizard-linux")
		os.Exit(1)
	}

	cfg := readEmbeddedConfig()

	fmt.Println()
	fmt.Println("  ╔══════════════════════════════════════════════════════╗")
	fmt.Println("  ║                                                      ║")
	fmt.Println("  ║       Obliance Agent — Install Wizard (Linux)        ║")
	fmt.Printf("  ║                       v%-30s ║\n", version)
	fmt.Println("  ║                                                      ║")
	fmt.Println("  ╚══════════════════════════════════════════════════════╝")
	fmt.Println()
	if cfg.ServerURL != "" || cfg.APIKey != "" {
		fmt.Println("  Pre-filled config detected in this binary (press <Enter> to accept).")
		fmt.Println()
	}

	reader := bufio.NewReader(os.Stdin)
	serverURL := promptDefault(reader, "Server URL", cfg.ServerURL, "https://obliance.example.com")
	apiKey := promptDefault(reader, "API Key", cfg.APIKey, "obli_xxxxxxxxxxxxxxxxxxxxxxxxxxxx")

	if serverURL == "" || apiKey == "" {
		fmt.Fprintln(os.Stderr, "✗ Server URL and API Key are required.")
		os.Exit(1)
	}

	// Default ON — this wizard exists precisely for boxes with broken
	// CA stores. Most operators using it want this; the few who don't
	// answer 'n' here and the wizard sets tlsInsecureSkipVerify=false.
	skipTls := promptYesNo(reader,
		"Skip TLS certificate verification (recommended for boxes with outdated CA stores)",
		true)

	fmt.Println()
	fmt.Println("Installing…")
	if err := install(serverURL, apiKey, skipTls); err != nil {
		fmt.Fprintf(os.Stderr, "✗ Install failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Println()
	fmt.Println("✓ Done. The agent is now running.")
	fmt.Println("  It will appear in the Obliance admin panel within ~30 seconds.")
	fmt.Println()
}

// ── Install logic ───────────────────────────────────────────────────────────

func install(serverURL, apiKey string, skipTls bool) error {
	// Stop any prior install so we can overwrite the binary cleanly.
	// On Linux you CAN overwrite a running executable, but the running
	// process keeps the old inode — we'd rather have a deterministic
	// stop → replace → start sequence so admins don't end up with two
	// generations of the agent talking at once.
	if hasSystemd() {
		_ = run("systemctl", "stop", "obliance-agent")
	} else {
		_ = run("service", "obliance-agent", "stop")
	}

	binPath := "/usr/local/bin/obliance-agent"
	// Remove first to break the inode → fresh write, plus avoids the
	// rare ETXTBSY when the old binary is still mapped.
	_ = os.Remove(binPath)
	if err := os.WriteFile(binPath, agentBinary, 0o755); err != nil {
		return fmt.Errorf("write agent binary to %s: %w", binPath, err)
	}
	fmt.Printf("  ✓ Wrote %s (%s)\n", binPath, humanSize(len(agentBinary)))

	cfgDir := "/etc/obliance"
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", cfgDir, err)
	}
	cfgPath := filepath.Join(cfgDir, "config.json")
	cfgPayload := map[string]any{
		"serverUrl":             serverURL,
		"apiKey":                apiKey,
		"tlsInsecureSkipVerify": skipTls,
	}
	cfgBytes, _ := json.MarshalIndent(cfgPayload, "", "  ")
	if err := os.WriteFile(cfgPath, cfgBytes, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", cfgPath, err)
	}
	fmt.Printf("  ✓ Wrote %s\n", cfgPath)

	if hasSystemd() {
		return installSystemd()
	}
	return installSysV()
}

// ── systemd ─────────────────────────────────────────────────────────────────

func hasSystemd() bool {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return false
	}
	// /run/systemd/system is created by systemd PID 1 when it's
	// actually running — some images ship systemctl as a stub
	// (Docker base images) so we sanity-check.
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		return false
	}
	return true
}

const systemdUnit = `[Unit]
Description=Obliance RMM Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/obliance-agent -config /etc/obliance/config.json
Restart=on-failure
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
`

func installSystemd() error {
	unitPath := "/etc/systemd/system/obliance-agent.service"
	if err := os.WriteFile(unitPath, []byte(systemdUnit), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", unitPath, err)
	}
	fmt.Printf("  ✓ Installed systemd unit %s\n", unitPath)

	if err := run("systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("systemctl daemon-reload: %w", err)
	}
	if err := run("systemctl", "enable", "--now", "obliance-agent"); err != nil {
		return fmt.Errorf("systemctl enable --now obliance-agent: %w", err)
	}
	fmt.Println("  ✓ Service started (systemd)")
	return nil
}

// ── SysV init (CentOS 6, very old RHEL) ─────────────────────────────────────

const sysVInitScript = `#!/bin/bash
#
# obliance-agent  Obliance RMM Agent
# chkconfig: 345 99 01
# description: Obliance Remote Monitoring & Management agent.

[ -f /etc/rc.d/init.d/functions ] && . /etc/rc.d/init.d/functions

prog="obliance-agent"
exec="/usr/local/bin/obliance-agent"
config="/etc/obliance/config.json"
lockfile="/var/lock/subsys/$prog"
pidfile="/var/run/$prog.pid"
logfile="/var/log/obliance-agent.log"

start() {
    [ -x "$exec" ] || { echo "$exec not found"; exit 5; }
    [ -f "$config" ] || { echo "$config not found"; exit 6; }
    echo -n "Starting $prog: "
    nohup "$exec" -config "$config" >> "$logfile" 2>&1 &
    echo $! > "$pidfile"
    touch "$lockfile"
    echo OK
}

stop() {
    echo -n "Stopping $prog: "
    if [ -f "$pidfile" ]; then
        kill -TERM "$(cat $pidfile)" 2>/dev/null || true
        rm -f "$pidfile" "$lockfile"
    fi
    echo OK
}

restart() { stop; start; }
status() {
    if [ -f "$pidfile" ] && kill -0 "$(cat $pidfile)" 2>/dev/null; then
        echo "$prog (pid $(cat $pidfile)) is running"
    else
        echo "$prog is stopped"
        return 3
    fi
}

case "$1" in
    start|stop|restart|status) "$1" ;;
    *) echo "Usage: $0 {start|stop|restart|status}"; exit 2 ;;
esac
`

func installSysV() error {
	path := "/etc/init.d/obliance-agent"
	if err := os.WriteFile(path, []byte(sysVInitScript), 0o755); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	fmt.Printf("  ✓ Installed init.d script %s\n", path)

	// chkconfig --add registers the service in runlevels 3/4/5.
	// Older RHEL-likes only — silently ignore failure on distros that
	// don't ship it (the script still works via manual `service` calls).
	_ = run("chkconfig", "--add", "obliance-agent")

	if err := run("service", "obliance-agent", "start"); err != nil {
		return fmt.Errorf("service obliance-agent start: %w", err)
	}
	fmt.Println("  ✓ Service started (SysV init)")
	return nil
}

// ── Tail-blob pre-fill (same wire format as the Windows wizard) ─────────────

func readEmbeddedConfig() embeddedConfig {
	var empty embeddedConfig
	exe, err := os.Executable()
	if err != nil {
		return empty
	}
	f, err := os.Open(exe)
	if err != nil {
		return empty
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return empty
	}
	size := stat.Size()
	if size < int64(len(cfgMagic)+4) {
		return empty
	}
	tail := make([]byte, len(cfgMagic)+4)
	if _, err := f.ReadAt(tail, size-int64(len(tail))); err != nil {
		return empty
	}
	if string(tail[:len(cfgMagic)]) != cfgMagic {
		return empty
	}
	cfgLen := int64(binary.LittleEndian.Uint32(tail[len(cfgMagic):]))
	if cfgLen <= 0 || cfgLen > cfgMaxBytes {
		return empty
	}
	cfgStart := size - int64(len(tail)) - cfgLen
	if cfgStart < 0 {
		return empty
	}
	buf := make([]byte, cfgLen)
	if _, err := f.ReadAt(buf, cfgStart); err != nil {
		return empty
	}
	var c embeddedConfig
	if err := json.Unmarshal(buf, &c); err != nil {
		return empty
	}
	return c
}

// ── Prompt helpers ──────────────────────────────────────────────────────────

func promptDefault(reader *bufio.Reader, label, defaultVal, hint string) string {
	if defaultVal != "" {
		fmt.Printf("  %s [%s]: ", label, defaultVal)
	} else {
		fmt.Printf("  %s (e.g. %s): ", label, hint)
	}
	line, _ := reader.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return defaultVal
	}
	return line
}

func promptYesNo(reader *bufio.Reader, label string, defaultYes bool) bool {
	suffix := " [Y/n]"
	if !defaultYes {
		suffix = " [y/N]"
	}
	fmt.Printf("  %s%s: ", label, suffix)
	line, _ := reader.ReadString('\n')
	line = strings.ToLower(strings.TrimSpace(line))
	if line == "" {
		return defaultYes
	}
	return line == "y" || line == "yes" || line == "o" || line == "oui"
}

// ── Misc ────────────────────────────────────────────────────────────────────

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run()
}

func humanSize(n int) string {
	const KB = 1024
	const MB = 1024 * 1024
	switch {
	case n >= MB:
		return fmt.Sprintf("%.1f MB", float64(n)/float64(MB))
	case n >= KB:
		return fmt.Sprintf("%.1f KB", float64(n)/float64(KB))
	}
	return fmt.Sprintf("%d B", n)
}
