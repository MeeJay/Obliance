//go:build !windows

package main

import (
	"log"
	"os"
	"syscall"
)

// restartWithNewBinary replaces the current process image with the binary at
// exePath using syscall.Exec (Unix exec — same PID, no fork).
//
// Why this matters for non-systemd systems (Unraid, custom rc.local scripts):
//   - On systemd/launchd: os.Exit(0) would work too (service manager restarts).
//   - On Unraid (started via rc.local or a simple &): there is no watcher to
//     restart on exit, so we exec() the new binary in-place instead.
//
// Falls back to os.Exit(0) if exec fails (service managers will pick it up).
func restartWithNewBinary(exePath string) {
	log.Printf("Auto-update: re-executing new binary at %s", exePath)
	if err := syscall.Exec(exePath, os.Args, os.Environ()); err != nil {
		// exec failed (e.g. permission error) — fall through to Exit so that
		// systemd / launchd / rc.local supervisors can restart the process.
		log.Printf("Auto-update: re-exec failed (%v) — exiting for service manager restart", err)
	}
	os.Exit(0)
}
