// obliance-watchdog — tiny sentinel that keeps the Obliance agent alive.
//
// Invoked every N minutes by a Scheduled Task (Windows) or systemd timer
// (Linux). Behaviour:
//
//  1. If watchdog.json has `inhibitUntil > now`, bail out (agent is in the
//     middle of an auto-update and the service stop/start is expected).
//  2. Check whether the OblianceAgent service is Running.
//  3. If not running → start it, append a RFC3339 timestamp to
//     watchdog.json so the agent can report it on the next push.
//
// Intentionally kept small + dependency-free. Runs as SYSTEM on Windows
// and as root on Linux.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const serviceName = "OblianceAgent"

// watchdogState mirrors the structure in agent/watchdog.go.
type watchdogState struct {
	Restarts     []string `json:"restarts"`
	InhibitUntil string   `json:"inhibitUntil,omitempty"`
}

func configDir() string {
	if runtime.GOOS == "windows" {
		programData := os.Getenv("PROGRAMDATA")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		return filepath.Join(programData, "OblianceAgent")
	}
	return "/etc/obliance-agent"
}

func statePath() string {
	return filepath.Join(configDir(), "watchdog.json")
}

func readState() watchdogState {
	var s watchdogState
	data, err := os.ReadFile(statePath())
	if err != nil {
		return s
	}
	_ = json.Unmarshal(data, &s)
	return s
}

func writeState(s watchdogState) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	_ = os.MkdirAll(configDir(), 0o755)
	return os.WriteFile(statePath(), data, 0o644)
}

// isInhibited returns true if the agent asked us to pause (auto-update).
func isInhibited(s watchdogState) bool {
	if s.InhibitUntil == "" {
		return false
	}
	t, err := time.Parse(time.RFC3339, s.InhibitUntil)
	if err != nil {
		return false
	}
	return time.Now().Before(t)
}

// isServiceRunning queries the OS for the agent service state.
func isServiceRunning() (bool, error) {
	switch runtime.GOOS {
	case "windows":
		// `sc query OblianceAgent` — look for "STATE : 4 RUNNING"
		out, err := exec.Command("sc", "query", serviceName).CombinedOutput()
		if err != nil {
			// Service may not exist — treat as not running so we log the
			// failure but don't loop trying to start a missing service.
			if strings.Contains(string(out), "1060") || strings.Contains(strings.ToLower(string(out)), "does not exist") {
				return false, fmt.Errorf("service %s is not installed", serviceName)
			}
			return false, err
		}
		return strings.Contains(string(out), "RUNNING"), nil
	default:
		// systemctl is-active returns 0 when active, non-zero otherwise.
		cmd := exec.Command("systemctl", "is-active", "obliance-agent")
		out, _ := cmd.CombinedOutput()
		return strings.TrimSpace(string(out)) == "active", nil
	}
}

// isAgentProcessRunning reports whether any process named `obliance-agent`
// is currently running — including one started manually from a command
// prompt (not via SCM). Used to avoid launching a second agent instance
// that would fight the first one for the server's WS command-channel slot
// ("replaced" loop).
func isAgentProcessRunning() bool {
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("tasklist", "/FI", "IMAGENAME eq obliance-agent.exe", "/NH").CombinedOutput()
		if err != nil {
			return false
		}
		return strings.Contains(strings.ToLower(string(out)), "obliance-agent.exe")
	default:
		// pgrep returns 0 if it finds a match, 1 if not.
		err := exec.Command("pgrep", "-x", "obliance-agent").Run()
		return err == nil
	}
}

// startService asks the OS to (re)start the agent service.
func startService() error {
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("sc", "start", serviceName).CombinedOutput()
		if err != nil {
			return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	default:
		out, err := exec.Command("systemctl", "start", "obliance-agent").CombinedOutput()
		if err != nil {
			return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}
}

func recordRestart() {
	s := readState()
	s.Restarts = append(s.Restarts, time.Now().UTC().Format(time.RFC3339))
	if err := writeState(s); err != nil {
		log.Printf("watchdog: write state failed: %v", err)
	}
}

func main() {
	// Log to stderr — the Scheduled Task / systemd timer will capture it.
	log.SetFlags(log.LstdFlags)
	log.SetPrefix("[obliance-watchdog] ")

	state := readState()
	if isInhibited(state) {
		log.Printf("inhibited until %s — skipping check", state.InhibitUntil)
		return
	}

	running, err := isServiceRunning()
	if err != nil {
		log.Printf("service check failed: %v", err)
		return
	}
	if running {
		// Everything fine.
		return
	}

	// Service is stopped — but before we restart, check if an admin is
	// already running the agent binary manually (e.g. `obliance-agent.exe`
	// from a command prompt for interactive debugging). Starting the
	// service on top of that spawns a second agent process sharing the
	// same hardware UUID; both then fight for the server's WS
	// command-channel slot and each kicks the other with close code 1000
	// "replaced", so the device flaps offline forever.
	if isAgentProcessRunning() {
		log.Printf("%s service is stopped but an agent process is already running — skipping restart", serviceName)
		return
	}

	log.Printf("%s is not running — attempting restart", serviceName)
	if err := startService(); err != nil {
		log.Printf("start failed: %v", err)
		return
	}
	recordRestart()
	log.Printf("%s restarted successfully", serviceName)
}
