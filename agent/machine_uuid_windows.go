//go:build windows

package main

import (
	"strings"
)

// readMachineUUID returns the SMBIOS UUID of this Windows machine.
// Tries Get-CimInstance first (Win8+), falls back to wmic (deprecated but
// still present on most systems for compatibility).
// Returns "" if neither method works or the UUID is all zeros.
func readMachineUUID() string {
	// Primary: PowerShell Get-CimInstance Win32_ComputerSystemProduct
	out, err := newCmd(
		"powershell", "-NoProfile", "-NonInteractive", "-Command",
		"(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID",
	).Output()
	if err == nil {
		if uuid := normaliseUUID(strings.TrimSpace(string(out))); uuid != "" {
			return uuid
		}
	}

	// Fallback: wmic csproduct get UUID /value  →  "UUID=XXXX-..."
	out, err = newCmd("wmic", "csproduct", "get", "UUID", "/value").Output()
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "UUID=") {
				if uuid := normaliseUUID(strings.TrimPrefix(line, "UUID=")); uuid != "" {
					return uuid
				}
			}
		}
	}

	return ""
}
