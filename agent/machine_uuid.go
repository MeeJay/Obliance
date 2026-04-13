package main

import (
	"log"
	"regexp"
	"strings"
)

var uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Known-bad SMBIOS/hardware UUIDs that OEMs or bad BIOS leave as defaults.
// These will be shared across many physical machines, causing collisions on
// the server, so we treat them as "no hardware UUID available" and fall back
// to a persisted random UUID.
var badHardwareUUIDs = map[string]bool{
	"00000000-0000-0000-0000-000000000000": true, // all zeros
	"ffffffff-ffff-ffff-ffff-ffffffffffff": true, // all ones
	"12345678-1234-5678-90ab-cddeefaabbcc": true, // common placeholder
	"12345678-1234-5678-1234-567812345678": true, // common placeholder
	"03000200-0400-0500-0006-000700080009": true, // ASUS default
	"00020003-0004-0005-0006-000700080009": true,
	"01020304-0506-0708-090a-0b0c0d0e0f10": true,
	"4c4c4544-0000-1010-8010-c4c04f313233": true, // Dell default
}

// normaliseUUID lowercases and validates a UUID string.
// Returns "" if the string is not a valid UUID or is a known-bad sentinel.
func normaliseUUID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if !uuidRe.MatchString(s) {
		return ""
	}
	if badHardwareUUIDs[s] {
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
