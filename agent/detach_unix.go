//go:build !windows

package main

import (
	"syscall"
)

// detachedProc returns a SysProcAttr that launches a process in a new session
// so it is detached from the current terminal/process group.
func detachedProc() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}
