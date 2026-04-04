package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ── Airgap Mode ─────────────────────────────────────────────────────────────────
//
// Airgap mode restricts the device's network access to only the Obliance server
// IPs via OS-level firewall rules. State is persisted in a JSON file so it
// survives reboots. Unlike privacy mode, airgap has no local lock mechanism —
// it is controlled exclusively via server commands.

// airgapState is the on-disk format of airgap.json.
type airgapState struct {
	Enabled   bool     `json:"enabled"`
	ChangedAt string   `json:"changedAt"`
	ChangedBy string   `json:"changedBy"` // "remote" or "user"
	ServerIPs []string `json:"serverIPs"` // IPs to whitelist in firewall rules
}

var (
	airgapMu      sync.RWMutex
	airgapEnabled bool
	airgapFile    string
)

func init() {
	airgapFile = filepath.Join(configDir, "airgap.json")
}

// IsAirgapMode returns the current in-memory airgap state.
func IsAirgapMode() bool {
	airgapMu.RLock()
	defer airgapMu.RUnlock()
	return airgapEnabled
}

// SetAirgapMode updates airgap state, persists to disk, and applies or removes
// firewall rules accordingly. After applying rules, it verifies connectivity
// to the server; if unreachable within 10 seconds, the rules are rolled back.
func SetAirgapMode(enabled bool, changedBy string, serverIPs []string) error {
	if enabled {
		// Apply firewall rules first, then verify connectivity.
		if err := applyAirgapFirewallRules(serverIPs); err != nil {
			return fmt.Errorf("airgap: apply firewall rules: %w", err)
		}

		// Verify we can still reach the server. If not, restore firewall immediately.
		if err := verifyServerConnectivity(); err != nil {
			log.Printf("airgap: connectivity check failed after applying rules, restoring firewall: %v", err)
			if restoreErr := removeAirgapFirewallRules(); restoreErr != nil {
				log.Printf("airgap: CRITICAL — firewall restore also failed: %v", restoreErr)
			}
			return fmt.Errorf("airgap: server unreachable after applying rules, firewall restored: %w", err)
		}
	} else {
		if err := removeAirgapFirewallRules(); err != nil {
			return fmt.Errorf("airgap: remove firewall rules: %w", err)
		}
	}

	// Persist state to disk.
	state := airgapState{
		Enabled:   enabled,
		ChangedAt: time.Now().UTC().Format(time.RFC3339),
		ChangedBy: changedBy,
		ServerIPs: serverIPs,
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("airgap: marshal: %w", err)
	}
	if err := os.WriteFile(airgapFile, data, 0644); err != nil {
		return fmt.Errorf("airgap: write: %w", err)
	}

	airgapMu.Lock()
	airgapEnabled = enabled
	airgapMu.Unlock()

	// Notify server instantly via WebSocket command channel.
	SendOnCommandChannel(map[string]interface{}{
		"type":    "airgap_mode_changed",
		"enabled": enabled,
	})

	log.Printf("airgap: mode set to %v (by %s, IPs: %v)", enabled, changedBy, serverIPs)
	return nil
}

// loadAirgapState reads the current state from disk into memory and re-applies
// firewall rules if airgap was previously enabled.
func loadAirgapState() {
	data, err := os.ReadFile(airgapFile)
	if err != nil {
		// File doesn't exist yet — airgap off by default.
		return
	}
	var state airgapState
	if err := json.Unmarshal(data, &state); err != nil {
		log.Printf("airgap: failed to parse %s: %v", airgapFile, err)
		return
	}
	airgapMu.Lock()
	airgapEnabled = state.Enabled
	airgapMu.Unlock()

	// Re-apply firewall rules on startup if airgap was enabled.
	if state.Enabled {
		if err := applyAirgapFirewallRules(state.ServerIPs); err != nil {
			log.Printf("airgap: failed to re-apply firewall rules on startup: %v", err)
		} else {
			log.Printf("airgap: firewall rules re-applied on startup (IPs: %v)", state.ServerIPs)
		}
	}
}

// verifyServerConnectivity checks that the agent can reach the Obliance server
// within 10 seconds. Uses the configured server URL from the global config.
func verifyServerConnectivity() error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("cannot load config to verify connectivity: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(cfg.ServerURL + "/api/agent/version")
	if err != nil {
		return fmt.Errorf("server unreachable: %w", err)
	}
	resp.Body.Close()

	if resp.StatusCode >= 500 {
		return fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	return nil
}
