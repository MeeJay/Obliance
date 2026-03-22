//go:build windows

package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	wtsapi32 = windows.NewLazySystemDLL("wtsapi32.dll")
	advapi32 = windows.NewLazySystemDLL("advapi32.dll")
	userenv  = windows.NewLazySystemDLL("userenv.dll")

	procWTSQueryUserToken       = wtsapi32.NewProc("WTSQueryUserToken")
	procCreateProcessAsUserW    = advapi32.NewProc("CreateProcessAsUserW")
	procCreateEnvironmentBlock  = userenv.NewProc("CreateEnvironmentBlock")
	procDestroyEnvironmentBlock = userenv.NewProc("DestroyEnvironmentBlock")
)

// ensureTrayRunning checks if obliance-tray.exe is running and launches it
// in each active user session if not. Called periodically from mainLoop.
func ensureTrayRunning() {
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = `C:\Program Files`
	}
	trayExe := filepath.Join(programFiles, "OblianceAgent", "obliance-tray.exe")
	if _, err := os.Stat(trayExe); err != nil {
		log.Printf("tray-launcher: tray exe not found at %s", trayExe)
		return
	}

	if isTrayRunning() {
		return
	}

	log.Printf("tray-launcher: tray not running, looking for user sessions...")
	sessions, err := enumWtsSessions()
	if err != nil {
		log.Printf("tray-launcher: enumWtsSessions error: %v", err)
		return
	}
	if len(sessions) == 0 {
		log.Printf("tray-launcher: no active user sessions found")
		return
	}
	for _, s := range sessions {
		if s.State == "Active" && s.Username != "" {
			log.Printf("tray-launcher: found session %d (%s), launching tray...", s.ID, s.Username)
			launchTrayInSession(uint32(s.ID), trayExe)
		}
	}
}

func isTrayRunning() bool {
	out, err := exec.Command("tasklist", "/FI", "IMAGENAME eq obliance-tray.exe", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "obliance-tray.exe")
}

func launchTrayInSession(sessionID uint32, exePath string) {
	var userToken windows.Token
	r, _, err := procWTSQueryUserToken.Call(uintptr(sessionID), uintptr(unsafe.Pointer(&userToken)))
	if r == 0 {
		log.Printf("tray-launcher: WTSQueryUserToken session %d: %v", sessionID, err)
		return
	}
	defer userToken.Close()

	// Create environment block for the user
	var envBlock uintptr
	procCreateEnvironmentBlock.Call(uintptr(unsafe.Pointer(&envBlock)), uintptr(userToken), 0)
	if envBlock != 0 {
		defer procDestroyEnvironmentBlock.Call(envBlock)
	}

	// Prepare STARTUPINFO and PROCESS_INFORMATION
	si := windows.StartupInfo{
		Cb:      uint32(unsafe.Sizeof(windows.StartupInfo{})),
		Desktop: windows.StringToUTF16Ptr("winsta0\\default"),
	}
	var pi windows.ProcessInformation

	cmdLine, _ := windows.UTF16PtrFromString(exePath)

	r, _, err = procCreateProcessAsUserW.Call(
		uintptr(userToken),
		0, // lpApplicationName
		uintptr(unsafe.Pointer(cmdLine)),
		0, // lpProcessAttributes
		0, // lpThreadAttributes
		0, // bInheritHandles
		0x00000400, // CREATE_UNICODE_ENVIRONMENT
		envBlock,
		0, // lpCurrentDirectory (inherit)
		uintptr(unsafe.Pointer(&si)),
		uintptr(unsafe.Pointer(&pi)),
	)
	if r == 0 {
		log.Printf("tray-launcher: CreateProcessAsUser session %d: %v", sessionID, err)
		return
	}
	windows.CloseHandle(pi.Process)
	windows.CloseHandle(pi.Thread)
	log.Printf("tray-launcher: launched tray in session %d (pid %d)", sessionID, pi.ProcessId)
}

// watchTrayLoop periodically ensures the tray is running. Started as a
// goroutine from mainLoop.
func watchTrayLoop(stopCh <-chan struct{}) {
	log.Printf("tray-launcher: watchTrayLoop started, waiting 15s...")
	time.Sleep(15 * time.Second)
	log.Printf("tray-launcher: initial check")
	ensureTrayRunning()

	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			ensureTrayRunning()
		}
	}
}
