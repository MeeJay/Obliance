package main

// watchdog.go — agent-side handling of the external OS watchdog state.
//
// The watchdog (Windows Scheduled Task / Linux systemd timer) runs every
// few minutes and, if the Obliance agent service is dead, restarts it
// and appends a timestamp to `watchdog.json` in configDir.
//
// On each push, the agent reads this file, reports the accumulated
// restarts to the server, and clears the file on a successful push.
//
// The file also carries an inhibit flag (`inhibitUntil`) that the agent
// writes before an auto-update so the watchdog won't nervously relaunch
// the service while `msiexec` is stopping/upgrading it.

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// watchdogState is the on-disk format of watchdog.json.
// The watchdog script (PowerShell / bash) reads + writes this file, as
// does the agent. Writes are always "read-modify-write" with a mutex on
// the agent side; on the watchdog side the script writes the full blob.
type watchdogState struct {
	// Restarts triggered by the watchdog since the last successful push,
	// as RFC3339 timestamps in chronological order.
	Restarts []string `json:"restarts"`
	// If set and in the future, the watchdog MUST NOT restart the service.
	// Used by the agent to pause watchdog during auto-update windows.
	InhibitUntil string `json:"inhibitUntil,omitempty"`
}

var (
	watchdogMu sync.Mutex
)

func watchdogFilePath() string {
	return filepath.Join(configDir, "watchdog.json")
}

func readWatchdogState() watchdogState {
	var s watchdogState
	data, err := os.ReadFile(watchdogFilePath())
	if err != nil {
		return s
	}
	_ = json.Unmarshal(data, &s)
	return s
}

func writeWatchdogState(s watchdogState) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	// Ensure the config directory exists (first-run case).
	_ = os.MkdirAll(configDir, 0o755)
	return os.WriteFile(watchdogFilePath(), data, 0o644)
}

// drainWatchdogRestarts returns the accumulated restart timestamps and
// the most recent one, then clears the `Restarts` list while preserving
// any inhibit flag. Call this BEFORE pushing; if the push fails, the
// caller should restore the list with restoreWatchdogRestarts().
func drainWatchdogRestarts() (count int, last string) {
	watchdogMu.Lock()
	defer watchdogMu.Unlock()
	s := readWatchdogState()
	if len(s.Restarts) == 0 {
		return 0, ""
	}
	count = len(s.Restarts)
	last = s.Restarts[len(s.Restarts)-1]
	s.Restarts = nil
	if err := writeWatchdogState(s); err != nil {
		log.Printf("[watchdog] drain write failed: %v", err)
	}
	return count, last
}

// restoreWatchdogRestarts puts timestamps back into the list if a push
// failed to deliver them. We don't try to preserve exact timestamps —
// just keep the count so the server eventually learns about them.
func restoreWatchdogRestarts(count int, last string) {
	if count <= 0 {
		return
	}
	watchdogMu.Lock()
	defer watchdogMu.Unlock()
	s := readWatchdogState()
	ts := last
	if ts == "" {
		ts = time.Now().UTC().Format(time.RFC3339)
	}
	for i := 0; i < count; i++ {
		s.Restarts = append(s.Restarts, ts)
	}
	_ = writeWatchdogState(s)
}

// InhibitWatchdog prevents the external watchdog from restarting the
// agent service for `d`. Intended to be called right before the agent
// triggers msiexec/installer so that the 5-minute install window does
// not race with a watchdog tick. Multiple calls extend the inhibit; the
// longer of (current inhibit, now+d) wins.
func InhibitWatchdog(d time.Duration) {
	watchdogMu.Lock()
	defer watchdogMu.Unlock()
	s := readWatchdogState()
	newUntil := time.Now().Add(d).UTC()
	if s.InhibitUntil != "" {
		if cur, err := time.Parse(time.RFC3339, s.InhibitUntil); err == nil {
			if cur.After(newUntil) {
				newUntil = cur
			}
		}
	}
	s.InhibitUntil = newUntil.Format(time.RFC3339)
	if err := writeWatchdogState(s); err != nil {
		log.Printf("[watchdog] inhibit write failed: %v", err)
		return
	}
	log.Printf("[watchdog] inhibited until %s", s.InhibitUntil)
}

// ClearWatchdogInhibit removes any inhibit flag (e.g. after a successful
// update so the watchdog can resume normally).
func ClearWatchdogInhibit() {
	watchdogMu.Lock()
	defer watchdogMu.Unlock()
	s := readWatchdogState()
	if s.InhibitUntil == "" {
		return
	}
	s.InhibitUntil = ""
	_ = writeWatchdogState(s)
}

// EnsureWatchdogRegistered is called at agent startup to self-heal the
// watchdog registration: if the Scheduled Task (Windows) or systemd timer
// (Linux) has been removed by a user, we put it back. Implementation is
// platform-specific (see watchdog_windows.go / watchdog_unix.go).
// A noop/error-returning stub is provided for unsupported platforms so
// the agent still starts.
func EnsureWatchdogRegistered() {
	if err := ensureWatchdogRegistered(); err != nil {
		log.Printf("[watchdog] self-heal failed: %v", err)
	}
}
