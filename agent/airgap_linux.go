//go:build linux

package main

import (
	"fmt"
	"log"
)

const airgapChain = "OBLIANCE-AIRGAP"

// applyAirgapFirewallRules creates iptables rules that block all traffic
// except loopback, DNS, established connections, and the specified server IPs.
func applyAirgapFirewallRules(serverIPs []string) error {
	// Remove any stale rules first.
	_ = removeAirgapFirewallRules()

	// Create the custom chain.
	if out, err := newCmd("iptables", "-N", airgapChain).CombinedOutput(); err != nil {
		return fmt.Errorf("airgap: create chain: %v — %s", err, string(out))
	}

	type rule struct {
		desc string
		args []string
	}

	rules := []rule{
		// Allow loopback.
		{"allow loopback out", []string{"-A", airgapChain, "-o", "lo", "-j", "ACCEPT"}},
		{"allow loopback in", []string{"-A", airgapChain, "-i", "lo", "-j", "ACCEPT"}},
		// Allow established/related connections.
		{"allow established", []string{"-A", airgapChain, "-m", "state", "--state", "ESTABLISHED,RELATED", "-j", "ACCEPT"}},
		// Allow DNS UDP 53 out.
		{"allow DNS", []string{"-A", airgapChain, "-p", "udp", "--dport", "53", "-j", "ACCEPT"}},
	}

	// Per-IP allow rules.
	for _, ip := range serverIPs {
		rules = append(rules,
			rule{"allow out to " + ip, []string{"-A", airgapChain, "-d", ip, "-j", "ACCEPT"}},
			rule{"allow in from " + ip, []string{"-A", airgapChain, "-s", ip, "-j", "ACCEPT"}},
		)
	}

	// Drop everything else.
	rules = append(rules, rule{"drop all", []string{"-A", airgapChain, "-j", "DROP"}})

	// Apply chain rules.
	for _, r := range rules {
		if out, err := newCmd("iptables", r.args...).CombinedOutput(); err != nil {
			_ = removeAirgapFirewallRules()
			return fmt.Errorf("airgap: %s: %v — %s", r.desc, err, string(out))
		}
		log.Printf("airgap: iptables %s", r.desc)
	}

	// Insert chain into OUTPUT and INPUT.
	if out, err := newCmd("iptables", "-I", "OUTPUT", "1", "-j", airgapChain).CombinedOutput(); err != nil {
		_ = removeAirgapFirewallRules()
		return fmt.Errorf("airgap: insert OUTPUT: %v — %s", err, string(out))
	}
	if out, err := newCmd("iptables", "-I", "INPUT", "1", "-j", airgapChain).CombinedOutput(); err != nil {
		_ = removeAirgapFirewallRules()
		return fmt.Errorf("airgap: insert INPUT: %v — %s", err, string(out))
	}

	return nil
}

// removeAirgapFirewallRules removes the OBLIANCE-AIRGAP chain and all references to it.
func removeAirgapFirewallRules() error {
	// Remove references from OUTPUT and INPUT (may fail if not present).
	for {
		if err := newCmd("iptables", "-D", "OUTPUT", "-j", airgapChain).Run(); err != nil {
			break
		}
	}
	for {
		if err := newCmd("iptables", "-D", "INPUT", "-j", airgapChain).Run(); err != nil {
			break
		}
	}

	// Flush and delete the chain.
	_ = newCmd("iptables", "-F", airgapChain).Run()
	_ = newCmd("iptables", "-X", airgapChain).Run()

	return nil
}
