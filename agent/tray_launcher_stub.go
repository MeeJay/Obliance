//go:build !windows

package main

// watchTrayLoop is a no-op on non-Windows platforms (no tray icon).
func watchTrayLoop(stopCh <-chan struct{}) {}
