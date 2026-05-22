//go:build !windows

package main

import "fmt"

// Non-Windows builds have no hypervisor support yet. detectVirtualizationHost
// returns "" so the server never marks the device as a virtualization host,
// and the enumerate/control paths are inert.

func detectVirtualizationHost() string { return "" }

func enumerateHyperVVMs() ([]HyperVVM, error) { return []HyperVVM{}, nil }

func runHyperVControl(_ string, _ string, _ map[string]interface{}) (string, error) {
	return "", fmt.Errorf("hyper-v control is only supported on Windows hosts")
}

func captureHyperVThumbnail(_ string, _ int, _ int) (string, error) {
	return "", fmt.Errorf("hyper-v console is only supported on Windows hosts")
}
