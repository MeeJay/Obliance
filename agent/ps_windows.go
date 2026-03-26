// +build windows

package main

import (
	"context"
	"os/exec"
)

const psUTF8Prefix = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();$OutputEncoding=[System.Text.UTF8Encoding]::new();"

// runPS executes a PowerShell script with UTF-8 output encoding forced.
// This prevents garbled accented characters (e.g. "réseau" → "r�seau")
// on non-English Windows where the default console encoding is CP850/CP1252.
func runPS(script string) ([]byte, error) {
	return exec.Command("powershell.exe", "-NoProfile", "-NonInteractive",
		"-Command", psUTF8Prefix+script,
	).Output()
}

// runPSContext is like runPS but with a context for timeouts.
func runPSContext(ctx context.Context, script string) ([]byte, error) {
	return exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive",
		"-Command", psUTF8Prefix+script,
	).Output()
}
