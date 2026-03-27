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
