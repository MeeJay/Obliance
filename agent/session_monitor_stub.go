//go:build !windows

package main

// watchSessionLogins is a no-op on non-Windows platforms.
// Session login monitoring requires WTS enumeration (Windows only).
func watchSessionLogins(stopCh <-chan struct{}) {
	<-stopCh
}
