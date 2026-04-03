//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procCreateMutexW = kernel32.NewProc("CreateMutexW")
)

const errorAlreadyExists = 183

// acquireSingleInstanceLock creates a named mutex in the Local\ namespace
// so each user session gets its own lock. This allows the tray to run once
// per session (multiple sessions on a terminal server = multiple trays).
func acquireSingleInstanceLock() bool {
	name, _ := syscall.UTF16PtrFromString("Local\\OblianceTrayApp")
	handle, _, lastErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return false
	}
	return lastErr.(syscall.Errno) != errorAlreadyExists
}
