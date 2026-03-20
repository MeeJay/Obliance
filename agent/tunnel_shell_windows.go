//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ── Win32 lazy-loaded ConPTY functions ────────────────────────────────────────

var (
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	wtsapi32 = windows.NewLazySystemDLL("wtsapi32.dll")
	userenv  = windows.NewLazySystemDLL("userenv.dll")
	advapi32 = windows.NewLazySystemDLL("advapi32.dll")

	procCreatePseudoConsole           = kernel32.NewProc("CreatePseudoConsole")
	procResizePseudoConsole           = kernel32.NewProc("ResizePseudoConsole")
	procClosePseudoConsole            = kernel32.NewProc("ClosePseudoConsole")
	procInitializeProcThreadAttrList  = kernel32.NewProc("InitializeProcThreadAttributeList")
	procUpdateProcThreadAttribute     = kernel32.NewProc("UpdateProcThreadAttribute")
	procDeleteProcThreadAttributeList = kernel32.NewProc("DeleteProcThreadAttributeList")
	procWTSQueryUserToken             = wtsapi32.NewProc("WTSQueryUserToken")
	procCreateEnvironmentBlock        = userenv.NewProc("CreateEnvironmentBlock")
	procDestroyEnvironmentBlock       = userenv.NewProc("DestroyEnvironmentBlock")
	procCreateProcessAsUserW          = advapi32.NewProc("CreateProcessAsUserW")
)

// PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)
const procThreadAttributePseudoConsole uintptr = 0x00020016

// winCoord mirrors the Win32 COORD struct (2 × int16, packed as uint32).
type winCoord struct{ X, Y int16 }

func (c winCoord) pack() uintptr { return uintptr(*(*uint32)(unsafe.Pointer(&c))) }

// ── STARTUPINFOEXW (extends STARTUPINFOW with a proc-thread attribute list) ──

type startupInfoEx struct {
	windows.StartupInfo
	lpAttributeList uintptr // LPPROC_THREAD_ATTRIBUTE_LIST
}

// ── winShell ──────────────────────────────────────────────────────────────────

type winShell struct {
	hPC       windows.Handle
	writePipe *os.File // agent → ConPTY (shell stdin)
	readPipe  *os.File // ConPTY → agent (shell stdout/stderr)
	process   windows.Handle
	thread    windows.Handle
}

// newShellSession creates a Windows ConPTY and spawns a shell inside it.
// If wtsSessionId > 0, the shell runs in the specified WTS user session
// (using WTSQueryUserToken + CreateProcessAsUser). Otherwise it runs as SYSTEM.
// Requires Windows 10 Build 1809 (RS5) or later.
func newShellSession(cols, rows uint16, shellCmd string, wtsSessionId int) (shellSession, error) {
	// --- 1. Create two anonymous pipe pairs -----------------------------------
	var ptyInRead, ptyInWrite, ptyOutRead, ptyOutWrite windows.Handle
	if err := windows.CreatePipe(&ptyInRead, &ptyInWrite, nil, 0); err != nil {
		return nil, fmt.Errorf("conpty: input pipe: %w", err)
	}
	if err := windows.CreatePipe(&ptyOutRead, &ptyOutWrite, nil, 0); err != nil {
		windows.CloseHandle(ptyInRead)
		windows.CloseHandle(ptyInWrite)
		return nil, fmt.Errorf("conpty: output pipe: %w", err)
	}

	// --- 2. CreatePseudoConsole -----------------------------------------------
	var hPC windows.Handle
	initSize := winCoord{X: int16(cols), Y: int16(rows)}
	hr, _, err := procCreatePseudoConsole.Call(
		initSize.pack(),
		uintptr(ptyInRead),
		uintptr(ptyOutWrite),
		0,
		uintptr(unsafe.Pointer(&hPC)),
	)
	if hr != 0 {
		windows.CloseHandle(ptyInRead)
		windows.CloseHandle(ptyInWrite)
		windows.CloseHandle(ptyOutRead)
		windows.CloseHandle(ptyOutWrite)
		return nil, fmt.Errorf("CreatePseudoConsole failed (HRESULT=0x%08x): %w", hr, err)
	}
	windows.CloseHandle(ptyInRead)
	windows.CloseHandle(ptyOutWrite)

	// --- 3. Build PROC_THREAD_ATTRIBUTE_LIST with ConPTY handle ---------------
	var attrListSize uintptr
	procInitializeProcThreadAttrList.Call(0, 1, 0, uintptr(unsafe.Pointer(&attrListSize)))
	if attrListSize == 0 {
		attrListSize = 64
	}
	attrList := make([]byte, attrListSize)
	r, _, err := procInitializeProcThreadAttrList.Call(
		uintptr(unsafe.Pointer(&attrList[0])),
		1, 0,
		uintptr(unsafe.Pointer(&attrListSize)),
	)
	if r == 0 {
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(ptyInWrite)
		windows.CloseHandle(ptyOutRead)
		return nil, fmt.Errorf("InitializeProcThreadAttributeList: %w", err)
	}
	r, _, err = procUpdateProcThreadAttribute.Call(
		uintptr(unsafe.Pointer(&attrList[0])),
		0,
		procThreadAttributePseudoConsole,
		uintptr(hPC),
		unsafe.Sizeof(hPC),
		0, 0,
	)
	if r == 0 {
		procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(&attrList[0])))
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(ptyInWrite)
		windows.CloseHandle(ptyOutRead)
		return nil, fmt.Errorf("UpdateProcThreadAttribute: %w", err)
	}

	// --- 4. Build STARTUPINFOEXW and spawn shell ------------------------------
	siEx := startupInfoEx{}
	siEx.Cb = uint32(unsafe.Sizeof(siEx))
	siEx.lpAttributeList = uintptr(unsafe.Pointer(&attrList[0]))

	var shellExe string
	switch shellCmd {
	case "cmd":
		shellExe = "cmd.exe /k"
	default:
		shellExe = "powershell.exe -NoLogo -NoExit"
	}
	cmdLine, err := syscall.UTF16PtrFromString(shellExe)
	if err != nil {
		procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(&attrList[0])))
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(ptyInWrite)
		windows.CloseHandle(ptyOutRead)
		return nil, fmt.Errorf("conpty: cmdline: %w", err)
	}

	var procInfo windows.ProcessInformation
	createFlags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_UNICODE_ENVIRONMENT)

	if wtsSessionId > 0 {
		// Launch in the user's WTS session
		err = createProcessInSession(uint32(wtsSessionId), cmdLine, createFlags, &siEx, &procInfo)
	} else {
		// Launch as SYSTEM (default)
		err = windows.CreateProcess(
			nil, cmdLine,
			nil, nil, false,
			createFlags,
			nil, nil,
			(*windows.StartupInfo)(unsafe.Pointer(&siEx)),
			&procInfo,
		)
	}
	procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(&attrList[0])))
	if err != nil {
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(ptyInWrite)
		windows.CloseHandle(ptyOutRead)
		return nil, fmt.Errorf("CreateProcess: %w", err)
	}

	return &winShell{
		hPC:       hPC,
		writePipe: os.NewFile(uintptr(ptyInWrite), "conpty-in"),
		readPipe:  os.NewFile(uintptr(ptyOutRead), "conpty-out"),
		process:   procInfo.Process,
		thread:    procInfo.Thread,
	}, nil
}

