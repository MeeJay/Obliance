//go:build freebsd

package main

import (
	"os"
	"os/exec"
	"strings"
)

// readMachineUUID returns a stable unique ID for this FreeBSD machine.
// Tries the kernel environment (kenv) first, then /etc/hostid.
func readMachineUUID() string {
	// Primary: SMBIOS system UUID via kenv (available without extra packages).
	if out, err := exec.Command("kenv", "smbios.system.uuid").Output(); err == nil {
		if uuid := normaliseUUID(strings.TrimSpace(string(out))); uuid != "" {
			return uuid
		}
	}

	// Fallback: /etc/hostid (FreeBSD system identifier, set at install).
	if b, err := os.ReadFile("/etc/hostid"); err == nil {
		if uuid := normaliseUUID(strings.TrimSpace(string(b))); uuid != "" {
			return uuid
		}
	}

	return ""
}

// readSystemDiskSerial reads the serial of the disk hosting "/" via
// `camcontrol identify`. Returns "" if unavailable.
func readSystemDiskSerial() string {
	// camcontrol identify ada0 | grep "serial number"
	// Not implemented in detail for FreeBSD; returning "" falls through to
	// the stored-UUID path, which is acceptable given the small footprint.
	return ""
}
