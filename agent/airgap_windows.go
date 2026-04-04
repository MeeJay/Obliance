//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// Firewall backup file — used to restore original state on airgap disable or rollback.
var firewallBackupFile = filepath.Join(configDir, "airgap-firewall-backup.wfw")

// applyAirgapFirewallRules exports the current firewall state, resets it,
// sets default policy to block all, then adds Allow rules for Obliance.
func applyAirgapFirewallRules(serverIPs []string) error {
	// 1. Export current firewall state for later restoration.
	log.Printf("airgap: exporting current firewall state to %s", firewallBackupFile)
	out, err := newCmd("netsh", "advfirewall", "export", firewallBackupFile).CombinedOutput()
	if err != nil {
		return fmt.Errorf("airgap: export firewall state: %v — %s", err, string(out))
	}

	// 2. Delete ALL firewall rules — everything, no exceptions.
	log.Printf("airgap: deleting all firewall rules")
	for _, dir := range []string{"in", "out"} {
		out, err = newCmd("netsh", "advfirewall", "firewall", "delete", "rule", "name=all", "dir="+dir).CombinedOutput()
		if err != nil {
			log.Printf("airgap: delete all %s rules: %v — %s (continuing)", dir, err, string(out))
		}
	}

	// 3. Set default policy: block inbound + block outbound on all profiles.
	log.Printf("airgap: setting default policy to block all")
	out, err = newCmd("netsh", "advfirewall", "set", "allprofiles",
		"firewallpolicy", "blockinbound,blockoutbound").CombinedOutput()
	if err != nil {
		restoreFirewall()
		return fmt.Errorf("airgap: set block policy: %v — %s", err, string(out))
	}

	// 4. Add Allow rules — only Obliance server, DNS, and loopback.
	type rule struct {
		name string
		args []string
	}

	var rules []rule

	// Loopback
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

	// DNS (UDP 53)
	rules = append(rules, rule{
		name: "Obliance-Airgap-DNS",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-DNS", "dir=out", "action=allow", "protocol=UDP", "remoteport=53"},
	})

	// DHCP (UDP 67/68) — essential to renew IP lease, otherwise the machine
	// loses its IP address and can't reach anything including Obliance.
	rules = append(rules, rule{
		name: "Obliance-Airgap-DHCP-Out",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-DHCP-Out", "dir=out", "action=allow", "protocol=UDP", "localport=68", "remoteport=67"},
	})
	rules = append(rules, rule{
		name: "Obliance-Airgap-DHCP-In",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-DHCP-In", "dir=in", "action=allow", "protocol=UDP", "localport=68", "remoteport=67"},
	})

	// Server IPs
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

	for _, r := range rules {
		out, err := newCmd("netsh", r.args...).CombinedOutput()
		if err != nil {
			log.Printf("airgap: failed to add rule %s: %v — %s", r.name, err, string(out))
			restoreFirewall()
			return fmt.Errorf("airgap: failed to add rule %q: %v", r.name, err)
		}
		log.Printf("airgap: added rule %s", r.name)
	}

	return nil
}

// removeAirgapFirewallRules restores the firewall from the backup taken before
// airgap was enabled. If no backup exists, it resets to Windows defaults.
func removeAirgapFirewallRules() error {
	return restoreFirewall()
}

// restoreFirewall imports the saved firewall state, or resets to Windows
// defaults if no backup is available.
func restoreFirewall() error {
	if _, err := os.Stat(firewallBackupFile); err == nil {
		log.Printf("airgap: restoring firewall from backup %s", firewallBackupFile)
		out, err := newCmd("netsh", "advfirewall", "import", firewallBackupFile).CombinedOutput()
		if err != nil {
			log.Printf("airgap: import failed: %v — %s, falling back to reset", err, string(out))
			// Last resort: reset to Windows defaults so the machine isn't bricked.
			out2, err2 := newCmd("netsh", "advfirewall", "reset").CombinedOutput()
			if err2 != nil {
				return fmt.Errorf("airgap: both import and reset failed: import=%v reset=%v — %s", err, err2, string(out2))
			}
			log.Printf("airgap: firewall reset to Windows defaults (backup import failed)")
			return nil
		}
		log.Printf("airgap: firewall restored from backup")
		// Clean up backup file.
		os.Remove(firewallBackupFile)
		return nil
	}

	// No backup — reset to safe defaults.
	log.Printf("airgap: no backup found, resetting firewall to Windows defaults")
	out, err := newCmd("netsh", "advfirewall", "reset").CombinedOutput()
	if err != nil {
		return fmt.Errorf("airgap: reset firewall: %v — %s", err, string(out))
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
