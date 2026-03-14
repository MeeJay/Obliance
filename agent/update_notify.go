package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// notifyServerUpdating informs the server that this agent is about to
// self-update.  The server will mark the device as "updating" in the UI and
// suppress offline alerts for up to 10 minutes.
//
// This is fire-and-forget: any network error is logged but does NOT block the
// update — if the notification fails, the worst case is a brief "offline"
// flash in the dashboard before the agent comes back up.
func notifyServerUpdating(cfg *Config) {
	client := &http.Client{Timeout: 10 * time.Second}

	body, _ := json.Marshal(map[string]string{"agentVersion": agentVersion})
	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/notifying-update", bytes.NewReader(body))
	if err != nil {
		log.Printf("Auto-update: could not build notifying-update request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Auto-update: notifying-update request failed: %v", err)
		return
	}
	defer resp.Body.Close()
	log.Printf("Auto-update: server notified (HTTP %d) — update badge active for up to 10 min", resp.StatusCode)
}
