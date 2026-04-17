//go:build !windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ensureWatchdogRegistered verifies that the obliance-watchdog.timer is
// enabled + active, and re-installs the unit files if they went missing.
// Linux / macOS / FreeBSD share this code path (systemctl availability is
// checked at runtime; if absent, we skip silently).
func ensureWatchdogRegistered() error {
	// Only systemd is supported for the watchdog on unix — if systemctl
	// is missing (alpine + openrc, minimal containers), bail out.
	if _, err := exec.LookPath("systemctl"); err != nil {
		return nil
	}

	out, _ := exec.Command("systemctl", "is-enabled", "obliance-watchdog.timer").CombinedOutput()
	if strings.Contains(string(out), "enabled") {
		return nil
	}

	// Unit file missing — attempt to recreate it if we can find the
	// watchdog binary next to the running agent.
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	wdPath := filepath.Join(filepath.Dir(exe), "obliance-watchdog")
	if _, err := os.Stat(wdPath); err != nil {
		return err
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
