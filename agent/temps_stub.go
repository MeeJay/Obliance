//go:build !windows

package main

// collectPlatformTemps is a no-op on non-Windows platforms.
// Temperature collection on Linux/macOS is handled by gopsutil's
// host.SensorsTemperatures() which uses /sys/class/thermal, lm-sensors,
// and similar OS-native interfaces.
func collectPlatformTemps() []TempSensor { return nil }

// collectLHMCoreClocks is a no-op on non-Windows platforms.
// Per-core clock speeds from LibreHardwareMonitor are only available on Windows.
func collectLHMCoreClocks() []float64 { return nil }
