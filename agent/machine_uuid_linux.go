//go:build linux

package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// readMachineUUID returns a stable unique ID for this Linux machine.
//
// IMPORTANT: the priority here (machine-id first, SMBIOS fallback) is the
// historical behavior that all previously-deployed Linux agents rely on.
// DO NOT swap the order — doing so changes the UUID for every already-
// registered Linux machine, forcing manual reconciliation on the server.
func readMachineUUID() string {
	// Primary: systemd machine-id (32 hex chars, no dashes).
	// This is what every already-deployed Linux agent uses as its identity.
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

	// Fallback: SMBIOS product UUID (requires readable /sys/class/dmi,
	// often root-only on some distros, identical across cloned VMs).
	if b, err := os.ReadFile("/sys/class/dmi/id/product_uuid"); err == nil {
		if uuid := normaliseUUID(strings.TrimSpace(string(b))); uuid != "" {
			return uuid
		}
	}

	return ""
}

// readSystemDiskSerial returns the hardware serial of the physical block
// device hosting the root filesystem ("/"). Uses /proc/mounts to find the
// root device, then resolves its parent disk and reads the ID_SERIAL* udev
// attribute via `udevadm info`.
func readSystemDiskSerial() string {
	rootDev := findRootBlockDevice()
	if rootDev == "" {
		return ""
	}
	parent := parentBlockDevice(rootDev)
	if parent == "" {
		parent = rootDev
	}

	// Preferred: udevadm info exposes ID_SERIAL, ID_SERIAL_SHORT, ID_WWN.
	if out, err := exec.Command("udevadm", "info", "--query=property", "--name="+parent).Output(); err == nil {
		props := parseUdevProperties(string(out))
		for _, key := range []string{"ID_SERIAL_SHORT", "ID_SERIAL", "ID_WWN"} {
			if v := strings.TrimSpace(props[key]); v != "" {
				return v
			}
		}
	}

	// Fallback: /sys/block/<dev>/device/serial
	name := strings.TrimPrefix(parent, "/dev/")
	if b, err := os.ReadFile("/sys/block/" + name + "/device/serial"); err == nil {
		if s := strings.TrimSpace(string(b)); s != "" {
			return s
		}
	}

	return ""
}

// findRootBlockDevice parses /proc/mounts and returns the device path of the
// filesystem mounted at "/". Returns "" if not found.
func findRootBlockDevice() string {
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) >= 2 && fields[1] == "/" {
			return fields[0]
		}
	}
	return ""
}

// parentBlockDevice resolves a partition like /dev/sda3 or /dev/nvme0n1p2 to
// its parent disk (/dev/sda, /dev/nvme0n1). Uses `lsblk` when available,
// otherwise strips trailing digits with a small heuristic.
func parentBlockDevice(dev string) string {
	if out, err := exec.Command("lsblk", "-no", "pkname", dev).Output(); err == nil {
		if name := strings.TrimSpace(string(out)); name != "" {
			return "/dev/" + name
		}
	}
	// Heuristic fallback: /dev/sda3 -> /dev/sda, /dev/nvme0n1p2 -> /dev/nvme0n1
	name := strings.TrimPrefix(dev, "/dev/")
	if strings.Contains(name, "nvme") || strings.Contains(name, "mmcblk") {
		if idx := strings.LastIndex(name, "p"); idx > 0 {
			return "/dev/" + name[:idx]
		}
		return dev
	}
	// strip trailing digits for /dev/sdXN style
	i := len(name)
	for i > 0 && name[i-1] >= '0' && name[i-1] <= '9' {
		i--
	}
	if i > 0 && i < len(name) {
		return "/dev/" + name[:i]
	}
	return dev
}

// parseUdevProperties converts "KEY=value\n" output from `udevadm info
// --query=property` into a map.
func parseUdevProperties(s string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(s, "\n") {
		if i := strings.IndexByte(line, '='); i > 0 {
			out[line[:i]] = line[i+1:]
		}
	}
	return out
}
