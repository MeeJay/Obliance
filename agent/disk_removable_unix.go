//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"strings"
)

// isRemovableDisk decides whether a partition should be treated as
// removable for threshold-alert purposes. Linux exposes the answer
// directly via `/sys/block/<dev>/removable` (1 = removable). macOS
// doesn't have a free equivalent — we fall back to the mount-path
// heuristic (`/Volumes/*` minus the boot volume `/`) and let the
// server-side path-based filter pick up anything we miss.
//
// Filesystem-type signals (iso9660 / udf / cdfs) are also taken as
// removable so optical mounts always slip through regardless of how
// they showed up in /proc/mounts.
func isRemovableDisk(device, mountpoint, fstype string) bool {
	switch strings.ToLower(fstype) {
	case "iso9660", "udf", "cdfs":
		return true
	}
	// Linux: dereference the device to its base block (e.g. `/dev/sdb1`
	// → `sdb`) and read /sys/block/<base>/removable. Bind-mounts /
	// network mounts that don't have a corresponding /sys/block entry
	// stay false (we can't tell, default to "internal").
	if strings.HasPrefix(device, "/dev/") {
		base := filepath.Base(device)
		// Strip trailing partition digits — sdb1 → sdb, nvme0n1p2 → nvme0n1.
		// nvme partitions use `pN` suffix; mirror gopsutil's sloppy strip.
		trimmed := strings.TrimRight(base, "0123456789")
		if strings.HasSuffix(trimmed, "p") && len(trimmed) > 1 {
			trimmed = trimmed[:len(trimmed)-1]
		}
		if trimmed != "" {
			data, err := os.ReadFile("/sys/block/" + trimmed + "/removable")
			if err == nil && strings.TrimSpace(string(data)) == "1" {
				return true
			}
		}
	}
	// macOS / generic: every external mount lives under `/Volumes/`
	// (minus the boot disk which is `/`). The server applies the same
	// path-based filter as a defensive layer; this just lets the agent
	// flag explicitly so the field is correct in pushed metrics.
	if strings.HasPrefix(mountpoint, "/Volumes/") || strings.HasPrefix(mountpoint, "/media/") || strings.HasPrefix(mountpoint, "/mnt/") || strings.HasPrefix(mountpoint, "/run/media/") {
		return true
	}
	return false
}
