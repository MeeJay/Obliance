//go:build windows

package main

import (
	"context"
	"os/exec"
	"syscall"
)

// newCmd wraps exec.Command and hides the console window on Windows so that
// child processes (powershell, sc, schtasks, msiexec…) never flash a CMD.
func newCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

// newCmdContext wraps exec.CommandContext with the same hidden-window behavior.
func newCmdContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}
