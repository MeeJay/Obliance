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

	procCreatePseudoConsole           = kernel32.NewProc("CreatePseudoConsole")
	procResizePseudoConsole           = kernel32.NewProc("ResizePseudoConsole")
	procClosePseudoConsole            = kernel32.NewProc("ClosePseudoConsole")
	procInitializeProcThreadAttrList  = kernel32.NewProc("InitializeProcThreadAttributeList")
	procUpdateProcThreadAttribute     = kernel32.NewProc("UpdateProcThreadAttribute")
	procDeleteProcThreadAttributeList = kernel32.NewProc("DeleteProcThreadAttributeList")
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

// newShellSession creates a Windows ConPTY and spawns PowerShell inside it.
// Requires Windows 10 Build 1809 (RS5) or later.
func newShellSession(cols, rows uint16) (shellSession, error) {
	// --- 1. Create two anonymous pipe pairs -----------------------------------
	//   • ptyInRead  / ptyInWrite  → ConPTY reads from ptyInRead  (= shell stdin)
	//   • ptyOutRead / ptyOutWrite → ConPTY writes to ptyOutWrite (= shell stdout)
	var ptyInRead, ptyInWrite, ptyOutRead, ptyOutWrite windows.Handle
	if err := windows.CreatePipe(&ptyInRead, &ptyInWrite, nil, 0); err != nil {
		return nil, fmt.Errorf("conpty: input pipe: %w", err)
	}
	if err := windows.CreatePipe(&ptyOutRead, &ptyOutWrite, nil, 0); err != nil {
		windows.CloseHandle(ptyInRead)
		windows.CloseHandle(ptyInWrite)
		return nil, fmt.Errorf("conpty: output pipe: %w", err)
	}

	// --- 2. CreatePseudoConsole(size, hInput, hOutput, flags, &hPC) -----------
	//   hInput  = ptyInRead  (ConPTY reads stdin from here)
	//   hOutput = ptyOutWrite (ConPTY writes stdout to here)
	var hPC windows.Handle
	initSize := winCoord{X: int16(cols), Y: int16(rows)}
	hr, _, err := procCreatePseudoConsole.Call(
		initSize.pack(),
		uintptr(ptyInRead),
		uintptr(ptyOutWrite),
		0,
		uintptr(unsafe.Pointer(&hPC)),
	)
	if hr != 0 { // S_OK = 0
		windows.CloseHandle(ptyInRead)
		windows.CloseHandle(ptyInWrite)
		windows.CloseHandle(ptyOutRead)
		windows.CloseHandle(ptyOutWrite)
		return nil, fmt.Errorf("CreatePseudoConsole failed (HRESULT=0x%08x): %w", hr, err)
	}
	// The ConPTY now owns these ends; we no longer need them.
	windows.CloseHandle(ptyInRead)
	windows.CloseHandle(ptyOutWrite)

	// --- 3. Build a PROC_THREAD_ATTRIBUTE_LIST with the ConPTY handle ---------
	var attrListSize uintptr
	// First call: get the required buffer size (returns FALSE, that's fine).
	procInitializeProcThreadAttrList.Call(0, 1, 0, uintptr(unsafe.Pointer(&attrListSize)))
	if attrListSize == 0 {
		attrListSize = 64 // conservative fallback
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
		uintptr(hPC),       // lpValue = the HPCON handle itself
		unsafe.Sizeof(hPC), // cbSize  = sizeof(HPCON)
		0, 0,
	)
	if r == 0 {
		procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(&attrList[0])))
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(ptyInWrite)
		windows.CloseHandle(ptyOutRead)
		return nil, fmt.Errorf("UpdateProcThreadAttribute: %w", err)
	}

	// --- 4. Build STARTUPINFOEXW and spawn PowerShell -------------------------
	siEx := startupInfoEx{}
	siEx.Cb = uint32(unsafe.Sizeof(siEx))
	siEx.lpAttributeList = uintptr(unsafe.Pointer(&attrList[0]))

	cmdLine, err := syscall.UTF16PtrFromString(`powershell.exe -NoLogo -NoExit`)
	if err != nil {
		procDeleteProcThreadAttributeList.Call(uintptr(unsafe.Pointer(&attrList[0])))
		procClosePseudoConsole.Call(uintptr(hPC))
		windows.CloseHandle(ptyInWrite)
		windows.CloseHandle(ptyOutRead)
		return nil, fmt.Errorf("conpty: cmdline: %w", err)
	}

	var procInfo windows.ProcessInformation
	createFlags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_UNICODE_ENVIRONMENT)
	err = windows.CreateProcess(
		nil,
		cmdLine,
		nil, nil, false,
		createFlags,
		nil, nil,
		(*windows.StartupInfo)(unsafe.Pointer(&siEx)),
		&procInfo,
	)
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
