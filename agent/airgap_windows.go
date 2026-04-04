//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
)

// Rule names used by airgap firewall management.
var airgapRuleNames = []string{
	"Obliance-Airgap-BlockAll-Out",
	"Obliance-Airgap-BlockAll-In",
	"Obliance-Airgap-Loopback-Out",
	"Obliance-Airgap-Loopback-In",
	"Obliance-Airgap-DNS",
}

// applyAirgapFirewallRules creates Windows Firewall rules that block all traffic
// except loopback, DNS, and the specified server IPs.
func applyAirgapFirewallRules(serverIPs []string) error {
	// Remove any stale rules first.
	_ = removeAirgapFirewallRules()

	type rule struct {
		name string
		args []string
	}

	// IMPORTANT: Allow rules MUST be created BEFORE block rules.
	// If block rules go first, they kill the existing TCP connection to
	// the Obliance server before the allow rules whitelist it.
	var rules []rule

	// 1. Allow loopback
	rules = append(rules, rule{
		name: "Obliance-Airgap-Loopback-Out",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-Loopback-Out", "dir=out", "action=allow", "remoteip=127.0.0.1"},
	})
	rules = append(rules, rule{
		name: "Obliance-Airgap-Loopback-In",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-Loopback-In", "dir=in", "action=allow", "remoteip=127.0.0.1"},
	})

	// 2. Allow DNS (UDP 53)
	rules = append(rules, rule{
		name: "Obliance-Airgap-DNS",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-DNS", "dir=out", "action=allow", "protocol=UDP", "remoteport=53"},
	})

	// 3. Allow server IPs
	for _, ip := range serverIPs {
		rules = append(rules, rule{
			name: "Obliance-Airgap-Allow-" + ip,
			args: []string{"advfirewall", "firewall", "add", "rule",
				"name=Obliance-Airgap-Allow-" + ip, "dir=out", "action=allow", "remoteip=" + ip},
		})
		rules = append(rules, rule{
			name: "Obliance-Airgap-Allow-" + ip + "-In",
			args: []string{"advfirewall", "firewall", "add", "rule",
				"name=Obliance-Airgap-Allow-" + ip + "-In", "dir=in", "action=allow", "remoteip=" + ip},
		})
	}

	// 4. Block everything else (LAST — after allows are in place)
	rules = append(rules, rule{
		name: "Obliance-Airgap-BlockAll-Out",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-BlockAll-Out", "dir=out", "action=block"},
	})
	rules = append(rules, rule{
		name: "Obliance-Airgap-BlockAll-In",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-BlockAll-In", "dir=in", "action=block"},
	})

	for _, r := range rules {
		out, err := newCmd("netsh", r.args...).CombinedOutput()
		if err != nil {
			// Rollback on failure.
			_ = removeAirgapFirewallRules()
			return fmt.Errorf("airgap: failed to add rule %q: %v — %s", r.name, err, string(out))
		}
		log.Printf("airgap: added rule %s", r.name)
	}

	return nil
}

// removeAirgapFirewallRules deletes all Obliance-Airgap-* firewall rules.
func removeAirgapFirewallRules() error {
	// Delete static rules.
	for _, name := range airgapRuleNames {
		out, err := newCmd("netsh", "advfirewall", "firewall", "delete", "rule", "name="+name).CombinedOutput()
		if err != nil {
			log.Printf("airgap: delete rule %s (may not exist): %v — %s", name, err, string(out))
		}
	}

	// Delete per-IP rules: read airgap state to find previously-allowed IPs.
	data, _ := readAirgapIPs()
	for _, ip := range data {
		for _, name := range []string{"Obliance-Airgap-Allow-" + ip, "Obliance-Airgap-Allow-" + ip + "-In"} {
			out, err := newCmd("netsh", "advfirewall", "firewall", "delete", "rule", "name="+name).CombinedOutput()
			if err != nil {
				log.Printf("airgap: delete rule %s (may not exist): %v — %s", name, err, string(out))
			}
		}
	}

	return nil
}

// readAirgapIPs reads the server IPs from the persisted airgap.json state.
func readAirgapIPs() ([]string, error) {
	data, err := os.ReadFile(airgapFile)
	if err != nil {
		return nil, err
	}
	var state airgapState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return state.ServerIPs, nil
}
