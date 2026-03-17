package main

// command_poller.go — dedicated lightweight command-poll goroutine.
//
// When the persistent command channel (command_channel.go) is temporarily
// unavailable (e.g. proxy restart, reconnect back-off), commands queued in
// the server DB would otherwise not be dispatched until the next full push
// cycle (up to CheckIntervalSeconds, default 60 s).
//
// This goroutine polls GET /api/agent/commands at a much shorter interval
// (default 10 s, admin-configurable as "Task Retrieve Delay").  It dispatches
// any pending commands via the same dispatcher used by push() and the command
// channel, so acks are accumulated and sent on the next push.
//
// The endpoint is lightweight — no metrics are sent, and the server only
// queries the command queue.

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type commandPollResponse struct {
	Commands         []AgentCommand `json:"commands"`
	NextDelaySeconds int            `json:"nextDelaySeconds"`
	LatestVersion    string         `json:"latestVersion,omitempty"`
}

// runCommandPoller loops forever, sleeping cfg.TaskRetrieveDelaySec between
// polls.  It should be started in a goroutine at agent startup.
func runCommandPoller(cfg *Config) {
	// Poll immediately on start so queued commands are picked up without
	// waiting up to TaskRetrieveDelaySec on agent restart.
	pollCommandsOnce(cfg)

	for {
		delay := cfg.TaskRetrieveDelaySec
		if delay <= 0 {
			delay = 10
		}
		time.Sleep(time.Duration(delay) * time.Second)

		newDelay := pollCommandsOnce(cfg)
		// Server may return a different delay (e.g. 30 s when device is pending).
		if newDelay > 0 && newDelay != cfg.TaskRetrieveDelaySec {
			cfg.TaskRetrieveDelaySec = newDelay
		}
	}
}

// pollCommandsOnce calls GET /api/agent/commands and dispatches any pending
// commands.  Returns the nextDelaySeconds from the response (0 on error).
func pollCommandsOnce(cfg *Config) int {
	req, err := http.NewRequest("GET", cfg.ServerURL+"/api/agent/commands", nil)
	if err != nil {
		return 0
	}
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)

	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[cmd-poll] request failed: %v", err)
		return 0
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// 403/404 means device is suspended or not found — don't log noise.
		if resp.StatusCode != http.StatusForbidden && resp.StatusCode != http.StatusNotFound {
			log.Printf("[cmd-poll] unexpected status %d", resp.StatusCode)
		}
		return 0
	}

	var result commandPollResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[cmd-poll] decode error: %v", err)
		return 0
	}

	if len(result.Commands) > 0 {
		log.Printf("[cmd-poll] received %d command(s)", len(result.Commands))
		if dispatcher != nil {
			for _, cmd := range result.Commands {
				dispatcher.HandleCommand(cmd)
			}
		}
	}

	// Check for a newer agent version, but only when no tunnel is active.
	// Applying an update restarts the agent process, which would kill any
	// in-flight SSH/VNC session — a jarring experience for the operator.
	if result.LatestVersion != "" && activeTunnels.count() == 0 {
		applyUpdateIfNewer(cfg, result.LatestVersion)
	}

	return result.NextDelaySeconds
}
