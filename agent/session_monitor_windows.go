//go:build windows

package main

import (
	"log"
	"time"
)

// watchSessionLogins detects new interactive user sessions and fires
// session_login events. Uses WTS enumeration (Windows only).
func watchSessionLogins(stopCh <-chan struct{}) {
	// Track known sessions by ID
	known := make(map[int]bool)

	// Seed with current sessions so we don't fire for already-open sessions
	if sessions, err := enumWtsSessions(); err == nil {
		for _, s := range sessions {
			if s.Username != "" {
				known[s.ID] = true
			}
		}
	}

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			sessions, err := enumWtsSessions()
			if err != nil {
				continue
			}
			for _, s := range sessions {
				if s.Username == "" {
					continue
				}
				if !known[s.ID] {
					known[s.ID] = true
					log.Printf("session-monitor: new session detected: id=%d user=%s", s.ID, s.Username)
					addEvent("session_login", map[string]interface{}{
						"sessionId": s.ID,
						"username":  s.Username,
					})
				}
			}
			// Clean up sessions that no longer exist
			currentIDs := make(map[int]bool)
			for _, s := range sessions {
				if s.Username != "" {
					currentIDs[s.ID] = true
				}
			}
			for id := range known {
				if !currentIDs[id] {
					delete(known, id)
				}
			}
		}
	}
}
