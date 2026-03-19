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

// handleInstallOblireach downloads the Oblireach agent binary from the server,
// writes it to the standard install directory, writes its config file, and
// launches it as a background process.
//
// The Oblireach agent uses the same API key as this Obliance agent — the
// server identifies it by the hardware device UUID that both share.
func (d *CommandDispatcher) handleInstallOblireach(cmd AgentCommand) (interface{}, error) {
	log.Printf("Command %s: installing Oblireach agent", cmd.ID)

	// ── 1. Determine binary filename and install paths ─────────────────────
	filename := obliReachBinaryName()
	installDir := obliReachInstallDir()

	if err := os.MkdirAll(installDir, 0755); err != nil {
		return nil, fmt.Errorf("create install dir: %w", err)
	}

	binaryPath := filepath.Join(installDir, obliReachBinaryFileName())

	// ── 2. Download the binary from the Obliance server ────────────────────
	dlURL := d.serverURL + "/api/agent/download/" + filename
	log.Printf("Command %s: downloading Oblireach agent from %s", cmd.ID, dlURL)

	req, err := http.NewRequest("GET", dlURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build download request: %w", err)
	}
	req.Header.Set("X-Api-Key", d.apiKey)

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download Oblireach agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download Oblireach agent: server returned %d", resp.StatusCode)
	}

	// ── 3. Write binary to disk ────────────────────────────────────────────
	f, err := os.OpenFile(binaryPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return nil, fmt.Errorf("create binary file: %w", err)
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		return nil, fmt.Errorf("write binary: %w", err)
	}
	f.Close()
	log.Printf("Command %s: Oblireach agent written to %s", cmd.ID, binaryPath)

	// ── 4. Launch the Oblireach agent ──────────────────────────────────────
	// Pass --url and --key so it can configure itself on first run.
	// The agent will write its own config.json and self-start.
	if err := obliReachLaunch(binaryPath, d.serverURL, d.apiKey); err != nil {
		return nil, fmt.Errorf("launch Oblireach agent: %w", err)
	}

	log.Printf("Command %s: Oblireach agent launched successfully", cmd.ID)
	return map[string]string{"status": "launched", "path": binaryPath}, nil
}

// obliReachBinaryName returns the download filename for the current platform.
func obliReachBinaryName() string {
	switch runtime.GOOS {
	case "windows":
		return "oblireach-agent.exe"
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return "oblireach-agent-darwin-arm64"
		}
		return "oblireach-agent-darwin-amd64"
	default: // linux
		return "oblireach-agent-linux-amd64"
	}
}

// obliReachBinaryFileName returns just the local binary filename (no OS suffix).
func obliReachBinaryFileName() string {
	if runtime.GOOS == "windows" {
		return "oblireach-agent.exe"
	}
	return "oblireach-agent"
}

// obliReachInstallDir returns the platform-appropriate installation directory.
func obliReachInstallDir() string {
	switch runtime.GOOS {
	case "windows":
		programData := os.Getenv("PROGRAMDATA")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		return filepath.Join(programData, "ObliReachAgent")
	case "darwin":
		return "/Library/Application Support/ObliReachAgent"
	default:
		return "/opt/oblireach-agent"
	}
}

// obliReachLaunch starts the Oblireach agent binary as a detached background
// process. On Windows it also installs a scheduled task for autostart.
func obliReachLaunch(binaryPath, serverURL, apiKey string) error {
	args := []string{"--url", serverURL, "--key", apiKey}

	switch runtime.GOOS {
	case "windows":
		return obliReachLaunchWindows(binaryPath, args)
	default:
		return obliReachLaunchUnix(binaryPath, args)
	}
}

func obliReachLaunchWindows(binaryPath string, args []string) error {
	// Install a scheduled task so the agent restarts after reboots.
	taskArgs := append([]string{binaryPath}, args...)
	taskCmd := `"` + binaryPath + `" ` + joinArgs(args)
	schtasksCreate := exec.Command(
		"schtasks", "/Create",
		"/TN", "ObliReachAgent",
		"/TR", taskCmd,
		"/SC", "ONLOGON",
		"/RL", "HIGHEST",
		"/F", // overwrite existing
	)
	if err := schtasksCreate.Run(); err != nil {
		log.Printf("install_oblireach: schtasks create failed (non-fatal): %v", err)
	}

	// Launch immediately (don't wait for next logon).
	cmd := exec.Command(binaryPath, append(args, "--service")...)
	_ = taskArgs // suppress unused
	cmd.SysProcAttr = detachedProc()
	if err := cmd.Start(); err != nil {
		// Try /Run via schtasks as fallback
		_ = exec.Command("schtasks", "/Run", "/TN", "ObliReachAgent").Run()
		return nil // non-fatal if direct launch failed but schtasks worked
	}
	return nil
}

func obliReachLaunchUnix(binaryPath string, args []string) error {
	cmd := exec.Command(binaryPath, args...)
	cmd.SysProcAttr = detachedProc()
	return cmd.Start()
}

// joinArgs shell-quotes and joins arguments for a schtasks /TR value.
func joinArgs(args []string) string {
	result := ""
	for i, a := range args {
		if i > 0 {
			result += " "
		}
		if needsQuoting(a) {
			result += `"` + a + `"`
		} else {
			result += a
		}
	}
	return result
}

func needsQuoting(s string) bool {
	for _, c := range s {
		if c == ' ' || c == '\t' {
			return true
		}
	}
	return false
}
