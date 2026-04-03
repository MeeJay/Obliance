//go:build !windows && !linux

package main

import "fmt"

// applyAirgapFirewallRules is not supported on this platform.
func applyAirgapFirewallRules(serverIPs []string) error {
	return fmt.Errorf("airgap not supported on this platform")
}

// removeAirgapFirewallRules is not supported on this platform.
func removeAirgapFirewallRules() error {
	return fmt.Errorf("airgap not supported on this platform")
}
