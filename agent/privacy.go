package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// ── Privacy Mode ────────────────────────────────────────────────────────────────
//
// Privacy mode is controlled locally via the tray app or remotely via a server
// command. State is persisted in a JSON file so both the agent service (SYSTEM)
// and the tray app (user session) can read/write it atomically.

// privacyState is the on-disk format of privacy.json.
type privacyState struct {
	Enabled   bool   `json:"enabled"`
	ChangedAt string `json:"changedAt"`
	ChangedBy string `json:"changedBy"` // "user" or "remote"
}

var (
	privacyMu      sync.RWMutex
	privacyEnabled bool
	privacyFile    string
)

func init() {
	privacyFile = filepath.Join(configDir, "privacy.json")
}

// IsPrivacyMode returns the current in-memory privacy state.
func IsPrivacyMode() bool {
	privacyMu.RLock()
	defer privacyMu.RUnlock()
	return privacyEnabled
}

// IsPrivacyLocked returns true when privacy.json is read-only (admin lock).
func IsPrivacyLocked() bool {
	info, err := os.Stat(privacyFile)
	if err != nil {
		return false
	}
	// On Windows, os.FileMode only exposes the read-only attribute.
	// A read-only file has no write bit set.
	return info.Mode().Perm()&0200 == 0
}

// SetPrivacyMode updates privacy state, persists to disk, and manages the
// ObliReach service accordingly. Returns an error if the file is locked
// (read-only).
func SetPrivacyMode(enabled bool, changedBy string) error {
	if IsPrivacyLocked() {
		return fmt.Errorf("Privacy Mode locked on this device")
	}

	state := privacyState{
		Enabled:   enabled,
		ChangedAt: time.Now().UTC().Format(time.RFC3339),
		ChangedBy: changedBy,
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("privacy: marshal: %w", err)
	}
	if err := os.WriteFile(privacyFile, data, 0644); err != nil {
		return fmt.Errorf("privacy: write: %w", err)
	}

	privacyMu.Lock()
	privacyEnabled = enabled
	privacyMu.Unlock()

	if enabled {
		stopObliReachService()
	} else {
		startObliReachService()
	}

	// Notify server instantly via WebSocket command channel.
	SendOnCommandChannel(map[string]interface{}{
		"type":    "privacy_mode_changed",
		"enabled": enabled,
	})

	log.Printf("privacy: mode set to %v (by %s)", enabled, changedBy)
	return nil
}

// loadPrivacyState reads the current state from disk into memory.
func loadPrivacyState() {
	data, err := os.ReadFile(privacyFile)
	if err != nil {
		// File doesn't exist yet — privacy off by default.
		return
	}
	var state privacyState
	if err := json.Unmarshal(data, &state); err != nil {
		log.Printf("privacy: failed to parse %s: %v", privacyFile, err)
		return
	}
	privacyMu.Lock()
	privacyEnabled = state.Enabled
	privacyMu.Unlock()

	// Enforce ObliReach service state on startup.
	if state.Enabled {
		stopObliReachService()
	}
}

// watchPrivacyFile polls privacy.json every 2 seconds for changes made by the
// tray app. When the file changes, it updates the in-memory state and manages
// the ObliReach service.
func watchPrivacyFile(stopCh <-chan struct{}) {
	var lastModTime time.Time
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			info, err := os.Stat(privacyFile)
			if err != nil {
				continue
			}
			if info.ModTime().Equal(lastModTime) {
				continue
			}
			lastModTime = info.ModTime()

			data, err := os.ReadFile(privacyFile)
			if err != nil {
				continue
			}
			var state privacyState
			if err := json.Unmarshal(data, &state); err != nil {
				continue
			}

			privacyMu.Lock()
			changed := privacyEnabled != state.Enabled
			privacyEnabled = state.Enabled
			privacyMu.Unlock()

			if changed {
				if state.Enabled {
					stopObliReachService()
				} else {
					startObliReachService()
				}
				// Notify server instantly via WS.
				SendOnCommandChannel(map[string]interface{}{
					"type":    "privacy_mode_changed",
					"enabled": state.Enabled,
				})
				log.Printf("privacy: file changed — mode now %v (by %s)", state.Enabled, state.ChangedBy)
			}
		}
	}
}

// ── ObliReach service control ───────────────────────────────────────────────────

func stopObliReachService() {
	if runtime.GOOS != "windows" {
		return
	}
	// Stop the service and disable auto-start so it stays down across reboots.
	_ = exec.Command("sc", "stop", "ObliReachAgent").Run()
	if err := exec.Command("sc", "config", "ObliReachAgent", "start=", "disabled").Run(); err != nil {
		log.Printf("privacy: failed to disable ObliReachAgent: %v", err)
	}
}

func startObliReachService() {
	if runtime.GOOS != "windows" {
		return
	}
	// Only act if the service is registered (Oblireach was installed).
	out, err := exec.Command("sc", "query", "ObliReachAgent").Output()
	if err != nil || len(out) == 0 {
		return // service not installed
	}
	// Re-enable auto-start, then start.
	if err := exec.Command("sc", "config", "ObliReachAgent", "start=", "auto").Run(); err != nil {
		log.Printf("privacy: failed to re-enable ObliReachAgent: %v", err)
	}
	if err := exec.Command("sc", "start", "ObliReachAgent").Run(); err != nil {
		log.Printf("privacy: failed to start ObliReachAgent: %v", err)
	}
}
