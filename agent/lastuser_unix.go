//go:build !windows

package main

import (
	"os/exec"
	"runtime"
	"strings"
)

// getLastLoggedInUser returns the last logged-in user on Unix systems.
func getLastLoggedInUser() string {
	switch runtime.GOOS {
	case "darwin":
		// macOS: use stat on /dev/console
		out, err := exec.Command("stat", "-f", "%Su", "/dev/console").Output()
		if err == nil {
			if u := strings.TrimSpace(string(out)); u != "" && u != "root" {
				return u
			}
		}
	}
	// Linux / fallback: parse `who` or `last`
	out, err := exec.Command("who").Output()
	if err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) > 0 && lines[0] != "" {
			fields := strings.Fields(lines[0])
			if len(fields) > 0 {
				return fields[0]
			}
		}
	}
	// Fallback to `last -1`
	out, err = exec.Command("last", "-1", "-w").Output()
	if err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) > 0 {
			fields := strings.Fields(lines[0])
			if len(fields) > 0 && fields[0] != "reboot" && fields[0] != "wtmp" {
				return fields[0]
			}
		}
	}
	return ""
}
