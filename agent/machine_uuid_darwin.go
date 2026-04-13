//go:build darwin

package main

import (
	"os/exec"
	"regexp"
	"strings"
)

var ioregUUIDRe = regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f\-]+)"`)
var diskutilSerialRe = regexp.MustCompile(`(?m)^\s*Disk / Partition UUID:\s*(.+)$`)
var diskutilMediaSerialRe = regexp.MustCompile(`(?m)^\s*Device / Media Serial Number:\s*(.+)$`)

// readMachineUUID returns the IOPlatformUUID of this macOS machine.
// This is the same UUID exposed by System Information -> Hardware Overview.
func readMachineUUID() string {
	out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
	if err != nil {
		return ""
	}
	if m := ioregUUIDRe.FindSubmatch(out); m != nil {
		return normaliseUUID(strings.TrimSpace(string(m[1])))
	}
	return ""
}

// readSystemDiskSerial returns the hardware serial of the physical disk
// hosting "/". Uses diskutil to resolve the boot volume to its physical
// backing disk, then reads the "Device / Media Serial Number" field.
func readSystemDiskSerial() string {
	// Resolve "/" to its device node via `df`.
	out, err := exec.Command("df", "/").Output()
	if err != nil {
		return ""
	}
	lines := strings.Split(string(out), "\n")
	if len(lines) < 2 {
		return ""
	}
	fields := strings.Fields(lines[1])
	if len(fields) == 0 {
		return ""
	}
	dev := fields[0] // e.g. /dev/disk3s1s1

	// Walk `diskutil info` until we find one with a media serial. If the
	// first device is an APFS snapshot / container, parent is the physical.
	for i := 0; i < 4 && dev != ""; i++ {
		info, err := exec.Command("diskutil", "info", dev).Output()
		if err != nil {
			return ""
		}
		s := string(info)
		if m := diskutilMediaSerialRe.FindStringSubmatch(s); m != nil {
			serial := strings.TrimSpace(m[1])
			if serial != "" {
				return serial
			}
		}
		// Move to the parent ("Part of Whole") if present.
		re := regexp.MustCompile(`(?m)^\s*Part [Oo]f Whole:\s*(\S+)`)
		pm := re.FindStringSubmatch(s)
		if pm == nil {
			break
		}
		dev = "/dev/" + strings.TrimSpace(pm[1])
	}

	return ""
}
