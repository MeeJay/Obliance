package main

// ============================================================================
// Stable hardware-derived UUID for Obli* agents.
//
// This file (and its platform-specific siblings machine_uuid_*.go) is designed
// to be COPIED VERBATIM across all Obli* agents so every tool computes the
// exact same UUID for a given physical machine. Do not modify unilaterally in
// one agent — changes must be mirrored everywhere.
//
// Resolution priority:
//
//   1. SMBIOS/hardware UUID — stable, unique per BIOS/motherboard.
//      If the OEM provides a non-blacklisted UUID, we use it as-is. This is
//      the nominal path and was the only path in earlier versions. Do not
//      change this behavior lightly — existing deployments rely on it.
//
//   2. Derived from the system disk serial number — used only when the SMBIOS
//      UUID is invalid or known-bad (cheap OEMs leaving placeholders). The
//      serial is hashed with SHA-256 and formatted as a UUID v5 so all Obli*
//      agents produce the same result.
//
//   3. Previously stored UUID — last resort when both hardware sources fail
//      (e.g. exotic platform, disk with no serial).
//
//   4. Freshly generated UUID — ultimate fallback, only reached when nothing
//      else works. Not deterministic, so different Obli* agents will diverge.
//      Should basically never happen on real hardware.
//
// Each platform file must expose:
//   - readMachineUUID() string            -> SMBIOS/hardware UUID
//   - readSystemDiskSerial() string       -> serial of the disk holding the
//                                            system partition ("/" or C:\)
// ============================================================================

import (
	"crypto/sha256"
	"fmt"
	"log"
	"regexp"
	"strings"
)

var uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// badHardwareUUIDs is a set of SMBIOS UUIDs known to be shared across many
// physical machines because the OEM left a placeholder in the BIOS. Any UUID
// listed here is treated as "no hardware UUID available" so we fall back to
// disk-derived identification.
//
// Add entries (lowercase!) when you encounter colliding UUIDs in the wild.
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

// placeholderSerials are well-known junk values OEMs put into SMBIOS / disk
// serial fields. Comparison is done on a lowercased, trimmed version of the
// candidate — so "To Be Filled By O.E.M." matches "to be filled by o.e.m.".
var placeholderSerials = map[string]bool{
	"":                           true,
	"0":                          true,
	"00000000":                   true,
	"000000000000":               true,
	"none":                       true,
	"n/a":                        true,
	"not specified":              true,
	"not applicable":             true,
	"default string":             true,
	"to be filled by o.e.m.":     true,
	"to be filled by oem":        true,
	"system serial number":      true,
	"system productname":        true,
	"oem":                        true,
	"chassis serial number":      true,
	"123456":                     true,
	"1234567890":                 true,
	"unknown":                    true,
}

// normaliseUUID lowercases and validates a UUID string. Returns "" if the
// input is malformed OR matches a blacklisted placeholder.
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

// isPlaceholderSerial reports whether the given hardware serial string looks
// like an OEM placeholder rather than a real unique value.
func isPlaceholderSerial(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	if placeholderSerials[s] {
		return true
	}
	// Heuristic: strings made entirely of the same character are junk.
	if len(s) > 0 {
		allSame := true
		for i := 1; i < len(s); i++ {
			if s[i] != s[0] {
				allSame = false
				break
			}
		}
		if allSame {
			return true
		}
	}
	return false
}

// hashToUUIDv5 computes a deterministic UUID v5-style value from an arbitrary
// input string. Two inputs that compare equal produce the same UUID, in any
// Obli* agent, on any platform.
//
// The algorithm is fixed and must not change: SHA-256 of the raw bytes, take
// the first 16 bytes, force the UUID version (5) and variant (RFC 4122) bits,
// then hex-format with the canonical 8-4-4-4-12 layout.
func hashToUUIDv5(input string) string {
	sum := sha256.Sum256([]byte(input))
	var b [16]byte
	copy(b[:], sum[:16])
	// Set version to 5 (bits 12-15 of time_hi_and_version)
	b[6] = (b[6] & 0x0f) | 0x50
	// Set variant to RFC 4122 (bits 6-7 of clock_seq_hi_and_reserved)
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// deriveHardwareUUID computes a stable UUID from the system disk serial when
// the SMBIOS UUID is unusable. Returns "" if no valid disk serial is found.
//
// IMPORTANT: the input string passed to hashToUUIDv5 is "obliance-disk:" +
// the lowercased trimmed serial. The prefix namespaces the hash so disk
// serials cannot collide with any other future hash sources. DO NOT change
// the prefix without coordinating across all Obli* agents.
func deriveHardwareUUID() string {
	raw := strings.TrimSpace(readSystemDiskSerial())
	if raw == "" {
		return ""
	}
	if isPlaceholderSerial(raw) {
		log.Printf("Device UUID: system disk serial %q is a placeholder, cannot derive", raw)
		return ""
	}
	input := "obliance-disk:" + strings.ToLower(raw)
	u := hashToUUIDv5(input)
	log.Printf("Device UUID: derived from system disk serial -> %s", u)
	return u
}

// getMachineUUID returns the raw platform hardware UUID after basic validation
// and blacklist filtering. This is the nominal source used for 99% of machines.
func getMachineUUID() string {
	return readMachineUUID()
}

// resolveDeviceUUID returns the best available UUID for this device, trying
// the sources in the documented priority order. Passing "" as stored is fine
// for first-run scenarios.
func resolveDeviceUUID(stored string) string {
	// 1. Nominal path: valid SMBIOS UUID.
	if hw := getMachineUUID(); hw != "" {
		if hw != stored {
			log.Printf("Device UUID: using machine UUID %s", hw)
		}
		return hw
	}

	// 2. SMBIOS is missing or blacklisted -> derive from system disk serial.
	if derived := deriveHardwareUUID(); derived != "" {
		if derived != stored {
			log.Printf("Device UUID: SMBIOS invalid, using disk-derived UUID %s", derived)
		}
		return derived
	}

	// 3. Both hardware sources failed -> reuse the UUID we stored previously.
	if stored != "" {
		log.Printf("Device UUID: hardware sources failed, reusing stored UUID %s", stored)
		return stored
	}

	// 4. First run on a platform with no usable hardware ID -> generate a
	//    random UUID. This path is non-deterministic and should be extremely
	//    rare; it is logged loudly so operators notice.
	fresh := generateUUID()
	log.Printf("Device UUID: WARNING no hardware ID available, generated random UUID %s", fresh)
	return fresh
}
