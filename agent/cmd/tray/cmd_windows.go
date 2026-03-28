//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hiddenCmd wraps exec.Command and hides the console window on Windows
// so that child processes (sc, powershell…) never flash a CMD.
func hiddenCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}
