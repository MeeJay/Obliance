//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ensureWatchdogRegistered verifies that the "OblianceWatchdog" Scheduled
// Task exists, and recreates it if missing. The task runs the watchdog
// binary shipped alongside the agent, every 5 minutes, as SYSTEM.
// cfg is currently unused on Windows (the MSI ships the binary), but the
// signature matches the unix path so the call site stays portable.
func ensureWatchdogRegistered(_ *Config) error {
	// Query the task; if it exists, we're done.
	out, err := exec.Command("schtasks", "/Query", "/TN", "OblianceWatchdog").CombinedOutput()
	if err == nil && strings.Contains(string(out), "OblianceWatchdog") {
		return nil
	}

	// Resolve the path to the watchdog binary — it lives next to obliance-agent.exe.
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	wdPath := filepath.Join(filepath.Dir(exe), "obliance-watchdog.exe")
	if _, err := os.Stat(wdPath); err != nil {
		// Binary not deployed yet — nothing to register.
		return err
	}

	createArgs := []string{
		"/Create",
		"/TN", "OblianceWatchdog",
		"/TR", `"` + wdPath + `"`,
		"/SC", "MINUTE",
		"/MO", "5",
		"/RU", "SYSTEM",
		"/RL", "HIGHEST",
		"/F",
	}
	_, err = exec.Command("schtasks", createArgs...).CombinedOutput()
	return err
}
