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

	// ── Windows: use MSI for proper Programs registration + service install ─
	if runtime.GOOS == "windows" {
		return d.installObliReachMSI(cmd)
	}

	// ── Non-Windows: download binary and launch directly ───────────────────
	filename := obliReachBinaryName()
	installDir := obliReachInstallDir()

	if err := os.MkdirAll(installDir, 0755); err != nil {
		return nil, fmt.Errorf("create install dir: %w", err)
	}

	binaryPath := filepath.Join(installDir, obliReachBinaryFileName())

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

	if err := obliReachLaunch(binaryPath, d.serverURL, d.apiKey); err != nil {
		return nil, fmt.Errorf("launch Oblireach agent: %w", err)
	}

	log.Printf("Command %s: Oblireach agent launched successfully", cmd.ID)
	return map[string]string{"status": "launched", "path": binaryPath}, nil
}

// installObliReachMSI downloads the Oblireach MSI and installs it silently.
// The MSI registers the service and appears in "Programs and Features".
func (d *CommandDispatcher) installObliReachMSI(cmd AgentCommand) (interface{}, error) {
	msiURL := d.serverURL + "/api/agent/download/oblireach-agent.msi"
	log.Printf("Command %s: downloading Oblireach MSI from %s", cmd.ID, msiURL)

	req, err := http.NewRequest("GET", msiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build MSI request: %w", err)
	}
	req.Header.Set("X-Api-Key", d.apiKey)

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download MSI: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download MSI: server returned %d", resp.StatusCode)
	}

	tmpPath := filepath.Join(os.TempDir(), "oblireach-install.msi")
	f, err := os.Create(tmpPath)
	if err != nil {
		return nil, fmt.Errorf("create temp file: %w", err)
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		return nil, fmt.Errorf("write MSI: %w", err)
	}
	f.Close()
	log.Printf("Command %s: MSI downloaded to %s, running msiexec", cmd.ID, tmpPath)

	// /quiet = silent, /norestart = no reboot, log to temp file for debug
	msiCmd := exec.Command("msiexec.exe",
		"/i", tmpPath,
		"SERVERURL="+d.serverURL,
		"APIKEY="+d.apiKey,
		"/quiet", "/norestart",
		"/l*v", filepath.Join(os.TempDir(), "oblireach-install.log"),
	)
	if err := msiCmd.Run(); err != nil {
		return nil, fmt.Errorf("msiexec failed: %w (log: %s)",
			err, filepath.Join(os.TempDir(), "oblireach-install.log"))
	}

	log.Printf("Command %s: Oblireach agent installed via MSI", cmd.ID)
	return map[string]string{"status": "installed", "method": "msi"}, nil
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
	// Build the service binPath (quoted exe + args).
	binPath := `"` + binaryPath + `" ` + joinArgs(args)

	// Stop + delete any existing instance first (ignore errors).
	_ = exec.Command("sc", "stop", "ObliReachAgent").Run()
	_ = exec.Command("sc", "delete", "ObliReachAgent").Run()

	// Create the service running as LocalSystem (= SYSTEM account).
	// This grants WTSQueryUserToken privilege needed for cross-session capture.
	createCmd := exec.Command(
		"sc", "create", "ObliReachAgent",
		"binPath=", binPath,
		"DisplayName=", "Oblireach Remote Agent",
		"start=", "auto",
		"obj=", "LocalSystem",
	)
	if err := createCmd.Run(); err != nil {
		log.Printf("install_oblireach: sc create failed: %v", err)
		return fmt.Errorf("sc create ObliReachAgent: %w", err)
	}

	// Start the service immediately.
	if err := exec.Command("sc", "start", "ObliReachAgent").Run(); err != nil {
		log.Printf("install_oblireach: sc start failed (non-fatal): %v", err)
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
