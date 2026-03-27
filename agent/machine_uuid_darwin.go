//go:build darwin

package main

import (
	"regexp"
	"strings"
)

var ioregUUIDRe = regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f\-]+)"`)

// readMachineUUID returns the IOPlatformUUID of this macOS machine.
// This is the same UUID exposed by System Information → Hardware Overview.
func readMachineUUID() string {
	out, err := newCmd("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
	if err != nil {
		return ""
	}
	if m := ioregUUIDRe.FindSubmatch(out); m != nil {
		return normaliseUUID(strings.TrimSpace(string(m[1])))
	}
	return ""
}
