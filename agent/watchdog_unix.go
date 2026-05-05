//go:build !windows

package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ensureWatchdogRegistered verifies that the obliance-watchdog.timer is
// enabled + active, re-downloads the watchdog binary if it went missing,
// and re-installs the systemd unit files if needed. Linux / macOS /
// FreeBSD share this code path (systemctl availability is checked at
// runtime; if absent, we skip silently).
func ensureWatchdogRegistered(cfg *Config) error {
	// Only systemd is supported for the watchdog on unix — if systemctl
	// is missing (alpine + openrc, minimal containers), bail out.
	if _, err := exec.LookPath("systemctl"); err != nil {
		return nil
	}

	out, _ := exec.Command("systemctl", "is-enabled", "obliance-watchdog.timer").CombinedOutput()
	if strings.Contains(string(out), "enabled") {
		return nil
	}

	// Resolve the expected binary location next to the running agent.
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	wdPath := filepath.Join(filepath.Dir(exe), "obliance-watchdog")

	// If the binary is missing (install.sh failed to download it, or the
	// user wiped the install dir), pull it from the server so subsequent
	// boots stop looping on the same self-heal error.
	if _, err := os.Stat(wdPath); err != nil {
		if cfg == nil || cfg.ServerURL == "" {
			return err
		}
		if dlErr := downloadWatchdogBinary(cfg, wdPath); dlErr != nil {
			return fmt.Errorf("download watchdog: %w (stat error: %v)", dlErr, err)
		}
	}

	serviceUnit := `[Unit]
Description=Obliance Agent Watchdog (one-shot)
After=network.target

[Service]
Type=oneshot
User=root
ExecStart=` + wdPath + `
`
	timerUnit := `[Unit]
Description=Run Obliance Agent Watchdog every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=obliance-watchdog.service

[Install]
WantedBy=timers.target
`

	if err := os.WriteFile("/etc/systemd/system/obliance-watchdog.service", []byte(serviceUnit), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile("/etc/systemd/system/obliance-watchdog.timer", []byte(timerUnit), 0o644); err != nil {
		return err
	}
	_ = exec.Command("systemctl", "daemon-reload").Run()
	return exec.Command("systemctl", "enable", "--now", "obliance-watchdog.timer").Run()
}

// downloadWatchdogBinary fetches obliance-watchdog-{os}-{arch} from the
// server and writes it to dst with 0755. Same endpoint the install.sh
// uses; reuses the agent's API key for auth.
func downloadWatchdogBinary(cfg *Config, dst string) error {
	filename := watchdogBinaryName()
	if filename == "" {
		return fmt.Errorf("no watchdog binary defined for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	url := strings.TrimRight(cfg.ServerURL, "/") + "/api/agent/download/" + filename

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	if cfg.APIKey != "" {
		req.Header.Set("X-Api-Key", cfg.APIKey)
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	// Write to a sibling tmp file then rename so a partial download never
	// leaves a half-written binary that systemd would try to exec.
	tmp := dst + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return err
	}
	f.Close()
	return os.Rename(tmp, dst)
}

// watchdogBinaryName picks the right artifact for the current platform.
// Returns empty when the platform/arch combo isn't published.
func watchdogBinaryName() string {
	switch runtime.GOOS {
	case "linux":
		switch runtime.GOARCH {
		case "amd64": return "obliance-watchdog-linux-amd64"
		case "arm64": return "obliance-watchdog-linux-arm64"
		}
	case "darwin":
		switch runtime.GOARCH {
		case "amd64": return "obliance-watchdog-darwin-amd64"
		case "arm64": return "obliance-watchdog-darwin-arm64"
		}
	case "freebsd":
		if runtime.GOARCH == "amd64" {
			return "obliance-watchdog-freebsd-amd64"
		}
	}
	return ""
}
