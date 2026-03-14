package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// handleUninstallCommand is called when the server delivers an 'uninstall' command
// in a push response. It writes a detached OS-appropriate uninstall script and
// exits immediately, allowing the script to outlive the agent process.
//
// The script approach is used on all platforms so the cleanup commands run after
// the agent process (and its service supervisor) have fully stopped.
func handleUninstallCommand(cfg *Config) {
	log.Printf("Uninstall command received — initiating self-removal...")

	var err error
	switch runtime.GOOS {
	case "windows":
		err = handleWindowsUninstall(cfg)
	case "linux":
		err = handleLinuxUninstall()
	case "darwin":
		err = handleDarwinUninstall()
	default:
		log.Printf("Uninstall: unsupported platform %q — ignoring command", runtime.GOOS)
		return
	}

	if err != nil {
		log.Printf("Uninstall: failed to launch uninstall script: %v", err)
		return
	}

	log.Printf("Uninstall: script launched, shutting down agent...")
	os.Exit(0)
}

// ── Windows ───────────────────────────────────────────────────────────────────

// handleWindowsUninstall downloads the MSI and runs msiexec /x via a detached
// batch script. The MSI uninstall stops the service, removes all files and the
// PawnIO kernel driver (via WiX ServiceControl + CA.UninstallPawnIO).
func handleWindowsUninstall(cfg *Config) error {
	// Download the MSI to a temp path
	msiPath := filepath.Join(os.TempDir(), "obliance-uninstall.msi")
	if err := downloadFile(cfg.ServerURL+"/api/agent/download/obliance-agent.msi", msiPath); err != nil {
		return fmt.Errorf("download MSI: %w", err)
	}

	logPath := filepath.Join(os.TempDir(), "obliance-uninstall.log")
	scriptPath := filepath.Join(os.TempDir(), "obliance-uninstall.bat")

	script := fmt.Sprintf(
		"@echo off\r\n"+
			"timeout /t 2 /nobreak >nul\r\n"+
			"msiexec /x \"%s\" /quiet /norestart /l*v \"%s\"\r\n"+
			"del /q \"%s\"\r\n"+
			"del /q \"%%~f0\"\r\n",
		msiPath, logPath, msiPath)

	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return fmt.Errorf("write uninstall batch: %w", err)
	}

	return exec.Command("cmd", "/c", scriptPath).Start()
}

// ── Linux ─────────────────────────────────────────────────────────────────────

// handleLinuxUninstall writes a shell script that stops and removes the
// obliance-agent systemd (or init.d) service and its binary, then runs it
// detached so it survives the agent process exit.
func handleLinuxUninstall() error {
	scriptPath := "/tmp/obliance-uninstall.sh"
	script := "#!/bin/sh\n" +
		"sleep 2\n" +
		// Stop and disable — works for both systemd and SysV init
		"systemctl stop obliance-agent 2>/dev/null || service obliance-agent stop 2>/dev/null || true\n" +
		"systemctl disable obliance-agent 2>/dev/null || true\n" +
		// Remove service unit / init script
		"rm -f /etc/systemd/system/obliance-agent.service /etc/init.d/obliance-agent\n" +
		"systemctl daemon-reload 2>/dev/null || true\n" +
		// Remove binary and install directory (config at /etc/obliance-agent/ is kept)
		"rm -rf /opt/obliance-agent/\n" +
		// Self-delete
		"rm -f \"$0\"\n"

	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		return fmt.Errorf("write uninstall script: %w", err)
	}

	return exec.Command("sh", scriptPath).Start()
}

// ── macOS ─────────────────────────────────────────────────────────────────────

// handleDarwinUninstall writes a shell script that unloads the launchd daemon,
// removes the plist and the installed binary, then runs it detached.
// Config and logs at /etc/obliance-agent/ and /var/log/obliance-agent.log are
// preserved (same behaviour as `obliance-agent uninstall`).
func handleDarwinUninstall() error {
	const plist = "/Library/LaunchDaemons/com.obliance.agent.plist"
	const binary = "/usr/local/bin/obliance-agent"

	scriptPath := "/tmp/obliance-uninstall.sh"
	script := "#!/bin/sh\n" +
		"sleep 2\n" +
		// Unload the launchd daemon (prevents auto-restart)
		"launchctl unload " + plist + " 2>/dev/null || true\n" +
		"rm -f " + plist + "\n" +
		"rm -f " + binary + "\n" +
		// Self-delete
		"rm -f \"$0\"\n"

	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		return fmt.Errorf("write uninstall script: %w", err)
	}

	return exec.Command("sh", scriptPath).Start()
}

// ── Shared helper ─────────────────────────────────────────────────────────────

// downloadFile downloads url and writes it to destPath, creating the file if
// needed. Uses a 120-second timeout (same as the auto-update download).
func downloadFile(url, destPath string) error {
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	f, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	return err
}
