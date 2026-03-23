//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"syscall"
)

// acquireSingleInstanceLock uses a PID file to prevent multiple instances.
func acquireSingleInstanceLock() bool {
	lockPath := filepath.Join(os.TempDir(), "obliance-tray.lock")

	// Check if lock file exists and the PID is still alive
	if data, err := os.ReadFile(lockPath); err == nil {
		if pid, err := strconv.Atoi(string(data)); err == nil {
			process, err := os.FindProcess(pid)
			if err == nil {
				// Check if the process is actually running
				if err := process.Signal(syscall.Signal(0)); err == nil {
					return false // Another instance is running
				}
			}
		}
	}

	// Write our PID
	_ = os.WriteFile(lockPath, []byte(strconv.Itoa(os.Getpid())), 0644)
	return true
}
