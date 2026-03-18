//go:build linux

package main

import (
	"fmt"
	"os"
	"strings"
)

// readMachineUUID returns a stable unique ID for this Linux machine.
// Tries /etc/machine-id first (unique per OS instance, survives VM clones
// that regenerate it on first boot), then falls back to the SMBIOS product
// UUID (requires root on some distros, identical across cloned VMs).
// Returns "" if no stable ID can be found.
func readMachineUUID() string {
	// Primary: systemd machine-id (32 hex chars, no dashes).
	// Unique per OS instance — safe across cloned VMs.
	if b, err := os.ReadFile("/etc/machine-id"); err == nil {
		id := strings.TrimSpace(string(b))
		if len(id) == 32 {
			uuid := fmt.Sprintf("%s-%s-%s-%s-%s",
				id[0:8], id[8:12], id[12:16], id[16:20], id[20:32])
			if u := normaliseUUID(uuid); u != "" {
				return u
			}
		}
	}

	// Fallback: SMBIOS product UUID (may require root, identical on cloned VMs).
	if b, err := os.ReadFile("/sys/class/dmi/id/product_uuid"); err == nil {
		if uuid := normaliseUUID(strings.TrimSpace(string(b))); uuid != "" {
			return uuid
		}
	}

	return ""
}
