//go:build !windows && !darwin

package main

// runAsService is a no-op on non-Windows platforms.
func runAsService(_, _ *string) bool {
	return false
}
