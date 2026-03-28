//go:build !windows

package main

import "os/exec"

// hiddenCmd wraps exec.Command (no-op on non-Windows).
func hiddenCmd(name string, args ...string) *exec.Cmd {
	return exec.Command(name, args...)
}
