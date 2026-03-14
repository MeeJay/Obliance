//go:build !windows

package main

import "fmt"

// loadConfigFromRegistry is not available on non-Windows platforms.
func loadConfigFromRegistry() (*Config, error) {
	return nil, fmt.Errorf("registry not available on this platform")
}
