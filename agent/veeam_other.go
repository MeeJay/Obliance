//go:build !windows

package main

import "fmt"

// Non-Windows builds have no Veeam B&R support. detectBackupHost returns ""
// so the server never marks the device as a backup host, and the
// enumerate/control paths are inert.

func detectBackupHost() string { return "" }

func enumerateVeeamJobs() ([]VeeamJob, error) { return []VeeamJob{}, nil }

func runVeeamControl(_ string, _ string) (string, error) {
	return "", fmt.Errorf("veeam control is only supported on Windows hosts")
}
