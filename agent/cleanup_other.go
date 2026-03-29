//go:build !windows

package main

// cleanupOrphanedProcesses is a no-op on non-Windows platforms.
func cleanupOrphanedProcesses() {}