// createProcessInSession uses WTSQueryUserToken + CreateProcessAsUser to spawn
// a process in the interactive session of a logged-in user.
func createProcessInSession(sessionId uint32, cmdLine *uint16, createFlags uint32, siEx *startupInfoEx, procInfo *windows.ProcessInformation) error {
	var userToken windows.Handle
	r, _, err := procWTSQueryUserToken.Call(uintptr(sessionId), uintptr(unsafe.Pointer(&userToken)))
	if r == 0 {
		return fmt.Errorf("WTSQueryUserToken(session %d): %w", sessionId, err)
	}
	defer windows.CloseHandle(userToken)

	// Duplicate token as a primary token for CreateProcessAsUser
	var primaryToken windows.Handle
	err = windows.DuplicateTokenEx(
		userToken,
		windows.MAXIMUM_ALLOWED,
		nil,
		windows.SecurityImpersonation,
		windows.TokenPrimary,
		&primaryToken,
	)
	if err != nil {
		return fmt.Errorf("DuplicateTokenEx: %w", err)
	}
	defer windows.CloseHandle(primaryToken)

	// Create the user's environment block
	var envBlock uintptr
	r, _, err = procCreateEnvironmentBlock.Call(
		uintptr(unsafe.Pointer(&envBlock)),
		uintptr(primaryToken),
		0, // don't inherit parent env
	)
	if r == 0 {
		return fmt.Errorf("CreateEnvironmentBlock: %w", err)
	}
	defer procDestroyEnvironmentBlock.Call(envBlock)

	// Get user profile directory for lpCurrentDirectory
	var profileDir *uint16
	profileDir, _ = getUserProfileDir(primaryToken)

	// CreateProcessAsUserW
	r, _, err = procCreateProcessAsUserW.Call(
		uintptr(primaryToken),
		0, // lpApplicationName
		uintptr(unsafe.Pointer(cmdLine)),
		0, 0, // process/thread security attrs
		0, // bInheritHandles = FALSE
		uintptr(createFlags),
		envBlock,
		uintptr(unsafe.Pointer(profileDir)),
		uintptr(unsafe.Pointer(&siEx.StartupInfo)),
		uintptr(unsafe.Pointer(procInfo)),
	)
	if r == 0 {
		return fmt.Errorf("CreateProcessAsUserW: %w", err)
	}
	return nil
}

// getUserProfileDir returns the user profile directory for a token (e.g. C:\Users\john).
func getUserProfileDir(token windows.Handle) (*uint16, error) {
	procGetUserProfileDirectoryW := userenv.NewProc("GetUserProfileDirectoryW")
	var size uint32 = 260
	buf := make([]uint16, size)
	r, _, err := procGetUserProfileDirectoryW.Call(
		uintptr(token),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
	)
	if r == 0 {
		return nil, err
	}
	return &buf[0], nil
}

func (s *winShell) Read(p []byte) (int, error)  { return s.readPipe.Read(p) }
func (s *winShell) Write(p []byte) (int, error) { return s.writePipe.Write(p) }

func (s *winShell) Resize(cols, rows uint16) error {
	coord := winCoord{X: int16(cols), Y: int16(rows)}
	hr, _, err := procResizePseudoConsole.Call(uintptr(s.hPC), coord.pack())
	if hr != 0 {
		return fmt.Errorf("ResizePseudoConsole (HRESULT=0x%08x): %w", hr, err)
	}
	return nil
}

func (s *winShell) Close() error {
	s.writePipe.Close()
	s.readPipe.Close()
	if s.process != 0 {
		windows.TerminateProcess(s.process, 1)
		windows.CloseHandle(s.process)
	}
	if s.thread != 0 {
		windows.CloseHandle(s.thread)
	}
	if s.hPC != 0 {
		procClosePseudoConsole.Call(uintptr(s.hPC))
	}
	return nil
}
