//go:build windows

package main

import (
	"log"
	"strings"
)

// cleanupOrphanedProcesses kills stuck processes that previous agent runs may
// have left behind — notably wscript.exe hosting COM-based Windows Update
// installers that block waiting for user interaction.
// Uses PowerShell Get-CimInstance instead of wmic to avoid EDR/SIGMA detections.
func cleanupOrphanedProcesses() {
	script := `Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -match 'obliance') {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    "$($_.ProcessId)"
  }
}`
	out, err := runPS(script)
	if err != nil {
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		pid := strings.TrimSpace(line)
		if pid != "" {
			log.Printf("Killed orphaned wscript.exe (PID %s)", pid)
		}
	}
}
