//go:build darwin

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

// chooseFolder shows a native macOS folder-picker via AppleScript (NSOpenPanel).
// Returns an error whose message is "cancelled" when the user dismisses the dialog.
func chooseFolder() (string, error) {
	out, err := exec.Command(
		"osascript", "-e",
		`POSIX path of (choose folder with prompt "Choose a download folder")`,
	).Output()
	if err != nil {
		// AppleScript exits with code 1 on user cancel (error -128).
		return "", fmt.Errorf("cancelled")
	}
	// osascript appends a trailing "/" to directory paths.
	path := strings.TrimSuffix(strings.TrimSpace(string(out)), "/")
	if path == "" {
		return "", fmt.Errorf("cancelled")
	}
	return path, nil
}
