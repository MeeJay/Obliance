//go:build !windows && !linux && !darwin && !freebsd

package main

// readMachineUUID is not implemented on this platform.
// getMachineUUID() will fall back to the stored random UUID.
func readMachineUUID() string { return "" }

// readSystemDiskSerial is not implemented on this platform.
func readSystemDiskSerial() string { return "" }
