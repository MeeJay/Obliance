//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"
)

// chooseFolder shows a native Windows folder-picker dialog via PowerShell
// WinForms FolderBrowserDialog.
//
// CREATE_NO_WINDOW (0x08000000) prevents a console flash when the Go binary
// is compiled as a Windows GUI app (-H windowsgui).
func chooseFolder() (string, error) {
	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile", "-NonInteractive",
		"-Command",
		`Add-Type -AssemblyName System.Windows.Forms;`+
			`$d=New-Object System.Windows.Forms.FolderBrowserDialog;`+
			`$d.Description='Choose a download folder';`+
			`$d.ShowNewFolderButton=$true;`+
			`if($d.ShowDialog()-eq[System.Windows.Forms.DialogResult]::OK){$d.SelectedPath}`,
	)
	// Hide the PowerShell console window — mandatory for GUI apps.
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}

	out, err := cmd.Output()
	if err != nil {
		// Any error from PowerShell is treated as a cancellation.
		return "", fmt.Errorf("cancelled")
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", fmt.Errorf("cancelled")
	}
	return path, nil
}
