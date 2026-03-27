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

// acquireSingleInstanceLock creates a named mutex.
// Returns true if this is the first instance, false if another is already running.
func acquireSingleInstanceLock() bool {
	name, _ := syscall.UTF16PtrFromString("Global\\OblianceTrayApp")
	handle, _, lastErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return false
	}
	// The third return value of Call() is the errno captured right after the
	// syscall.  Using procGetLastError.Call() separately is unreliable because
	// the Go runtime may issue intermediate syscalls that overwrite LastError.
	return lastErr.(syscall.Errno) != errorAlreadyExists
}
