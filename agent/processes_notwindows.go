//go:build !windows

package main

import "fmt"

func collectProcessesWindows() ([]ProcessInfo, error) {
	return nil, fmt.Errorf("not supported on this platform")
}
