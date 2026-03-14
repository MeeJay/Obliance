//go:build windows

package main

import "os"

// restartWithNewBinary on Windows simply exits — the restart is handled by the
// detached batch script written by applyWindowsMSIUpdate():
//
//  1. Old exe downloads  obliance-agent.msi  to %TEMP%
//  2. Old exe writes %TEMP%\obliance-msi-update.bat  and launches it detached
//  3. Old exe calls restartWithNewBinary() → os.Exit(0)   (service stops)
//  4. Batch waits 2 s, then runs:
//       msiexec /i obliance-agent.msi /quiet /norestart SERVERURL=... APIKEY=...
//     MSI stop the service (already stopped), overwrites obliance-agent.exe,
//     runs deferred custom actions (PawnIO driver etc.), starts the service.
//  5. Batch cleans up the .msi and itself.
func restartWithNewBinary(_ string) {
	os.Exit(0)
}
