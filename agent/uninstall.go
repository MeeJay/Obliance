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

// handleUninstallAgent is called when the server delivers an 'uninstall_agent'
// command via WebSocket. It schedules a 10-minute countdown in a goroutine,
// then notifies the server (DELETE /api/agent/self) and runs the platform
// uninstall script. The goroutine exits the agent process after the script is
// launched, so cleanup commands outlive the agent process.
func (d *CommandDispatcher) handleUninstallAgent() error {
	log.Printf("Uninstall command received — agent will self-remove in 10 minutes...")
	go func() {
		const countdownSec = 600
		ticker := time.NewTicker(60 * time.Second)
		remaining := countdownSec
		for remaining > 0 {
			<-ticker.C
			remaining -= 60
			if remaining > 0 {
				log.Printf("Uninstall countdown: %d minutes remaining...", remaining/60)
			}
		}
		ticker.Stop()

		log.Printf("Uninstall: notifying server to delete device record...")
		d.notifyServerSelfDelete()

		log.Printf("Uninstall: launching platform uninstall...")
		var err error
		switch runtime.GOOS {
		case "windows":
			err = handleWindowsUninstall(d.serverURL, d.apiKey)
		case "linux":
			err = handleLinuxUninstall()
		case "darwin":
			err = handleDarwinUninstall()
		default:
			log.Printf("Uninstall: unsupported platform %q", runtime.GOOS)
			return
		}
		if err != nil {
			log.Printf("Uninstall: failed to launch uninstall script: %v", err)
			return
		}
		log.Printf("Uninstall: script launched — shutting down agent...")
		os.Exit(0)
	}()
	return nil
}

// notifyServerSelfDelete calls DELETE /api/agent/self so the server removes
// this device from the database before the agent disappears.
func (d *CommandDispatcher) notifyServerSelfDelete() {
	req, err := http.NewRequest("DELETE", d.serverURL+"/api/agent/self", nil)
	if err != nil {
		log.Printf("Uninstall: failed to build self-delete request: %v", err)
		return
	}
	req.Header.Set("X-API-Key", d.apiKey)
	req.Header.Set("X-Device-UUID", d.deviceUUID)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Uninstall: self-delete request failed: %v", err)
		return
	}
	resp.Body.Close()
	log.Printf("Uninstall: server responded %d to self-delete", resp.StatusCode)
}

// handleUninstallCommand is the legacy entry point for the string-based "uninstall"
// command received via push response. It immediately notifies the server to delete
// the device record, then launches the platform-specific uninstall script and exits.
func handleUninstallCommand(cfg *Config) {
	log.Printf("Legacy uninstall command received — self-removing now...")

	// Best-effort server notification.
	req, err := http.NewRequest("DELETE", cfg.ServerURL+"/api/agent/self", nil)
	if err == nil {
		req.Header.Set("X-API-Key", cfg.APIKey)
		req.Header.Set("X-Device-UUID", cfg.DeviceUUID)
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(req)
		if err == nil {
			resp.Body.Close()
		}
	}

	var uninstallErr error
	switch runtime.GOOS {
	case "windows":
		uninstallErr = handleWindowsUninstall(cfg.ServerURL, cfg.APIKey)
	case "linux":
		uninstallErr = handleLinuxUninstall()
	case "darwin":
		uninstallErr = handleDarwinUninstall()
	default:
		log.Printf("Uninstall not supported on %s", runtime.GOOS)
		return
	}
	if uninstallErr != nil {
		log.Printf("Uninstall script error: %v", uninstallErr)
		return
	}
	log.Printf("Uninstall script launched — exiting agent")
	os.Exit(0)
}

// ── Windows ───────────────────────────────────────────────────────────────────

func handleWindowsUninstall(serverURL, apiKey string) error {
	scriptPath := filepath.Join(os.TempDir(), "obliance-uninstall.bat")

	// Direct cleanup: stop + delete service, remove files and registry.
	// More reliable than msiexec /x which requires a matching ProductCode.
	script := "@echo off\r\n" +
		"timeout /t 3 /nobreak >nul\r\n" +
		"sc stop OblianceAgent >nul 2>&1\r\n" +
		"timeout /t 2 /nobreak >nul\r\n" +
		"sc delete OblianceAgent >nul 2>&1\r\n" +
		"rd /s /q \"C:\\Program Files\\OblianceAgent\" >nul 2>&1\r\n" +
		"rd /s /q \"C:\\ProgramData\\OblianceAgent\" >nul 2>&1\r\n" +
		"reg delete \"HKLM\\SOFTWARE\\OblianceAgent\" /f >nul 2>&1\r\n" +
		"del /q \"%~f0\"\r\n"

	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return fmt.Errorf("write uninstall batch: %w", err)
	}

	// VBS wrapper — run the batch script with hidden window (0 = vbHide)
	vbsPath := filepath.Join(os.TempDir(), "obliance-uninstall.vbs")
	vbs := fmt.Sprintf("CreateObject(\"WScript.Shell\").Run \"%s\", 0, False\r\n", scriptPath)
	if err := os.WriteFile(vbsPath, []byte(vbs), 0644); err != nil {
		return fmt.Errorf("write uninstall VBS wrapper: %w", err)
	}
	return exec.Command("wscript.exe", vbsPath).Start()
}

// ── Linux ─────────────────────────────────────────────────────────────────────

func handleLinuxUninstall() error {
	scriptPath := "/tmp/obliance-uninstall.sh"
	script := "#!/bin/sh\n" +
		"sleep 2\n" +
		"systemctl stop obliance-agent 2>/dev/null || service obliance-agent stop 2>/dev/null || true\n" +
		"systemctl disable obliance-agent 2>/dev/null || true\n" +
		"rm -f /etc/systemd/system/obliance-agent.service /etc/init.d/obliance-agent\n" +
		"systemctl daemon-reload 2>/dev/null || true\n" +
		"rm -rf /opt/obliance-agent/\n" +
		"rm -f \"$0\"\n"

	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		return fmt.Errorf("write uninstall script: %w", err)
	}
	return exec.Command("sh", scriptPath).Start()
}

// ── macOS ─────────────────────────────────────────────────────────────────────

func handleDarwinUninstall() error {
	const plist  = "/Library/LaunchDaemons/com.obliance.agent.plist"
	const binary = "/usr/local/bin/obliance-agent"

	scriptPath := "/tmp/obliance-uninstall.sh"
	script := "#!/bin/sh\n" +
		"sleep 2\n" +
		"launchctl unload " + plist + " 2>/dev/null || true\n" +
		"rm -f " + plist + "\n" +
		"rm -f " + binary + "\n" +
		"rm -f \"$0\"\n"

	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		return fmt.Errorf("write uninstall script: %w", err)
	}
	return exec.Command("sh", scriptPath).Start()
}

// ── Helper ────────────────────────────────────────────────────────────────────

func downloadMSI(url, apiKey, destPath string) error {
	client := &http.Client{Timeout: 120 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}
	resp, err := client.Do(req)
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
