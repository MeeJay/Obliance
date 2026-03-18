package main

import (
	"log"
	"regexp"
	"strings"
)

var uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var zeroUUID = "00000000-0000-0000-0000-000000000000"

// normaliseUUID lowercases and validates a UUID string.
// Returns "" if the string is not a valid UUID or is the all-zeros sentinel.
func normaliseUUID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == zeroUUID || !uuidRe.MatchString(s) {
		return ""
	}
	return s
}

// getMachineUUID returns a stable hardware UUID for this machine.
// Calls the platform-specific readMachineUUID() and falls back to ""
// if the platform doesn't support it or the result is invalid.
func getMachineUUID() string {
	return readMachineUUID()
}

// resolveDeviceUUID returns the best available UUID for this device.
//
// Priority:
//  1. Hardware UUID (SMBIOS / IOPlatformUUID / machine-id) — stable across reinstalls.
//  2. The previously stored UUID (carried over from config.json).
//  3. A freshly generated random UUID v4 (last resort).
//
// Passing "" as stored is fine for first-run scenarios.
func resolveDeviceUUID(stored string) string {
	if hw := getMachineUUID(); hw != "" {
		if hw != stored {
			log.Printf("Device UUID: using machine UUID %s", hw)
		}
		return hw
	}
	if stored != "" {
		return stored
	}
	fresh := generateUUID()
	log.Printf("Device UUID: hardware UUID unavailable, generated %s", fresh)
	return fresh
}
