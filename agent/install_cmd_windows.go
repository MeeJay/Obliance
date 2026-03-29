//go:build windows

package main

import (
	"bytes"
	"context"
	"os/exec"
	"syscall"
)

// runInstallCmd runs a command inside a Windows Job Object so that the entire
// process tree (powershell.exe + COM hosts + msiexec) is killed on timeout.
func runInstallCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf

	if err := runCmdContextWithJobObject(ctx, cmd); err != nil {
		return buf.Bytes(), err
	}
	return buf.Bytes(), nil
}
