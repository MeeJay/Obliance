//go:build !windows

package main

import (
	"context"
	"os/exec"
)

// runInstallCmd on non-Windows simply runs the command with context timeout.
func runInstallCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}
