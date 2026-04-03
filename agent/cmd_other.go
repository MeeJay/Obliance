//go:build !windows

package main

import (
	"context"
	"os/exec"
)

// newCmd wraps exec.Command (no-op on non-Windows).
func newCmd(name string, args ...string) *exec.Cmd {
	return exec.Command(name, args...)
}

// newCmdContext wraps exec.CommandContext (no-op on non-Windows).
func newCmdContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

// startDetachedProcess launches a detached child process (no-op on non-Windows).
func startDetachedProcess(name string, args ...string) error {
	return exec.Command(name, args...).Start()
}
