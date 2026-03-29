//go:build windows

package main

import (
	"log"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/svc"
)

type agentSvc struct {
	urlFlag *string
	keyFlag *string
}

// Execute implements svc.Handler — called by the Windows SCM when the service starts.
func (s *agentSvc) Execute(_ []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	// In service mode, stderr goes to NUL — redirect log to a file so it's readable.
	// Log file: C:\ProgramData\OblianceAgent\agent.log
	logPath := filepath.Join(configDir, "agent.log")
	if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644); err == nil {
		log.SetOutput(f)
	}

	status <- svc.Status{State: svc.StartPending}

	// Ensure service recovery is configured (restart on failure).
	// Covers agents installed before the MSI included this CustomAction.
	ensureServiceRecovery()

	cfg := setupConfig(*s.urlFlag, *s.keyFlag)

	// Signal SERVICE_RUNNING — the MSI (ServiceControl Wait="yes") unblocks here.
	status <- svc.Status{
		State:   svc.Running,
		Accepts: svc.AcceptStop | svc.AcceptShutdown,
	}

	// Run main loop in background goroutine
	go mainLoop(cfg)

	// Wait for stop/shutdown command from SCM
	for {
		c := <-r
		switch c.Cmd {
		case svc.Stop, svc.Shutdown:
			log.Printf("Obliance Agent stopping...")
			status <- svc.Status{State: svc.StopPending}
			return false, 0
		case svc.Interrogate:
			status <- c.CurrentStatus
		}
	}
}

// ensureServiceRecovery configures the SCM to auto-restart the service on
// failure. Idempotent — safe to call on every boot. This is a one-liner via
// sc.exe so existing agents get recovery without needing a fresh MSI install.
func ensureServiceRecovery() {
	_ = newCmd("sc", "failure", "OblianceAgent",
		"reset=", "86400", "actions=", "restart/30000/restart/60000/restart/120000").Run()
}

// runAsService detects Windows service mode and runs the SCM handler.
// Returns true if running as a service (caller should not continue).
func runAsService(urlFlag, keyFlag *string) bool {
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Fatalf("Failed to detect service mode: %v", err)
	}
	if !isService {
		return false
	}
	if err := svc.Run("OblianceAgent", &agentSvc{urlFlag, keyFlag}); err != nil {
		log.Fatalf("Service run failed: %v", err)
	}
	return true
}
