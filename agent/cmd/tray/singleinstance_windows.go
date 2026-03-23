//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procCreateMutexW = kernel32.NewProc("CreateMutexW")
	procGetLastError = kernel32.NewProc("GetLastError")
)

const errorAlreadyExists = 183

// acquireSingleInstanceLock creates a named mutex.
// Returns true if this is the first instance, false if another is already running.
func acquireSingleInstanceLock() bool {
	name, _ := syscall.UTF16PtrFromString("Global\\OblianceTrayApp")
	handle, _, _ := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return false
	}
	// Check if the mutex already existed
	lastErr, _, _ := procGetLastError.Call()
	return lastErr != errorAlreadyExists
}
