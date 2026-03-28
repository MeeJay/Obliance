//go:build windows

package main

import (
	"log"
	"os"
	"time"

	"golang.org/x/sys/windows/svc"
)

// restartWithNewBinary on Windows signals the SCM handler to perform a clean
// service stop. This prevents the SCM from treating the exit as a crash and
// triggering failure-recovery restarts that race with msiexec.
//
// In interactive (non-service) mode, falls back to os.Exit(0).
func restartWithNewBinary(_ string) {
	isService, _ := svc.IsWindowsService()
	if !isService {
		os.Exit(0)
	}

	// Signal Execute() to return cleanly → SCM reports SERVICE_STOPPED.
	close(stopServiceCh)

	// Block until the process exits via svc.Run returning.
	// Safety timeout: if something goes wrong, force exit after 30s.
	log.Printf("Auto-update: waiting for clean service stop...")
	time.Sleep(30 * time.Second)
	log.Printf("Auto-update: clean stop timed out, forcing exit")
	os.Exit(0)
}
