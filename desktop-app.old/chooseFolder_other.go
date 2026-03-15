//go:build !windows && !darwin

package main

import (
	"os"
	"path/filepath"
)

// chooseFolder on Linux (and other platforms) has no reliable native dialog
// without pulling in optional system tools (zenity, kdialog, …).
// We simply return ~/Downloads (creating it if absent), which is the
// XDG-standard download location on most Linux desktops.
func chooseFolder() (string, error) {
	home, _ := os.UserHomeDir()
	dl := filepath.Join(home, "Downloads")
	_ = os.MkdirAll(dl, 0o755)
	return dl, nil
}
