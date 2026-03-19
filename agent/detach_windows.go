//go:build windows

package main

import (
	"syscall"
)

// detachedProc returns a SysProcAttr that launches a process detached from the
// current console so it survives if the parent agent process is restarted.
func detachedProc() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008, // CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS
		HideWindow:    true,
	}
}
