//go:build windows

package main

import (
	"strings"
	"syscall"
	"unsafe"
)

// Windows GetDriveTypeW return codes (from winbase.h).
const (
	driveUnknown     = 0
	driveNoRootDir   = 1
	driveRemovable   = 2 // floppies, USB sticks, SD cards
	driveFixed       = 3 // local hard drives, internal SSDs
	driveRemote      = 4 // network shares
	driveCDROM       = 5 // optical
	driveRamdisk     = 6
)

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procGetDriveTypeW = kernel32.NewProc("GetDriveTypeW")
)

// isRemovableDisk asks Windows for the drive type. Anything that isn't
// a fixed local disk (case 3) or a network mount (which we don't want
// to alert on either, but we leave to the operator's judgement via
// per-mount thresholds) gets flagged as removable for threshold
// purposes — USB sticks (2), CD/DVDs/ISOs (5), RAM disks (6).
//
// `device` is the gopsutil-reported device path (e.g. `C:`); we strip
// to the bare drive letter and call GetDriveTypeW with `<letter>:\`.
//
// On non-letter mounts (rare on Windows — junctions / mount points
// inside an NTFS path) the call returns driveUnknown; we conservatively
// treat that as NOT removable to avoid silently excluding a real
// internal volume that admins want to monitor.
func isRemovableDisk(device, mountpoint, fstype string) bool {
	// Mountpoint is the most reliable target: gopsutil reports it as
	// `C:` or `D:` on Windows, with no trailing backslash.
	root := mountpoint
	if root == "" {
		root = device
	}
	if len(root) < 2 || root[1] != ':' {
		return false
	}
	driveRoot := strings.ToUpper(string(root[0])) + ":\\"
	ptr, err := syscall.UTF16PtrFromString(driveRoot)
	if err != nil {
		return false
	}
	r1, _, _ := procGetDriveTypeW.Call(uintptr(unsafe.Pointer(ptr)))
	switch r1 {
	case driveRemovable, driveCDROM, driveRamdisk:
		return true
	}
	// Optical filesystems via fstype as a backup — some drivers report
	// fixed-type for an optical drive.
	switch strings.ToLower(fstype) {
	case "cdfs", "udf":
		return true
	}
	return false
}
