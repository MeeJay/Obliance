package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ── Types ────────────────────────────────────────────────────────────────────

// DiscoveredHost represents a single host found during a network scan.
type DiscoveredHost struct {
	IP         string `json:"ip"`
	MAC        string `json:"mac,omitempty"`
	Hostname   string `json:"hostname,omitempty"`
	Ports      []int  `json:"ports"`
	OUIVendor  string `json:"ouiVendor,omitempty"`
	OSGuess    string `json:"osGuess,omitempty"`
	DeviceType string `json:"deviceType"`
	Subnet     string `json:"subnet,omitempty"`
}

// ── Command handler ──────────────────────────────────────────────────────────

// handleScanNetwork performs network discovery on all local subnets.
func (d *CommandDispatcher) handleScanNetwork(cmd AgentCommand) (interface{}, error) {
	log.Println("scan_network: starting network discovery")

	// 1. Detect local subnets from interfaces
	subnets := getLocalSubnets()
	if len(subnets) == 0 {
		return nil, fmt.Errorf("scan_network: no usable subnets found")
	}
	log.Printf("scan_network: found %d subnet(s): %v", len(subnets), subnets)

	// 2. ARP scan each subnet to find live hosts
	var allHosts []DiscoveredHost
	for _, subnet := range subnets {
		hosts := arpScan(subnet)
		allHosts = append(allHosts, hosts...)
	}
	log.Printf("scan_network: found %d host(s) via ARP", len(allHosts))

	if len(allHosts) == 0 {
		return map[string]interface{}{
			"discovered": 0,
			"subnets":    len(subnets),
		}, nil
	}

	// 3. Port probe each host (parallel, 10 workers)
	probePorts(allHosts)

	// 4. Enrich + classify each host
	for i := range allHosts {
		enrichHost(&allHosts[i])
	}

	// 5. POST results to server
	go d.postNetworkScan(allHosts)

	return map[string]interface{}{
		"discovered": len(allHosts),
		"subnets":    len(subnets),
	}, nil
}

// ── Subnet detection ─────────────────────────────────────────────────────────

func getLocalSubnets() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		log.Printf("scan_network: list interfaces: %v", err)
		return nil
	}

	seen := make(map[string]bool)
	var subnets []string

	for _, iface := range ifaces {
		// Skip loopback, down, or virtual interfaces
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}
		name := strings.ToLower(iface.Name)
		// Skip Docker, veth, virbr, Hyper-V virtual switches
		if strings.HasPrefix(name, "veth") || strings.HasPrefix(name, "docker") ||
			strings.HasPrefix(name, "br-") || strings.HasPrefix(name, "virbr") ||
			strings.Contains(name, "loopback") {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP.To4()
			if ip == nil {
				continue // skip IPv6
			}
			// Skip loopback and link-local
			if ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			// Compute network address
			network := net.IPNet{
				IP:   ip.Mask(ipNet.Mask),
				Mask: ipNet.Mask,
			}
			cidr := network.String()
			if !seen[cidr] {
				seen[cidr] = true
				subnets = append(subnets, cidr)
			}
		}
	}
	return subnets
}

// ── ARP scan ─────────────────────────────────────────────────────────────────

func arpScan(subnet string) []DiscoveredHost {
	switch runtime.GOOS {
	case "windows":
		return arpScanWindows(subnet)
	case "linux":
		return arpScanLinux(subnet)
	case "darwin":
		return arpScanDarwin(subnet)
	case "freebsd":
		return arpScanFreeBSD(subnet)
	default:
		log.Printf("scan_network: unsupported OS %s for ARP scan", runtime.GOOS)
		return nil
	}
}

// arpScanWindows pings the subnet broadcast then reads arp -a.
func arpScanWindows(subnet string) []DiscoveredHost {
	// Ping sweep to populate ARP cache — fire and forget, short timeout
	ips := subnetIPs(subnet)
	pingSweep(ips)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := newCmdContext(ctx, "arp", "-a").Output()
	if err != nil {
		log.Printf("scan_network: arp -a failed: %v", err)
		return nil
	}
	return parseArpWindows(string(out), subnet)
}

func parseArpWindows(output, subnet string) []DiscoveredHost {
	_, ipNet, _ := net.ParseCIDR(subnet)
	var hosts []DiscoveredHost
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		ip := net.ParseIP(fields[0])
		if ip == nil || !ip.To4().Equal(ip.To4()) {
			continue
		}
		if ipNet != nil && !ipNet.Contains(ip) {
			continue
		}
		mac := normalizeMAC(fields[1])
		if mac == "" || mac == "ff:ff:ff:ff:ff:ff" || strings.HasPrefix(mac, "01:00:5e") {
			continue
		}
		hosts = append(hosts, DiscoveredHost{
			IP:     ip.String(),
			MAC:    mac,
			Subnet: subnet,
			Ports:  []int{},
		})
	}
	return hosts
}

// arpScanLinux uses "ip neigh show" with optional ping sweep.
func arpScanLinux(subnet string) []DiscoveredHost {
	ips := subnetIPs(subnet)
	pingSweep(ips)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := newCmdContext(ctx, "ip", "neigh", "show").Output()
	if err != nil {
		// Fallback to arp -an
		out, err = newCmdContext(ctx, "arp", "-an").Output()
		if err != nil {
			log.Printf("scan_network: ip neigh / arp -an failed: %v", err)
			return nil
		}
		return parseArpDarwin(string(out), subnet) // same format as macOS
	}
	return parseIPNeigh(string(out), subnet)
}

func parseIPNeigh(output, subnet string) []DiscoveredHost {
	_, ipNet, _ := net.ParseCIDR(subnet)
	var hosts []DiscoveredHost
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "FAILED") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		ip := net.ParseIP(fields[0])
		if ip == nil || ip.To4() == nil {
			continue
		}
		if ipNet != nil && !ipNet.Contains(ip) {
			continue
		}
		// Format: 192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
		macIdx := -1
		for i, f := range fields {
			if f == "lladdr" && i+1 < len(fields) {
				macIdx = i + 1
				break
			}
		}
		if macIdx < 0 {
			continue
		}
		mac := normalizeMAC(fields[macIdx])
		if mac == "" || mac == "ff:ff:ff:ff:ff:ff" {
			continue
		}
		hosts = append(hosts, DiscoveredHost{
			IP:     ip.String(),
			MAC:    mac,
			Subnet: subnet,
			Ports:  []int{},
		})
	}
	return hosts
}

// arpScanDarwin uses "arp -an" on macOS.
func arpScanDarwin(subnet string) []DiscoveredHost {
	ips := subnetIPs(subnet)
	pingSweep(ips)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := newCmdContext(ctx, "arp", "-an").Output()
	if err != nil {
		log.Printf("scan_network: arp -an failed: %v", err)
		return nil
	}
	return parseArpDarwin(string(out), subnet)
}

func parseArpDarwin(output, subnet string) []DiscoveredHost {
	_, ipNet, _ := net.ParseCIDR(subnet)
	var hosts []DiscoveredHost
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		// Format: ? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
		lparen := strings.Index(line, "(")
		rparen := strings.Index(line, ")")
		if lparen < 0 || rparen < 0 || rparen <= lparen {
			continue
		}
		ipStr := line[lparen+1 : rparen]
		ip := net.ParseIP(ipStr)
		if ip == nil || ip.To4() == nil {
			continue
		}
		if ipNet != nil && !ipNet.Contains(ip) {
			continue
		}
		atIdx := strings.Index(line[rparen:], " at ")
		if atIdx < 0 {
			continue
		}
		rest := line[rparen+atIdx+4:]
		macStr := strings.Fields(rest)[0]
		if macStr == "(incomplete)" {
			continue
		}
		mac := normalizeMAC(macStr)
		if mac == "" || mac == "ff:ff:ff:ff:ff:ff" {
			continue
		}
		hosts = append(hosts, DiscoveredHost{
			IP:     ip.String(),
			MAC:    mac,
			Subnet: subnet,
			Ports:  []int{},
		})
	}
	return hosts
}

// arpScanFreeBSD uses ping sweep + "arp -an" on FreeBSD (same format as macOS).
func arpScanFreeBSD(subnet string) []DiscoveredHost {
	ips := subnetIPs(subnet)
	pingSweep(ips)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := newCmdContext(ctx, "arp", "-an").Output()
	if err != nil {
		log.Printf("scan_network: arp -an failed: %v", err)
		return nil
	}
	return parseArpDarwin(string(out), subnet) // FreeBSD arp -an uses the same format as macOS
}

// ── Ping sweep ───────────────────────────────────────────────────────────────

// pingSweep sends ICMP pings to all IPs in parallel to populate the ARP cache.
func pingSweep(ips []string) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, 50) // limit concurrency

	for _, ip := range ips {
		wg.Add(1)
		sem <- struct{}{}
		go func(addr string) {
			defer wg.Done()
			defer func() { <-sem }()
			pingHost(addr)
		}(ip)
	}
	wg.Wait()
}

func pingHost(ip string) {
	var cmd *exec.Cmd
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	switch runtime.GOOS {
	case "windows":
		cmd = newCmdContext(ctx, "ping", "-n", "1", "-w", "500", ip)
	default:
		cmd = newCmdContext(ctx, "ping", "-c", "1", "-W", "1", ip)
	}
	_ = cmd.Run()
}

// subnetIPs enumerates all host IPs in a CIDR. Caps at /20 (4096 hosts).
func subnetIPs(cidr string) []string {
	ip, ipNet, err := net.ParseCIDR(cidr)
	if err != nil {
		return nil
	}

	ones, bits := ipNet.Mask.Size()
	if bits-ones > 12 { // more than /20 = 4096 hosts — skip
		log.Printf("scan_network: subnet %s too large (/%d), skipping", cidr, ones)
		return nil
	}

	var ips []string
	for ip := ip.Mask(ipNet.Mask); ipNet.Contains(ip); incIP(ip) {
		ips = append(ips, ip.String())
	}
	// Remove network and broadcast addresses
	if len(ips) > 2 {
		ips = ips[1 : len(ips)-1]
	}
	return ips
}

func incIP(ip net.IP) {
	for j := len(ip) - 1; j >= 0; j-- {
		ip[j]++
		if ip[j] > 0 {
			break
		}
	}
}

// ── Port probing ─────────────────────────────────────────────────────────────

var probedPorts = []int{22, 80, 135, 161, 443, 445, 631, 3389, 5985, 8080, 9100}

func probePorts(hosts []DiscoveredHost) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, 10) // 10 concurrent workers

	for i := range hosts {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			for _, port := range probedPorts {
				addr := fmt.Sprintf("%s:%d", hosts[idx].IP, port)
				conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
				if err == nil {
					conn.Close()
					hosts[idx].Ports = append(hosts[idx].Ports, port)
				}
			}
		}(i)
	}
	wg.Wait()
}

// ── Host enrichment & classification ─────────────────────────────────────────

func enrichHost(host *DiscoveredHost) {
	// Reverse DNS lookup
	names, err := net.LookupAddr(host.IP)
	if err == nil && len(names) > 0 {
		host.Hostname = strings.TrimSuffix(names[0], ".")
	}

	// OUI vendor lookup
	if host.MAC != "" {
		vendor, category := lookupOUI(host.MAC)
		host.OUIVendor = vendor
		// Use OUI category as a hint for classification
		if category != "" && category != "unknown" {
			host.DeviceType = category
		}
	}

	// Port-based classification (overrides OUI hint when more specific)
	classifyByPorts(host)
}

func classifyByPorts(host *DiscoveredHost) {
	portSet := make(map[int]bool)
	for _, p := range host.Ports {
		portSet[p] = true
	}

	hasPrinterPort := portSet[9100] || portSet[631]
	hasWindowsPort := portSet[445] || portSet[3389] || portSet[5985] || portSet[135]
	hasWebPort := portSet[80] || portSet[443] || portSet[8080]
	hasSNMP := portSet[161]
	hasSSH := portSet[22]

	switch {
	case hasPrinterPort:
		host.DeviceType = "printer"
	case hasWindowsPort && hasWebPort:
		// Windows + web server → likely a server
		host.DeviceType = "server"
	case hasWindowsPort:
		host.DeviceType = "pc"
	case hasSNMP && !hasWindowsPort && !hasPrinterPort:
		host.DeviceType = "network"
	case hasSSH && hasWebPort && !hasWindowsPort:
		// SSH + web but no Windows → could be server or network device
		if host.DeviceType == "" || host.DeviceType == "unknown" {
			host.DeviceType = "server"
		}
	case hasSSH && !hasWindowsPort:
		if host.DeviceType == "" || host.DeviceType == "unknown" {
			host.DeviceType = "pc"
		}
	default:
		if host.DeviceType == "" {
			host.DeviceType = "unknown"
		}
	}
}

// ── MAC helpers ──────────────────────────────────────────────────────────────

// normalizeMAC converts various MAC formats to lowercase colon-separated.
func normalizeMAC(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.ReplaceAll(raw, "-", ":")
	raw = strings.ToLower(raw)

	// Pad single-digit octets: "0:1:2:3:4:5" → "00:01:02:03:04:05"
	parts := strings.Split(raw, ":")
	if len(parts) == 6 {
		for i, p := range parts {
			if len(p) == 1 {
				parts[i] = "0" + p
			}
		}
		return strings.Join(parts, ":")
	}
	return raw
}

// ── OUI lookup ───────────────────────────────────────────────────────────────

type ouiEntry struct {
	Vendor   string
	Category string // pc, printer, network, iot, unknown
}

func lookupOUI(mac string) (vendor string, category string) {
	if len(mac) < 8 {
		return "", "unknown"
	}
	prefix := strings.ToUpper(mac[:8])
	if entry, ok := ouiDB[prefix]; ok {
		return entry.Vendor, entry.Category
	}
	return "", "unknown"
}

// ── POST results to server ───────────────────────────────────────────────────

func (d *CommandDispatcher) postNetworkScan(hosts []DiscoveredHost) {
	payload := map[string]interface{}{
		"results": hosts,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("postNetworkScan: marshal error: %v", err)
		return
	}
	req, err := http.NewRequest("POST", d.serverURL+"/api/agent/network-scan", bytes.NewReader(data))
	if err != nil {
		log.Printf("postNetworkScan: build request error: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", d.apiKey)
	req.Header.Set("X-Device-UUID", d.deviceUUID)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("postNetworkScan: request error: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("postNetworkScan: server returned %d", resp.StatusCode)
	} else {
		log.Printf("postNetworkScan: successfully posted %d hosts", len(hosts))
	}
}

// ── OUI database (~200+ common prefixes) ─────────────────────────────────────
// Key: first 3 bytes of MAC in "XX:XX:XX" format (uppercase).
// Category: pc, printer, network, iot, unknown.

var ouiDB = map[string]ouiEntry{
	// ── Dell ──────────────────────────────────────────────────────────────────
	"00:14:22": {"Dell", "pc"},
	"00:1A:A0": {"Dell", "pc"},
	"00:1E:C9": {"Dell", "pc"},
	"00:21:70": {"Dell", "pc"},
	"00:22:19": {"Dell", "pc"},
	"00:24:E8": {"Dell", "pc"},
	"00:26:B9": {"Dell", "pc"},
	"14:18:77": {"Dell", "pc"},
	"18:03:73": {"Dell", "pc"},
	"24:6E:96": {"Dell", "pc"},
	"34:17:EB": {"Dell", "pc"},
	"44:A8:42": {"Dell", "pc"},
	"54:BF:64": {"Dell", "pc"},
	"5C:F9:DD": {"Dell", "pc"},
	"74:86:7A": {"Dell", "pc"},
	"80:18:44": {"Dell", "pc"},
	"98:90:96": {"Dell", "pc"},
	"B0:83:FE": {"Dell", "pc"},
	"B8:AC:6F": {"Dell", "pc"},
	"D4:81:D7": {"Dell", "pc"},
	"E4:43:4B": {"Dell", "pc"},
	"F0:1F:AF": {"Dell", "pc"},
	"F4:8E:38": {"Dell", "pc"},
	"F8:BC:12": {"Dell", "pc"},
	"18:66:DA": {"Dell", "pc"},

	// ── HP ────────────────────────────────────────────────────────────────────
	"00:0B:CD": {"HP", "pc"},
	"00:11:85": {"HP", "pc"},
	"00:12:79": {"HP", "pc"},
	"00:14:38": {"HP", "pc"},
	"00:15:60": {"HP", "pc"},
	"00:17:A4": {"HP", "pc"},
	"00:1B:78": {"HP", "pc"},
	"00:1E:0B": {"HP", "pc"},
	"00:21:5A": {"HP", "pc"},
	"00:23:7D": {"HP", "pc"},
	"00:25:B3": {"HP", "pc"},
	"00:30:6E": {"HP", "pc"},
	"08:00:09": {"HP", "pc"},
	"10:1F:74": {"HP", "pc"},
	"1C:C1:DE": {"HP", "pc"},
	"2C:41:38": {"HP", "pc"},
	"30:8D:99": {"HP", "pc"},
	"38:63:BB": {"HP", "pc"},
	"3C:D9:2B": {"HP", "pc"},
	"48:0F:CF": {"HP", "pc"},
	"58:20:B1": {"HP", "pc"},
	"64:51:06": {"HP", "pc"},
	"6C:3B:E5": {"HP", "pc"},
	"80:CE:62": {"HP", "pc"},
	"94:57:A5": {"HP", "pc"},
	"98:E7:F4": {"HP", "pc"},
	"A0:D3:C1": {"HP", "pc"},
	"B4:B5:2F": {"HP", "pc"},
	"C8:CB:B8": {"HP", "pc"},
	"D4:C9:EF": {"HP", "pc"},
	"EC:B1:D7": {"HP", "pc"},

	// ── Lenovo ────────────────────────────────────────────────────────────────
	"00:06:1B": {"Lenovo", "pc"},
	"00:09:2D": {"Lenovo", "pc"},
	"00:1A:6B": {"Lenovo", "pc"},
	"00:21:CC": {"Lenovo", "pc"},
	"00:26:2D": {"Lenovo", "pc"},
	"28:D2:44": {"Lenovo", "pc"},
	"40:B0:34": {"Lenovo", "pc"},
	"48:2A:E3": {"Lenovo", "pc"},
	"50:7B:9D": {"Lenovo", "pc"},
	"54:E1:AD": {"Lenovo", "pc"},
	"5C:BA:37": {"Lenovo", "pc"},
	"6C:4B:90": {"Lenovo", "pc"},
	"74:E6:E2": {"Lenovo", "pc"},
	"7C:7A:91": {"Lenovo", "pc"},
	"84:7B:EB": {"Lenovo", "pc"},
	"8C:EC:4B": {"Lenovo", "pc"},
	"98:FA:9B": {"Lenovo", "pc"},
	"A4:34:D9": {"Lenovo", "pc"},
	"C8:5B:76": {"Lenovo", "pc"},
	"D0:94:66": {"Lenovo", "pc"},
	"E8:6A:64": {"Lenovo", "pc"},
	"F0:03:8C": {"Lenovo", "pc"},

	// ── Intel ─────────────────────────────────────────────────────────────────
	"00:02:B3": {"Intel", "pc"},
	"00:03:47": {"Intel", "pc"},
	"00:07:E9": {"Intel", "pc"},
	"00:0E:0C": {"Intel", "pc"},
	"00:11:11": {"Intel", "pc"},
	"00:13:02": {"Intel", "pc"},
	"00:13:20": {"Intel", "pc"},
	"00:15:17": {"Intel", "pc"},
	"00:16:6F": {"Intel", "pc"},
	"00:16:76": {"Intel", "pc"},
	"00:18:DE": {"Intel", "pc"},
	"00:1B:21": {"Intel", "pc"},
	"00:1C:BF": {"Intel", "pc"},
	"00:1D:E0": {"Intel", "pc"},
	"00:1E:64": {"Intel", "pc"},
	"00:1E:65": {"Intel", "pc"},
	"00:1F:3C": {"Intel", "pc"},
	"00:20:7B": {"Intel", "pc"},
	"00:22:FA": {"Intel", "pc"},
	"00:24:D7": {"Intel", "pc"},
	"00:27:10": {"Intel", "pc"},
	"34:13:E8": {"Intel", "pc"},
	"3C:97:0E": {"Intel", "pc"},
	"48:51:B7": {"Intel", "pc"},
	"68:05:CA": {"Intel", "pc"},
	"78:92:9C": {"Intel", "pc"},
	"80:86:F2": {"Intel", "pc"},
	"A4:C4:94": {"Intel", "pc"},
	"B4:96:91": {"Intel", "pc"},
	"D8:FC:93": {"Intel", "pc"},
	"F8:63:3F": {"Intel", "pc"},

	// ── Apple ─────────────────────────────────────────────────────────────────
	"00:03:93": {"Apple", "pc"},
	"00:0A:27": {"Apple", "pc"},
	"00:0A:95": {"Apple", "pc"},
	"00:0D:93": {"Apple", "pc"},
	"00:11:24": {"Apple", "pc"},
	"00:14:51": {"Apple", "pc"},
	"00:16:CB": {"Apple", "pc"},
	"00:17:F2": {"Apple", "pc"},
	"00:19:E3": {"Apple", "pc"},
	"00:1B:63": {"Apple", "pc"},
	"00:1E:52": {"Apple", "pc"},
	"00:1F:5B": {"Apple", "pc"},
	"00:1F:F3": {"Apple", "pc"},
	"00:21:E9": {"Apple", "pc"},
	"00:22:41": {"Apple", "pc"},
	"00:23:12": {"Apple", "pc"},
	"00:23:32": {"Apple", "pc"},
	"00:23:6C": {"Apple", "pc"},
	"00:23:DF": {"Apple", "pc"},
	"00:24:36": {"Apple", "pc"},
	"00:25:00": {"Apple", "pc"},
	"00:25:4B": {"Apple", "pc"},
	"00:25:BC": {"Apple", "pc"},
	"00:26:08": {"Apple", "pc"},
	"00:26:4A": {"Apple", "pc"},
	"00:26:B0": {"Apple", "pc"},
	"00:26:BB": {"Apple", "pc"},
	"00:30:65": {"Apple", "pc"},
	"00:50:E4": {"Apple", "pc"},
	"00:C6:10": {"Apple", "pc"},
	"04:0C:CE": {"Apple", "pc"},
	"04:15:52": {"Apple", "pc"},
	"04:26:65": {"Apple", "pc"},
	"08:00:07": {"Apple", "pc"},
	"08:66:98": {"Apple", "pc"},
	"10:40:F3": {"Apple", "pc"},
	"10:9A:DD": {"Apple", "pc"},
	"14:10:9F": {"Apple", "pc"},
	"18:20:32": {"Apple", "pc"},
	"18:34:51": {"Apple", "pc"},
	"1C:36:BB": {"Apple", "pc"},
	"20:3C:AE": {"Apple", "pc"},
	"20:78:F0": {"Apple", "pc"},
	"24:A0:74": {"Apple", "pc"},
	"28:0B:5C": {"Apple", "pc"},
	"28:6A:BA": {"Apple", "pc"},
	"28:CF:DA": {"Apple", "pc"},
	"2C:BE:08": {"Apple", "pc"},
	"30:10:E4": {"Apple", "pc"},
	"34:12:98": {"Apple", "pc"},
	"34:36:3B": {"Apple", "pc"},
	"38:53:9C": {"Apple", "pc"},
	"38:C9:86": {"Apple", "pc"},
	"3C:07:54": {"Apple", "pc"},
	"3C:15:C2": {"Apple", "pc"},
	"40:33:1A": {"Apple", "pc"},
	"40:A6:D9": {"Apple", "pc"},
	"40:B3:95": {"Apple", "pc"},
	"44:D8:84": {"Apple", "pc"},
	"48:74:6E": {"Apple", "pc"},
	"48:D7:05": {"Apple", "pc"},
	"4C:32:75": {"Apple", "pc"},
	"4C:57:CA": {"Apple", "pc"},
	"50:32:37": {"Apple", "pc"},
	"54:26:96": {"Apple", "pc"},
	"54:72:4F": {"Apple", "pc"},
	"54:AE:27": {"Apple", "pc"},
	"58:1F:AA": {"Apple", "pc"},
	"58:55:CA": {"Apple", "pc"},
	"5C:59:48": {"Apple", "pc"},
	"5C:8D:4E": {"Apple", "pc"},
	"5C:96:9D": {"Apple", "pc"},
	"5C:F7:E6": {"Apple", "pc"},
	"60:03:08": {"Apple", "pc"},
	"60:33:4B": {"Apple", "pc"},
	"60:C5:47": {"Apple", "pc"},
	"60:F8:1D": {"Apple", "pc"},
	"64:20:0C": {"Apple", "pc"},
	"64:76:BA": {"Apple", "pc"},
	"64:A3:CB": {"Apple", "pc"},
	"64:B9:E8": {"Apple", "pc"},
	"68:09:27": {"Apple", "pc"},
	"68:5B:35": {"Apple", "pc"},
	"68:96:7B": {"Apple", "pc"},
	"68:A8:6D": {"Apple", "pc"},
	"68:D9:3C": {"Apple", "pc"},
	"68:FB:7E": {"Apple", "pc"},
	"6C:40:08": {"Apple", "pc"},
	"6C:70:9F": {"Apple", "pc"},
	"6C:94:66": {"Apple", "pc"},
	"6C:AB:31": {"Apple", "pc"},
	"70:3E:AC": {"Apple", "pc"},
	"70:56:81": {"Apple", "pc"},
	"70:CD:60": {"Apple", "pc"},
	"70:DE:E2": {"Apple", "pc"},
	"70:EC:E4": {"Apple", "pc"},
	"74:8D:08": {"Apple", "pc"},
	"78:31:C1": {"Apple", "pc"},
	"78:67:D7": {"Apple", "pc"},
	"78:9F:70": {"Apple", "pc"},
	"78:CA:39": {"Apple", "pc"},
	"7C:01:0A": {"Apple", "pc"},
	"7C:6D:62": {"Apple", "pc"},
	"7C:D1:C3": {"Apple", "pc"},
	"7C:FA:DF": {"Apple", "pc"},
	"7C:FB:18": {"Apple", "pc"},
	"80:00:6E": {"Apple", "pc"},
	"80:49:71": {"Apple", "pc"},
	"80:82:23": {"Apple", "pc"},
	"80:92:9F": {"Apple", "pc"},
	"80:B0:3D": {"Apple", "pc"},
	"80:E6:50": {"Apple", "pc"},
	"84:29:99": {"Apple", "pc"},
	"84:38:35": {"Apple", "pc"},
	"84:78:8B": {"Apple", "pc"},
	"84:85:06": {"Apple", "pc"},
	"84:89:AD": {"Apple", "pc"},
	"84:FC:FE": {"Apple", "pc"},
	"88:53:95": {"Apple", "pc"},
	"88:63:DF": {"Apple", "pc"},
	"88:66:A5": {"Apple", "pc"},
	"88:E8:7F": {"Apple", "pc"},
	"8C:29:37": {"Apple", "pc"},
	"8C:2D:AA": {"Apple", "pc"},
	"8C:7B:9D": {"Apple", "pc"},
	"8C:85:90": {"Apple", "pc"},
	"8C:FA:BA": {"Apple", "pc"},
	"90:27:E4": {"Apple", "pc"},
	"90:72:40": {"Apple", "pc"},
	"90:8D:6C": {"Apple", "pc"},
	"90:B2:1F": {"Apple", "pc"},
	"90:B9:31": {"Apple", "pc"},
	"90:FD:61": {"Apple", "pc"},
	"94:E9:6A": {"Apple", "pc"},
	"98:01:A7": {"Apple", "pc"},
	"98:03:D8": {"Apple", "pc"},
	"98:5A:EB": {"Apple", "pc"},
	"98:B8:E3": {"Apple", "pc"},
	"98:D6:BB": {"Apple", "pc"},
	"98:E0:D9": {"Apple", "pc"},
	"98:F0:AB": {"Apple", "pc"},
	"98:FE:94": {"Apple", "pc"},
	"9C:04:EB": {"Apple", "pc"},
	"9C:20:7B": {"Apple", "pc"},
	"9C:35:EB": {"Apple", "pc"},
	"9C:F3:87": {"Apple", "pc"},
	"9C:FC:01": {"Apple", "pc"},
	"A0:99:9B": {"Apple", "pc"},
	"A0:ED:CD": {"Apple", "pc"},
	"A4:5E:60": {"Apple", "pc"},
	"A4:67:06": {"Apple", "pc"},
	"A4:83:E7": {"Apple", "pc"},
	"A4:D1:8C": {"Apple", "pc"},
	"A4:D9:31": {"Apple", "pc"},
	"A8:20:66": {"Apple", "pc"},
	"A8:51:5B": {"Apple", "pc"},
	"A8:5C:2C": {"Apple", "pc"},
	"A8:66:7F": {"Apple", "pc"},
	"A8:86:DD": {"Apple", "pc"},
	"A8:BB:CF": {"Apple", "pc"},
	"A8:FA:D8": {"Apple", "pc"},
	"AC:29:3A": {"Apple", "pc"},
	"AC:3C:0B": {"Apple", "pc"},
	"AC:61:EA": {"Apple", "pc"},
	"AC:87:A3": {"Apple", "pc"},
	"AC:BC:32": {"Apple", "pc"},
	"AC:CF:5C": {"Apple", "pc"},
	"AC:FD:EC": {"Apple", "pc"},
	"B0:19:C6": {"Apple", "pc"},
	"B0:34:95": {"Apple", "pc"},
	"B0:65:BD": {"Apple", "pc"},
	"B0:9F:BA": {"Apple", "pc"},
	"B4:18:D1": {"Apple", "pc"},
	"B4:F0:AB": {"Apple", "pc"},
	"B8:17:C2": {"Apple", "pc"},
	"B8:41:A4": {"Apple", "pc"},
	"B8:44:D9": {"Apple", "pc"},
	"B8:53:AC": {"Apple", "pc"},
	"B8:63:4D": {"Apple", "pc"},
	"B8:78:2E": {"Apple", "pc"},
	"B8:8D:12": {"Apple", "pc"},
	"B8:C7:5D": {"Apple", "pc"},
	"B8:E8:56": {"Apple", "pc"},
	"B8:F6:B1": {"Apple", "pc"},
	"B8:FF:61": {"Apple", "pc"},
	"BC:3A:EA": {"Apple", "pc"},
	"BC:4C:C4": {"Apple", "pc"},
	"BC:52:B7": {"Apple", "pc"},
	"BC:54:36": {"Apple", "pc"},
	"BC:67:78": {"Apple", "pc"},
	"BC:9F:EF": {"Apple", "pc"},
	"BC:A9:20": {"Apple", "pc"},
	"BC:D0:74": {"Apple", "pc"},
	"C0:1A:DA": {"Apple", "pc"},
	"C0:25:E9": {"Apple", "pc"},
	"C0:63:94": {"Apple", "pc"},
	"C0:84:7A": {"Apple", "pc"},
	"C0:9A:D0": {"Apple", "pc"},
	"C0:A5:3E": {"Apple", "pc"},
	"C0:B6:58": {"Apple", "pc"},
	"C0:CC:F8": {"Apple", "pc"},
	"C0:CE:CD": {"Apple", "pc"},
	"C0:D0:12": {"Apple", "pc"},
	"C4:2A:D0": {"Apple", "pc"},
	"C4:B3:01": {"Apple", "pc"},
	"C8:1E:E7": {"Apple", "pc"},
	"C8:2A:14": {"Apple", "pc"},
	"C8:33:4B": {"Apple", "pc"},
	"C8:6F:1D": {"Apple", "pc"},
	"C8:85:50": {"Apple", "pc"},
	"C8:B5:B7": {"Apple", "pc"},
	"C8:D0:83": {"Apple", "pc"},
	"C8:E0:EB": {"Apple", "pc"},
	"CC:08:8D": {"Apple", "pc"},
	"CC:20:E8": {"Apple", "pc"},
	"CC:25:EF": {"Apple", "pc"},
	"CC:29:F5": {"Apple", "pc"},
	"D0:03:4B": {"Apple", "pc"},
	"D0:25:98": {"Apple", "pc"},
	"D0:4F:7E": {"Apple", "pc"},
	"D0:81:7A": {"Apple", "pc"},
	"D0:C5:F3": {"Apple", "pc"},
	"D0:D2:B0": {"Apple", "pc"},
	"D4:61:9D": {"Apple", "pc"},
	"D4:9A:20": {"Apple", "pc"},
	"D4:F4:6F": {"Apple", "pc"},
	"D8:1D:72": {"Apple", "pc"},
	"D8:30:62": {"Apple", "pc"},
	"D8:9E:3F": {"Apple", "pc"},
	"D8:CF:9C": {"Apple", "pc"},
	"DC:08:56": {"Apple", "pc"},
	"DC:2B:2A": {"Apple", "pc"},
	"DC:37:14": {"Apple", "pc"},
	"DC:41:5F": {"Apple", "pc"},
	"DC:56:E7": {"Apple", "pc"},
	"DC:86:D8": {"Apple", "pc"},
	"DC:A4:CA": {"Apple", "pc"},
	"DC:A9:04": {"Apple", "pc"},
	"E0:33:8E": {"Apple", "pc"},
	"E0:5F:45": {"Apple", "pc"},
	"E0:66:78": {"Apple", "pc"},
	"E0:AC:CB": {"Apple", "pc"},
	"E0:B5:5F": {"Apple", "pc"},
	"E0:B9:BA": {"Apple", "pc"},
	"E0:C7:67": {"Apple", "pc"},
	"E0:C9:7A": {"Apple", "pc"},
	"E0:F5:C6": {"Apple", "pc"},
	"E4:25:E7": {"Apple", "pc"},
	"E4:8B:7F": {"Apple", "pc"},
	"E4:9A:DC": {"Apple", "pc"},
	"E4:C6:3D": {"Apple", "pc"},
	"E4:CE:8F": {"Apple", "pc"},
	"E8:04:0B": {"Apple", "pc"},
	"E8:06:88": {"Apple", "pc"},
	"E8:80:2E": {"Apple", "pc"},
	"E8:8D:28": {"Apple", "pc"},
	"EC:35:86": {"Apple", "pc"},
	"EC:85:2F": {"Apple", "pc"},
	"F0:18:98": {"Apple", "pc"},
	"F0:24:75": {"Apple", "pc"},
	"F0:72:EA": {"Apple", "pc"},
	"F0:76:6F": {"Apple", "pc"},
	"F0:99:BF": {"Apple", "pc"},
	"F0:B4:79": {"Apple", "pc"},
	"F0:C1:F1": {"Apple", "pc"},
	"F0:CB:A1": {"Apple", "pc"},
	"F0:D1:A9": {"Apple", "pc"},
	"F0:DB:E2": {"Apple", "pc"},
	"F0:DC:E2": {"Apple", "pc"},
	"F4:0F:24": {"Apple", "pc"},
	"F4:1B:A1": {"Apple", "pc"},
	"F4:37:B7": {"Apple", "pc"},
	"F4:5C:89": {"Apple", "pc"},
	"F8:1E:DF": {"Apple", "pc"},
	"F8:27:93": {"Apple", "pc"},
	"F8:38:80": {"Apple", "pc"},
	"FC:25:3F": {"Apple", "pc"},
	"FC:E9:98": {"Apple", "pc"},

	// ── Microsoft / Hyper-V ───────────────────────────────────────────────────
	"00:15:5D": {"Microsoft Hyper-V", "pc"},
	"00:50:F2": {"Microsoft", "pc"},
	"28:18:78": {"Microsoft", "pc"},
	"60:45:BD": {"Microsoft", "pc"},
	"7C:1E:52": {"Microsoft", "pc"},
	"98:5F:D3": {"Microsoft", "pc"},
	"B4:AE:2B": {"Microsoft", "pc"},
	"DC:B4:C4": {"Microsoft", "pc"},

	// ── Samsung ───────────────────────────────────────────────────────────────
	"00:00:F0": {"Samsung", "pc"},
	"00:07:AB": {"Samsung", "pc"},
	"00:0D:E5": {"Samsung", "pc"},
	"00:12:47": {"Samsung", "pc"},
	"00:15:99": {"Samsung", "pc"},
	"00:16:32": {"Samsung", "pc"},
	"00:17:D5": {"Samsung", "pc"},
	"00:18:AF": {"Samsung", "pc"},
	"00:1A:8A": {"Samsung", "pc"},
	"00:1B:98": {"Samsung", "pc"},
	"00:1C:43": {"Samsung", "pc"},
	"00:1D:25": {"Samsung", "pc"},
	"00:1E:E1": {"Samsung", "pc"},
	"00:21:19": {"Samsung", "pc"},
	"00:21:D1": {"Samsung", "pc"},
	"00:23:39": {"Samsung", "pc"},
	"00:23:D6": {"Samsung", "pc"},
	"00:24:54": {"Samsung", "pc"},
	"00:24:90": {"Samsung", "pc"},
	"00:25:66": {"Samsung", "pc"},
	"00:26:37": {"Samsung", "pc"},
	"00:26:5D": {"Samsung", "pc"},
	"08:37:3D": {"Samsung", "pc"},
	"08:D4:2B": {"Samsung", "pc"},
	"10:1D:C0": {"Samsung", "pc"},
	"14:49:E0": {"Samsung", "pc"},
	"18:21:95": {"Samsung", "pc"},
	"18:67:B0": {"Samsung", "pc"},
	"1C:62:B8": {"Samsung", "pc"},
	"20:5E:F7": {"Samsung", "pc"},
	"24:18:1D": {"Samsung", "pc"},
	"28:27:BF": {"Samsung", "pc"},
	"2C:AE:2B": {"Samsung", "pc"},
	"30:07:4D": {"Samsung", "pc"},
	"34:23:BA": {"Samsung", "pc"},
	"38:01:97": {"Samsung", "pc"},
	"3C:5A:37": {"Samsung", "pc"},
	"40:0E:85": {"Samsung", "pc"},
	"44:6D:6C": {"Samsung", "pc"},
	"48:44:F7": {"Samsung", "pc"},
	"50:01:BB": {"Samsung", "pc"},
	"54:40:AD": {"Samsung", "pc"},
	"58:C3:8B": {"Samsung", "pc"},
	"5C:0A:5B": {"Samsung", "pc"},
	"60:AF:6D": {"Samsung", "pc"},
	"6C:B7:49": {"Samsung", "pc"},
	"74:45:CE": {"Samsung", "pc"},
	"78:52:1A": {"Samsung", "pc"},
	"7C:0A:95": {"Samsung", "pc"},
	"80:65:6D": {"Samsung", "pc"},
	"84:25:DB": {"Samsung", "pc"},
	"84:38:38": {"Samsung", "pc"},
	"84:55:A5": {"Samsung", "pc"},
	"88:32:9B": {"Samsung", "pc"},
	"8C:77:12": {"Samsung", "pc"},
	"90:18:7C": {"Samsung", "pc"},
	"94:35:0A": {"Samsung", "pc"},
	"98:52:B1": {"Samsung", "pc"},
	"9C:3A:AF": {"Samsung", "pc"},
	"A0:07:98": {"Samsung", "pc"},
	"A0:82:1F": {"Samsung", "pc"},
	"A4:F1:E8": {"Samsung", "pc"},
	"AC:5F:3E": {"Samsung", "pc"},
	"B0:47:BF": {"Samsung", "pc"},
	"B4:3A:28": {"Samsung", "pc"},
	"B8:57:D8": {"Samsung", "pc"},
	"BC:14:85": {"Samsung", "pc"},
	"BC:72:B1": {"Samsung", "pc"},
	"C0:97:27": {"Samsung", "pc"},
	"C4:42:02": {"Samsung", "pc"},
	"C8:19:F7": {"Samsung", "pc"},
	"D0:17:6A": {"Samsung", "pc"},
	"D0:22:12": {"Samsung", "pc"},
	"D0:66:7B": {"Samsung", "pc"},
	"D4:6A:6A": {"Samsung", "pc"},
	"D8:C4:E9": {"Samsung", "pc"},
	"DC:66:72": {"Samsung", "pc"},
	"E4:12:1D": {"Samsung", "pc"},
	"E4:58:B8": {"Samsung", "pc"},
	"E8:3A:12": {"Samsung", "pc"},
	"EC:1F:72": {"Samsung", "pc"},
	"F0:08:F1": {"Samsung", "pc"},
	"F0:5A:09": {"Samsung", "pc"},
	"F4:09:D8": {"Samsung", "pc"},
	"F8:04:2E": {"Samsung", "pc"},
	"FC:A1:3E": {"Samsung", "pc"},

	// ── ASUS ──────────────────────────────────────────────────────────────────
	"00:0C:6E": {"ASUS", "pc"},
	"00:0E:A6": {"ASUS", "pc"},
	"00:11:2F": {"ASUS", "pc"},
	"00:11:D8": {"ASUS", "pc"},
	"00:13:D4": {"ASUS", "pc"},
	"00:15:F2": {"ASUS", "pc"},
	"00:17:31": {"ASUS", "pc"},
	"00:18:F3": {"ASUS", "pc"},
	"00:1A:92": {"ASUS", "pc"},
	"00:1B:FC": {"ASUS", "pc"},
	"00:1D:60": {"ASUS", "pc"},
	"00:1E:8C": {"ASUS", "pc"},
	"00:1F:C6": {"ASUS", "pc"},
	"00:22:15": {"ASUS", "pc"},
	"00:23:54": {"ASUS", "pc"},
	"00:24:8C": {"ASUS", "pc"},
	"00:25:22": {"ASUS", "pc"},
	"00:26:18": {"ASUS", "pc"},
	"00:E0:18": {"ASUS", "pc"},
	"04:92:26": {"ASUS", "pc"},
	"08:60:6E": {"ASUS", "pc"},
	"0C:9D:92": {"ASUS", "pc"},
	"10:7B:44": {"ASUS", "pc"},
	"10:BF:48": {"ASUS", "pc"},
	"10:C3:7B": {"ASUS", "pc"},
	"14:DA:E9": {"ASUS", "pc"},
	"1C:87:2C": {"ASUS", "pc"},
	"1C:B7:2C": {"ASUS", "pc"},
	"20:CF:30": {"ASUS", "pc"},
	"24:4B:FE": {"ASUS", "pc"},
	"2C:4D:54": {"ASUS", "pc"},
	"2C:56:DC": {"ASUS", "pc"},
	"30:5A:3A": {"ASUS", "pc"},
	"30:85:A9": {"ASUS", "pc"},
	"34:97:F6": {"ASUS", "pc"},
	"38:D5:47": {"ASUS", "pc"},
	"40:16:7E": {"ASUS", "pc"},
	"40:B0:76": {"ASUS", "pc"},
	"44:39:C4": {"ASUS", "pc"},
	"48:5B:39": {"ASUS", "pc"},
	"4C:ED:FB": {"ASUS", "pc"},
	"50:46:5D": {"ASUS", "pc"},
	"50:EB:F6": {"ASUS", "pc"},
	"54:04:A6": {"ASUS", "pc"},
	"58:11:22": {"ASUS", "pc"},
	"60:45:CB": {"ASUS", "pc"},
	"6C:F0:49": {"ASUS", "pc"},
	"70:8B:CD": {"ASUS", "pc"},
	"74:D0:2B": {"ASUS", "pc"},
	"78:24:AF": {"ASUS", "pc"},
	"7C:2A:31": {"ASUS", "pc"},
	"88:D7:F6": {"ASUS", "pc"},
	"90:E6:BA": {"ASUS", "pc"},
	"94:DE:80": {"ASUS", "pc"},
	"A8:5E:45": {"ASUS", "pc"},
	"AC:22:0B": {"ASUS", "pc"},
	"AC:9E:17": {"ASUS", "pc"},
	"B0:6E:BF": {"ASUS", "pc"},
	"B4:A9:FC": {"ASUS", "pc"},
	"BC:AE:C5": {"ASUS", "pc"},
	"BC:EE:7B": {"ASUS", "pc"},
	"C8:60:00": {"ASUS", "pc"},
	"CC:43:A3": {"ASUS", "pc"},
	"D0:17:C2": {"ASUS", "pc"},
	"D4:5D:64": {"ASUS", "pc"},
	"D8:50:E6": {"ASUS", "pc"},
	"E0:3F:49": {"ASUS", "pc"},
	"E0:CB:4E": {"ASUS", "pc"},
	"E4:54:E8": {"ASUS", "pc"},
	"E8:9C:25": {"ASUS", "pc"},
	"F0:46:3B": {"ASUS", "pc"},
	"F0:79:59": {"ASUS", "pc"},
	"F4:6D:04": {"ASUS", "pc"},
	"F8:32:E4": {"ASUS", "pc"},
	"FC:34:97": {"ASUS", "pc"},

	// ── Acer ──────────────────────────────────────────────────────────────────
	"00:14:A5": {"Acer", "pc"},
	"00:1E:EC": {"Acer", "pc"},
	"00:26:9E": {"Acer", "pc"},
	"60:6C:66": {"Acer", "pc"},
	"90:78:B2": {"Acer", "pc"},
	"9C:EB:E8": {"Acer", "pc"},
	"A8:1E:84": {"Acer", "pc"},
	"B0:E6:3B": {"Acer", "pc"},
	"CC:B0:DA": {"Acer", "pc"},
	"D0:C0:BF": {"Acer", "pc"},
	"E4:B3:18": {"Acer", "pc"},

	// ── VMware / VirtualBox ───────────────────────────────────────────────────
	"00:05:69": {"VMware", "pc"},
	"00:0C:29": {"VMware", "pc"},
	"00:1C:14": {"VMware", "pc"},
	"00:50:56": {"VMware", "pc"},
	"08:00:27": {"VirtualBox", "pc"},

	// ── Canon (Printer) ──────────────────────────────────────────────────────
	"00:00:85": {"Canon", "printer"},
	"00:1E:8F": {"Canon", "printer"},
	"18:0C:AC": {"Canon", "printer"},
	"2C:9E:FC": {"Canon", "printer"},
	"64:13:6C": {"Canon", "printer"},
	"88:87:17": {"Canon", "printer"},
	"C4:36:55": {"Canon", "printer"},
	"F4:81:39": {"Canon", "printer"},

	// ── Epson (Printer) ──────────────────────────────────────────────────────
	"00:00:48": {"Epson", "printer"},
	"00:26:AB": {"Epson", "printer"},
	"3C:18:A0": {"Epson", "printer"},
	"64:EB:8C": {"Epson", "printer"},
	"88:12:4E": {"Epson", "printer"},
	"AC:18:26": {"Epson", "printer"},
	"C8:2B:96": {"Epson", "printer"},
	"D4:CF:F9": {"Epson", "printer"},

	// ── Brother (Printer) ────────────────────────────────────────────────────
	"00:1B:A9": {"Brother", "printer"},
	"00:80:77": {"Brother", "printer"},
	"30:05:5C": {"Brother", "printer"},
	"34:68:95": {"Brother", "printer"},
	"40:49:0F": {"Brother", "printer"},
	"78:E7:D1": {"Brother", "printer"},
	"AC:3F:A4": {"Brother", "printer"},
	"CC:9F:7A": {"Brother", "printer"},

	// ── Xerox (Printer) ──────────────────────────────────────────────────────
	"00:00:AA": {"Xerox", "printer"},
	"00:0A:C7": {"Xerox", "printer"},
	"00:1D:71": {"Xerox", "printer"},
	"00:21:B7": {"Xerox", "printer"},
	"58:38:79": {"Xerox", "printer"},
	"64:00:F1": {"Xerox", "printer"},
	"9C:93:4E": {"Xerox", "printer"},
	"B0:FA:EB": {"Xerox", "printer"},

	// ── Lexmark (Printer) ────────────────────────────────────────────────────
	"00:04:00": {"Lexmark", "printer"},
	"00:20:00": {"Lexmark", "printer"},
	"40:B8:DF": {"Lexmark", "printer"},
	"78:A6:E1": {"Lexmark", "printer"},

	// ── Ricoh (Printer) ──────────────────────────────────────────────────────
	"00:00:74": {"Ricoh", "printer"},
	"00:26:73": {"Ricoh", "printer"},
	"08:19:A6": {"Ricoh", "printer"},
	"60:12:8B": {"Ricoh", "printer"},
	"A4:44:D1": {"Ricoh", "printer"},

	// ── Konica Minolta (Printer) ─────────────────────────────────────────────
	"00:07:0E": {"Konica Minolta", "printer"},
	"00:08:31": {"Konica Minolta", "printer"},
	"00:0C:39": {"Konica Minolta", "printer"},
	"40:CB:C0": {"Konica Minolta", "printer"},

	// ── Cisco (Network) ──────────────────────────────────────────────────────
	"00:00:0C": {"Cisco", "network"},
	"00:01:42": {"Cisco", "network"},
	"00:01:43": {"Cisco", "network"},
	"00:01:63": {"Cisco", "network"},
	"00:01:64": {"Cisco", "network"},
	"00:01:96": {"Cisco", "network"},
	"00:01:97": {"Cisco", "network"},
	"00:01:C7": {"Cisco", "network"},
	"00:01:C9": {"Cisco", "network"},
	"00:02:16": {"Cisco", "network"},
	"00:02:17": {"Cisco", "network"},
	"00:02:3D": {"Cisco", "network"},
	"00:02:4A": {"Cisco", "network"},
	"00:02:4B": {"Cisco", "network"},
	"00:02:7D": {"Cisco", "network"},
	"00:02:7E": {"Cisco", "network"},
	"00:02:B9": {"Cisco", "network"},
	"00:02:BA": {"Cisco", "network"},
	"00:02:FC": {"Cisco", "network"},
	"00:02:FD": {"Cisco", "network"},
	"00:03:31": {"Cisco", "network"},
	"00:03:32": {"Cisco", "network"},
	"00:03:6B": {"Cisco", "network"},
	"00:03:6C": {"Cisco", "network"},
	"00:03:9F": {"Cisco", "network"},
	"00:03:A0": {"Cisco", "network"},
	"00:03:FD": {"Cisco", "network"},
	"00:03:FE": {"Cisco", "network"},
	"00:04:27": {"Cisco", "network"},
	"00:04:28": {"Cisco", "network"},
	"00:04:4D": {"Cisco", "network"},
	"00:04:4E": {"Cisco", "network"},
	"00:04:6D": {"Cisco", "network"},
	"00:04:6E": {"Cisco", "network"},
	"00:04:9A": {"Cisco", "network"},
	"00:04:9B": {"Cisco", "network"},
	"00:04:DD": {"Cisco", "network"},
	"00:04:DE": {"Cisco", "network"},
	"00:05:00": {"Cisco", "network"},
	"00:05:01": {"Cisco", "network"},
	"00:05:31": {"Cisco", "network"},
	"00:05:32": {"Cisco", "network"},
	"00:05:5E": {"Cisco", "network"},
	"00:05:5F": {"Cisco", "network"},
	"00:05:73": {"Cisco", "network"},
	"00:05:74": {"Cisco", "network"},
	"00:05:DC": {"Cisco", "network"},
	"00:05:DD": {"Cisco", "network"},
	"00:06:28": {"Cisco", "network"},
	"00:06:29": {"Cisco", "network"},
	"00:06:2A": {"Cisco", "network"},
	"00:06:52": {"Cisco", "network"},
	"00:06:53": {"Cisco", "network"},
	"00:06:7C": {"Cisco", "network"},
	"00:06:D6": {"Cisco", "network"},
	"00:06:D7": {"Cisco", "network"},
	"00:07:0D": {"Cisco", "network"},
	"00:07:4F": {"Cisco", "network"},
	"00:07:50": {"Cisco", "network"},
	"00:07:7D": {"Cisco", "network"},
	"00:07:85": {"Cisco", "network"},
	"00:07:B3": {"Cisco", "network"},
	"00:07:B4": {"Cisco", "network"},
	"00:07:EB": {"Cisco", "network"},
	"00:07:EC": {"Cisco", "network"},
	"00:08:20": {"Cisco", "network"},
	"00:08:21": {"Cisco", "network"},
	"00:08:2F": {"Cisco", "network"},
	"00:08:30": {"Cisco", "network"},
	"00:08:7C": {"Cisco", "network"},
	"00:08:7D": {"Cisco", "network"},
	"00:08:A3": {"Cisco", "network"},
	"00:08:A4": {"Cisco", "network"},
	"00:08:E2": {"Cisco", "network"},
	"00:08:E3": {"Cisco", "network"},
	"00:09:11": {"Cisco", "network"},
	"00:09:12": {"Cisco", "network"},
	"00:09:43": {"Cisco", "network"},
	"00:09:44": {"Cisco", "network"},
	"00:09:7B": {"Cisco", "network"},
	"00:09:7C": {"Cisco", "network"},
	"00:09:B6": {"Cisco", "network"},
	"00:09:B7": {"Cisco", "network"},
	"00:0A:41": {"Cisco", "network"},
	"00:0A:42": {"Cisco", "network"},
	"00:0A:8A": {"Cisco", "network"},
	"00:0A:8B": {"Cisco", "network"},
	"00:0A:B7": {"Cisco", "network"},
	"00:0A:B8": {"Cisco", "network"},
	"00:0A:F3": {"Cisco", "network"},
	"00:0A:F4": {"Cisco", "network"},
	"00:0B:45": {"Cisco", "network"},
	"00:0B:46": {"Cisco", "network"},
	"00:0B:5F": {"Cisco", "network"},
	"00:0B:60": {"Cisco", "network"},
	"00:0B:85": {"Cisco", "network"},
	"00:0B:BE": {"Cisco", "network"},
	"00:0B:BF": {"Cisco", "network"},
	"00:0B:FC": {"Cisco", "network"},
	"00:0B:FD": {"Cisco", "network"},
	"00:0C:30": {"Cisco", "network"},
	"00:0C:31": {"Cisco", "network"},
	"00:0C:85": {"Cisco", "network"},
	"00:0C:86": {"Cisco", "network"},
	"00:0C:CE": {"Cisco", "network"},
	"00:0C:CF": {"Cisco", "network"},
	"00:0D:28": {"Cisco", "network"},
	"00:0D:29": {"Cisco", "network"},
	"00:0D:65": {"Cisco", "network"},
	"00:0D:66": {"Cisco", "network"},
	"00:0D:BC": {"Cisco", "network"},
	"00:0D:BD": {"Cisco", "network"},
	"00:0D:EC": {"Cisco", "network"},
	"00:0D:ED": {"Cisco", "network"},
	"00:0E:08": {"Cisco", "network"},
	"00:0E:38": {"Cisco", "network"},
	"00:0E:39": {"Cisco", "network"},
	"00:0E:83": {"Cisco", "network"},
	"00:0E:84": {"Cisco", "network"},
	"00:0E:D6": {"Cisco", "network"},
	"00:0E:D7": {"Cisco", "network"},
	"00:0F:23": {"Cisco", "network"},
	"00:0F:24": {"Cisco", "network"},
	"00:10:07": {"Cisco", "network"},
	"00:10:0B": {"Cisco", "network"},
	"00:10:0D": {"Cisco", "network"},
	"00:10:11": {"Cisco", "network"},
	"00:10:12": {"Cisco", "network"},
	"00:10:1F": {"Cisco", "network"},
	"00:10:29": {"Cisco", "network"},
	"00:10:2F": {"Cisco", "network"},
	"00:10:54": {"Cisco", "network"},
	"00:10:79": {"Cisco", "network"},
	"00:10:7B": {"Cisco", "network"},
	"00:10:A6": {"Cisco", "network"},
	"00:10:F6": {"Cisco", "network"},
	"00:10:FF": {"Cisco", "network"},
	"00:11:20": {"Cisco", "network"},
	"00:11:21": {"Cisco", "network"},
	"00:11:5C": {"Cisco", "network"},
	"00:11:5D": {"Cisco", "network"},
	"00:11:92": {"Cisco", "network"},
	"00:11:93": {"Cisco", "network"},
	"00:11:BB": {"Cisco", "network"},
	"00:11:BC": {"Cisco", "network"},
	"00:12:00": {"Cisco", "network"},
	"00:12:01": {"Cisco", "network"},
	"00:12:17": {"Cisco", "network"},
	"00:12:43": {"Cisco", "network"},
	"00:12:44": {"Cisco", "network"},
	"00:12:7F": {"Cisco", "network"},
	"00:12:80": {"Cisco", "network"},
	"00:12:D9": {"Cisco", "network"},
	"00:12:DA": {"Cisco", "network"},
	"00:13:10": {"Cisco", "network"},
	"00:13:19": {"Cisco", "network"},
	"00:13:1A": {"Cisco", "network"},
	"00:13:5F": {"Cisco", "network"},
	"00:13:60": {"Cisco", "network"},
	"00:13:7F": {"Cisco", "network"},
	"00:13:80": {"Cisco", "network"},
	"00:13:C3": {"Cisco", "network"},
	"00:13:C4": {"Cisco", "network"},
	"00:14:1B": {"Cisco", "network"},
	"00:14:1C": {"Cisco", "network"},
	"00:14:69": {"Cisco", "network"},
	"00:14:6A": {"Cisco", "network"},
	"00:14:A8": {"Cisco", "network"},
	"00:14:A9": {"Cisco", "network"},
	"00:14:BF": {"Cisco", "network"},
	"00:14:F1": {"Cisco", "network"},
	"00:14:F2": {"Cisco", "network"},
	"00:15:2B": {"Cisco", "network"},
	"00:15:2C": {"Cisco", "network"},
	"00:15:62": {"Cisco", "network"},
	"00:15:63": {"Cisco", "network"},
	"00:15:C6": {"Cisco", "network"},
	"00:15:C7": {"Cisco", "network"},
	"00:15:F9": {"Cisco", "network"},
	"00:15:FA": {"Cisco", "network"},
	"00:16:46": {"Cisco", "network"},
	"00:16:47": {"Cisco", "network"},
	"00:16:9C": {"Cisco", "network"},
	"00:16:9D": {"Cisco", "network"},
	"00:16:B6": {"Cisco", "network"},
	"00:16:C7": {"Cisco", "network"},
	"00:16:C8": {"Cisco", "network"},
	"00:17:0E": {"Cisco", "network"},
	"00:17:0F": {"Cisco", "network"},
	"00:17:3B": {"Cisco", "network"},
	"00:17:59": {"Cisco", "network"},
	"00:17:5A": {"Cisco", "network"},
	"00:17:94": {"Cisco", "network"},
	"00:17:95": {"Cisco", "network"},
	"00:18:0A": {"Cisco", "network"},
	"00:18:18": {"Cisco", "network"},
	"00:18:19": {"Cisco", "network"},
	"00:18:39": {"Cisco", "network"},
	"00:18:68": {"Cisco", "network"},
	"00:18:73": {"Cisco", "network"},
	"00:18:74": {"Cisco", "network"},
	"00:18:B9": {"Cisco", "network"},
	"00:18:BA": {"Cisco", "network"},
	"00:19:06": {"Cisco", "network"},
	"00:19:07": {"Cisco", "network"},
	"00:19:2F": {"Cisco", "network"},
	"00:19:30": {"Cisco", "network"},
	"00:19:55": {"Cisco", "network"},
	"00:19:56": {"Cisco", "network"},
	"00:1A:2F": {"Cisco", "network"},
	"00:1A:30": {"Cisco", "network"},
	"00:1A:6C": {"Cisco", "network"},
	"00:1A:6D": {"Cisco", "network"},
	"00:1A:A1": {"Cisco", "network"},
	"00:1A:A2": {"Cisco", "network"},
	"00:1B:0C": {"Cisco", "network"},
	"00:1B:0D": {"Cisco", "network"},
	"00:1B:2A": {"Cisco", "network"},
	"00:1B:2B": {"Cisco", "network"},
	"00:1B:53": {"Cisco", "network"},
	"00:1B:54": {"Cisco", "network"},
	"00:1B:67": {"Cisco", "network"},
	"00:1B:8F": {"Cisco", "network"},
	"00:1B:90": {"Cisco", "network"},
	"00:1B:D4": {"Cisco", "network"},
	"00:1B:D5": {"Cisco", "network"},
	"00:1B:D7": {"Cisco", "network"},
	"00:1C:0E": {"Cisco", "network"},
	"00:1C:0F": {"Cisco", "network"},
	"00:1C:10": {"Cisco", "network"},
	"00:1C:57": {"Cisco", "network"},
	"00:1C:58": {"Cisco", "network"},
	"00:1C:B0": {"Cisco", "network"},
	"00:1C:B1": {"Cisco", "network"},
	"00:1C:F6": {"Cisco", "network"},
	"00:1C:F9": {"Cisco", "network"},
	"00:1D:45": {"Cisco", "network"},
	"00:1D:46": {"Cisco", "network"},
	"00:1D:70": {"Cisco", "network"},
	"00:1D:A1": {"Cisco", "network"},
	"00:1D:A2": {"Cisco", "network"},
	"00:1D:E5": {"Cisco", "network"},
	"00:1D:E6": {"Cisco", "network"},
	"00:1E:13": {"Cisco", "network"},
	"00:1E:14": {"Cisco", "network"},
	"00:1E:49": {"Cisco", "network"},
	"00:1E:4A": {"Cisco", "network"},
	"00:1E:79": {"Cisco", "network"},
	"00:1E:7A": {"Cisco", "network"},
	"00:1E:BD": {"Cisco", "network"},
	"00:1E:BE": {"Cisco", "network"},
	"00:1E:F6": {"Cisco", "network"},
	"00:1E:F7": {"Cisco", "network"},
	"00:1F:26": {"Cisco", "network"},
	"00:1F:27": {"Cisco", "network"},
	"00:1F:6C": {"Cisco", "network"},
	"00:1F:6D": {"Cisco", "network"},
	"00:1F:9D": {"Cisco", "network"},
	"00:1F:9E": {"Cisco", "network"},
	"00:1F:C9": {"Cisco", "network"},
	"00:1F:CA": {"Cisco", "network"},
	"00:21:1B": {"Cisco", "network"},
	"00:21:1C": {"Cisco", "network"},
	"00:21:29": {"Cisco", "network"},
	"00:21:55": {"Cisco", "network"},
	"00:21:56": {"Cisco", "network"},
	"00:21:A0": {"Cisco", "network"},
	"00:21:A1": {"Cisco", "network"},
	"00:21:BE": {"Cisco", "network"},
	"00:21:D7": {"Cisco", "network"},
	"00:21:D8": {"Cisco", "network"},
	"00:22:0C": {"Cisco", "network"},
	"00:22:0D": {"Cisco", "network"},
	"00:22:3A": {"Cisco", "network"},
	"00:22:55": {"Cisco", "network"},
	"00:22:56": {"Cisco", "network"},
	"00:22:6B": {"Cisco", "network"},
	"00:22:BD": {"Cisco", "network"},
	"00:22:BE": {"Cisco", "network"},
	"00:22:CE": {"Cisco", "network"},
	"00:23:04": {"Cisco", "network"},
	"00:23:05": {"Cisco", "network"},
	"00:23:33": {"Cisco", "network"},
	"00:23:34": {"Cisco", "network"},
	"00:23:5D": {"Cisco", "network"},
	"00:23:5E": {"Cisco", "network"},
	"00:23:AB": {"Cisco", "network"},
	"00:23:AC": {"Cisco", "network"},
	"00:23:BE": {"Cisco", "network"},
	"00:23:EA": {"Cisco", "network"},
	"00:23:EB": {"Cisco", "network"},
	"00:24:13": {"Cisco", "network"},
	"00:24:14": {"Cisco", "network"},
	"00:24:50": {"Cisco", "network"},
	"00:24:51": {"Cisco", "network"},
	"00:24:97": {"Cisco", "network"},
	"00:24:98": {"Cisco", "network"},
	"00:24:C3": {"Cisco", "network"},
	"00:24:C4": {"Cisco", "network"},
	"00:24:F7": {"Cisco", "network"},
	"00:24:F9": {"Cisco", "network"},
	"00:25:2E": {"Cisco", "network"},
	"00:25:45": {"Cisco", "network"},
	"00:25:46": {"Cisco", "network"},
	"00:25:83": {"Cisco", "network"},
	"00:25:84": {"Cisco", "network"},
	"00:25:B4": {"Cisco", "network"},
	"00:25:B5": {"Cisco", "network"},
	"00:26:0A": {"Cisco", "network"},
	"00:26:0B": {"Cisco", "network"},
	"00:26:51": {"Cisco", "network"},
	"00:26:52": {"Cisco", "network"},
	"00:26:98": {"Cisco", "network"},
	"00:26:99": {"Cisco", "network"},
	"00:26:CB": {"Cisco", "network"},
	"00:26:CC": {"Cisco", "network"},
	"00:30:19": {"Cisco", "network"},
	"00:30:24": {"Cisco", "network"},
	"00:30:40": {"Cisco", "network"},
	"00:30:71": {"Cisco", "network"},
	"00:30:78": {"Cisco", "network"},
	"00:30:80": {"Cisco", "network"},
	"00:30:85": {"Cisco", "network"},
	"00:30:94": {"Cisco", "network"},
	"00:30:96": {"Cisco", "network"},
	"00:30:A3": {"Cisco", "network"},
	"00:30:B6": {"Cisco", "network"},
	"00:30:F2": {"Cisco", "network"},
	"00:40:96": {"Cisco", "network"},
	"00:50:0B": {"Cisco", "network"},
	"00:50:0F": {"Cisco", "network"},
	"00:50:14": {"Cisco", "network"},
	"00:50:2A": {"Cisco", "network"},
	"00:50:3E": {"Cisco", "network"},
	"00:50:50": {"Cisco", "network"},
	"00:50:53": {"Cisco", "network"},
	"00:50:54": {"Cisco", "network"},
	"00:50:73": {"Cisco", "network"},
	"00:50:80": {"Cisco", "network"},
	"00:50:BD": {"Cisco", "network"},
	"00:50:D1": {"Cisco", "network"},
	"00:50:E2": {"Cisco", "network"},
	"00:50:F0": {"Cisco", "network"},
	"00:60:09": {"Cisco", "network"},
	"00:60:2F": {"Cisco", "network"},
	"00:60:3E": {"Cisco", "network"},
	"00:60:47": {"Cisco", "network"},
	"00:60:5C": {"Cisco", "network"},
	"00:60:70": {"Cisco", "network"},
	"00:60:83": {"Cisco", "network"},
	"00:90:21": {"Cisco", "network"},
	"00:90:6D": {"Cisco", "network"},
	"00:90:6F": {"Cisco", "network"},
	"00:90:86": {"Cisco", "network"},
	"00:90:AB": {"Cisco", "network"},
	"00:90:BF": {"Cisco", "network"},
	"00:A0:C9": {"Cisco", "network"},
	"00:B0:64": {"Cisco", "network"},
	"00:B0:8E": {"Cisco", "network"},
	"00:B0:C2": {"Cisco", "network"},
	"00:C0:1D": {"Cisco", "network"},
	"00:D0:06": {"Cisco", "network"},
	"00:D0:58": {"Cisco", "network"},
	"00:D0:63": {"Cisco", "network"},
	"00:D0:79": {"Cisco", "network"},
	"00:D0:97": {"Cisco", "network"},
	"00:D0:BA": {"Cisco", "network"},
	"00:D0:BB": {"Cisco", "network"},
	"00:D0:BC": {"Cisco", "network"},
	"00:D0:FF": {"Cisco", "network"},
	"00:E0:14": {"Cisco", "network"},
	"00:E0:1E": {"Cisco", "network"},
	"00:E0:34": {"Cisco", "network"},
	"00:E0:4F": {"Cisco", "network"},
	"00:E0:8F": {"Cisco", "network"},
	"00:E0:A3": {"Cisco", "network"},
	"00:E0:B0": {"Cisco", "network"},
	"00:E0:F7": {"Cisco", "network"},
	"00:E0:F9": {"Cisco", "network"},
	"00:E0:FE": {"Cisco", "network"},

	// ── Ubiquiti (Network) ────────────────────────────────────────────────────
	"00:15:6D": {"Ubiquiti", "network"},
	"00:27:22": {"Ubiquiti", "network"},
	"04:18:D6": {"Ubiquiti", "network"},
	"18:E8:29": {"Ubiquiti", "network"},
	"24:5A:4C": {"Ubiquiti", "network"},
	"44:D9:E7": {"Ubiquiti", "network"},
	"68:72:51": {"Ubiquiti", "network"},
	"74:83:C2": {"Ubiquiti", "network"},
	"78:8A:20": {"Ubiquiti", "network"},
	"80:2A:A8": {"Ubiquiti", "network"},
	"B4:FB:E4": {"Ubiquiti", "network"},
	"DC:9F:DB": {"Ubiquiti", "network"},
	"E0:63:DA": {"Ubiquiti", "network"},
	"F0:9F:C2": {"Ubiquiti", "network"},
	"FC:EC:DA": {"Ubiquiti", "network"},

	// ── Netgear (Network) ─────────────────────────────────────────────────────
	"00:09:5B": {"Netgear", "network"},
	"00:0F:B5": {"Netgear", "network"},
	"00:14:6C": {"Netgear", "network"},
	"00:18:4D": {"Netgear", "network"},
	"00:1B:2F": {"Netgear", "network"},
	"00:1E:2A": {"Netgear", "network"},
	"00:1F:33": {"Netgear", "network"},
	"00:22:3F": {"Netgear", "network"},
	"00:24:B2": {"Netgear", "network"},
	"00:26:F2": {"Netgear", "network"},
	"08:02:8E": {"Netgear", "network"},
	"10:0C:6B": {"Netgear", "network"},
	"20:0C:C8": {"Netgear", "network"},
	"28:C6:8E": {"Netgear", "network"},
	"2C:B0:5D": {"Netgear", "network"},
	"30:46:9A": {"Netgear", "network"},
	"44:94:FC": {"Netgear", "network"},
	"4C:60:DE": {"Netgear", "network"},
	"6C:B0:CE": {"Netgear", "network"},
	"84:1B:5E": {"Netgear", "network"},
	"A0:04:60": {"Netgear", "network"},
	"A0:40:A0": {"Netgear", "network"},
	"A4:2B:8C": {"Netgear", "network"},
	"B0:39:56": {"Netgear", "network"},
	"B0:B9:8A": {"Netgear", "network"},
	"B4:75:0E": {"Netgear", "network"},
	"C0:3F:0E": {"Netgear", "network"},
	"C4:04:15": {"Netgear", "network"},
	"C4:3D:C7": {"Netgear", "network"},
	"CC:40:D0": {"Netgear", "network"},
	"D0:7E:35": {"Netgear", "network"},
	"DC:EF:09": {"Netgear", "network"},
	"E0:46:9A": {"Netgear", "network"},
	"E0:91:F5": {"Netgear", "network"},
	"E4:F4:C6": {"Netgear", "network"},
	"E8:FC:AF": {"Netgear", "network"},
	"F8:73:94": {"Netgear", "network"},

	// ── TP-Link (Network) ─────────────────────────────────────────────────────
	"00:27:19": {"TP-Link", "network"},
	"00:31:92": {"TP-Link", "network"},
	"14:CC:20": {"TP-Link", "network"},
	"14:EB:B6": {"TP-Link", "network"},
	"18:A6:F7": {"TP-Link", "network"},
	"1C:3B:F3": {"TP-Link", "network"},
	"30:B5:C2": {"TP-Link", "network"},
	"34:60:F9": {"TP-Link", "network"},
	"38:83:45": {"TP-Link", "network"},
	"50:C7:BF": {"TP-Link", "network"},
	"54:A7:03": {"TP-Link", "network"},
	"5C:63:BF": {"TP-Link", "network"},
	"5C:A6:E6": {"TP-Link", "network"},
	"60:E3:27": {"TP-Link", "network"},
	"64:66:B3": {"TP-Link", "network"},
	"68:FF:7B": {"TP-Link", "network"},
	"6C:5A:B0": {"TP-Link", "network"},
	"74:23:44": {"TP-Link", "network"},
	"78:44:76": {"TP-Link", "network"},
	"78:8C:B5": {"TP-Link", "network"},
	"7C:8B:CA": {"TP-Link", "network"},
	"84:16:F9": {"TP-Link", "network"},
	"88:DE:A9": {"TP-Link", "network"},
	"8C:A6:DF": {"TP-Link", "network"},
	"90:9A:4A": {"TP-Link", "network"},
	"94:D9:B3": {"TP-Link", "network"},
	"98:DA:C4": {"TP-Link", "network"},
	"98:DE:D0": {"TP-Link", "network"},
	"A0:F3:C1": {"TP-Link", "network"},
	"A4:2B:B0": {"TP-Link", "network"},
	"AC:15:A2": {"TP-Link", "network"},
	"AC:84:C6": {"TP-Link", "network"},
	"B0:4E:26": {"TP-Link", "network"},
	"B0:95:75": {"TP-Link", "network"},
	"B0:A7:B9": {"TP-Link", "network"},
	"B4:B0:24": {"TP-Link", "network"},
	"BC:46:99": {"TP-Link", "network"},
	"C0:06:C3": {"TP-Link", "network"},
	"C0:4A:00": {"TP-Link", "network"},
	"C4:6E:1F": {"TP-Link", "network"},
	"C8:E7:D8": {"TP-Link", "network"},
	"CC:32:E5": {"TP-Link", "network"},
	"D0:4D:C6": {"TP-Link", "network"},
	"D8:07:B6": {"TP-Link", "network"},
	"D8:47:32": {"TP-Link", "network"},
	"D8:5D:4C": {"TP-Link", "network"},
	"E0:05:C5": {"TP-Link", "network"},
	"E4:8D:8C": {"TP-Link", "network"},
	"E8:DE:27": {"TP-Link", "network"},
	"EC:08:6B": {"TP-Link", "network"},
	"F0:A7:31": {"TP-Link", "network"},
	"F4:F2:6D": {"TP-Link", "network"},
	"F8:1A:67": {"TP-Link", "network"},
	"F8:D1:11": {"TP-Link", "network"},

	// ── MikroTik (Network) ────────────────────────────────────────────────────
	"00:0C:42": {"MikroTik", "network"},
	"08:55:31": {"MikroTik", "network"},
	"18:FD:74": {"MikroTik", "network"},
	"2C:C8:1B": {"MikroTik", "network"},
	"48:8F:5A": {"MikroTik", "network"},
	"4C:5E:0C": {"MikroTik", "network"},
	"64:D1:54": {"MikroTik", "network"},
	"6C:3B:6B": {"MikroTik", "network"},
	"74:4D:28": {"MikroTik", "network"},
	"78:9A:18": {"MikroTik", "network"},
	"B8:69:F4": {"MikroTik", "network"},
	"C4:AD:34": {"MikroTik", "network"},
	"CC:2D:E0": {"MikroTik", "network"},
	"D4:01:C3": {"MikroTik", "network"},
	"D4:CA:6D": {"MikroTik", "network"},
	"E8:1D:A8": {"MikroTik", "network"},

	// ── Aruba (Network) ───────────────────────────────────────────────────────
	"00:0B:86": {"Aruba", "network"},
	"00:1A:1E": {"Aruba", "network"},
	"00:24:6C": {"Aruba", "network"},
	"04:BD:88": {"Aruba", "network"},
	"18:64:72": {"Aruba", "network"},
	"1C:28:AF": {"Aruba", "network"},
	"20:4C:03": {"Aruba", "network"},
	"24:DE:C6": {"Aruba", "network"},
	"40:E3:D6": {"Aruba", "network"},
	"6C:F3:7F": {"Aruba", "network"},
	"84:D4:7E": {"Aruba", "network"},
	"94:B4:0F": {"Aruba", "network"},
	"A8:BD:27": {"Aruba", "network"},
	"AC:A3:1E": {"Aruba", "network"},
	"D8:C7:C8": {"Aruba", "network"},
	"F0:5C:19": {"Aruba", "network"},

	// ── Juniper (Network) ─────────────────────────────────────────────────────
	"00:05:85": {"Juniper", "network"},
	"00:10:DB": {"Juniper", "network"},
	"00:12:1E": {"Juniper", "network"},
	"00:1D:B5": {"Juniper", "network"},
	"00:21:59": {"Juniper", "network"},
	"00:22:83": {"Juniper", "network"},
	"00:23:9C": {"Juniper", "network"},
	"00:24:DC": {"Juniper", "network"},
	"00:26:88": {"Juniper", "network"},
	"00:31:46": {"Juniper", "network"},
	"08:81:F4": {"Juniper", "network"},
	"08:B2:58": {"Juniper", "network"},
	"0C:86:10": {"Juniper", "network"},
	"28:8A:1C": {"Juniper", "network"},
	"2C:21:31": {"Juniper", "network"},
	"2C:6B:F5": {"Juniper", "network"},
	"30:7C:5E": {"Juniper", "network"},
	"3C:61:04": {"Juniper", "network"},
	"3C:8A:B0": {"Juniper", "network"},
	"40:71:83": {"Juniper", "network"},
	"40:A6:77": {"Juniper", "network"},
	"40:B4:F0": {"Juniper", "network"},
	"44:AA:50": {"Juniper", "network"},
	"44:F4:77": {"Juniper", "network"},
	"54:1E:56": {"Juniper", "network"},
	"54:E0:32": {"Juniper", "network"},
	"5C:45:27": {"Juniper", "network"},
	"64:64:9B": {"Juniper", "network"},
	"64:87:88": {"Juniper", "network"},
	"78:19:F7": {"Juniper", "network"},
	"78:FE:3D": {"Juniper", "network"},
	"80:71:1F": {"Juniper", "network"},
	"84:18:88": {"Juniper", "network"},
	"84:B5:9C": {"Juniper", "network"},
	"84:C1:C1": {"Juniper", "network"},
	"88:A2:5E": {"Juniper", "network"},
	"88:E0:F3": {"Juniper", "network"},
	"9C:8C:6E": {"Juniper", "network"},
	"A8:D0:E5": {"Juniper", "network"},
	"AC:4B:C8": {"Juniper", "network"},
	"B0:A8:6E": {"Juniper", "network"},
	"B0:C6:9A": {"Juniper", "network"},
	"CC:E1:7F": {"Juniper", "network"},
	"D4:04:FF": {"Juniper", "network"},
	"D8:B1:22": {"Juniper", "network"},
	"DC:38:E1": {"Juniper", "network"},
	"EC:3E:F7": {"Juniper", "network"},
	"EC:F4:BB": {"Juniper", "network"},
	"F0:1C:2D": {"Juniper", "network"},
	"F4:A7:39": {"Juniper", "network"},
	"F4:CC:55": {"Juniper", "network"},

	// ── Fortinet (Network) ────────────────────────────────────────────────────
	"00:09:0F": {"Fortinet", "network"},
	"00:60:0F": {"Fortinet", "network"},
	"08:5B:0E": {"Fortinet", "network"},
	"0C:44:E2": {"Fortinet", "network"},
	"40:3F:8C": {"Fortinet", "network"},
	"48:6B:2C": {"Fortinet", "network"},
	"50:6B:4B": {"Fortinet", "network"},
	"60:C3:F8": {"Fortinet", "network"},
	"6C:0B:84": {"Fortinet", "network"},
	"70:4C:A5": {"Fortinet", "network"},
	"70:A3:06": {"Fortinet", "network"},
	"78:2D:7E": {"Fortinet", "network"},
	"84:27:97": {"Fortinet", "network"},
	"90:1B:0E": {"Fortinet", "network"},
	"90:6C:AC": {"Fortinet", "network"},
	"90:86:C3": {"Fortinet", "network"},
	"B0:0E:D5": {"Fortinet", "network"},
	"BC:CF:4F": {"Fortinet", "network"},
	"C4:00:AD": {"Fortinet", "network"},
	"D0:63:B4": {"Fortinet", "network"},
	"D8:E7:4B": {"Fortinet", "network"},
	"E8:61:7E": {"Fortinet", "network"},
	"E8:F0:F2": {"Fortinet", "network"},
	"F4:DD:9E": {"Fortinet", "network"},

	// ── Philips Hue (IoT) ─────────────────────────────────────────────────────
	"00:17:88": {"Philips Hue", "iot"},
	"EC:B5:FA": {"Philips Hue", "iot"},

	// ── Amazon / Echo / Ring (IoT) ────────────────────────────────────────────
	"00:FC:8B": {"Amazon", "iot"},
	"10:2C:6B": {"Amazon", "iot"},
	"14:91:82": {"Amazon", "iot"},
	"18:74:2E": {"Amazon", "iot"},
	"34:D2:70": {"Amazon", "iot"},
	"38:F7:3D": {"Amazon", "iot"},
	"40:A2:DB": {"Amazon", "iot"},
	"44:65:0D": {"Amazon", "iot"},
	"48:A2:2D": {"Amazon", "iot"},
	"4C:EF:C0": {"Amazon", "iot"},
	"50:DC:E7": {"Amazon", "iot"},
	"54:97:A7": {"Amazon", "iot"},
	"58:2F:40": {"Amazon", "iot"},
	"5C:41:5A": {"Amazon", "iot"},
	"68:37:E9": {"Amazon", "iot"},
	"68:54:FD": {"Amazon", "iot"},
	"6C:56:97": {"Amazon", "iot"},
	"74:75:48": {"Amazon", "iot"},
	"74:C2:46": {"Amazon", "iot"},
	"78:E1:03": {"Amazon", "iot"},
	"84:D6:D0": {"Amazon", "iot"},
	"8C:49:62": {"Amazon", "iot"},
	"A0:02:DC": {"Amazon", "iot"},
	"AC:63:BE": {"Amazon", "iot"},
	"B0:72:BF": {"Amazon", "iot"},
	"B0:FC:0D": {"Amazon", "iot"},
	"B4:7C:9C": {"Amazon", "iot"},
	"B8:BF:83": {"Amazon", "iot"},
	"C4:4F:33": {"Amazon", "iot"},
	"CC:F7:35": {"Amazon", "iot"},
	"E0:D6:E2": {"Amazon", "iot"},
	"FC:65:DE": {"Amazon", "iot"},
	"FC:A1:83": {"Amazon", "iot"},

	// ── Google / Nest (IoT) ───────────────────────────────────────────────────
	"00:1A:11": {"Google/Nest", "iot"},
	"18:B4:30": {"Google/Nest", "iot"},
	"20:DF:B9": {"Google/Nest", "iot"},
	"30:FD:38": {"Google/Nest", "iot"},
	"44:07:0B": {"Google/Nest", "iot"},
	"48:D6:D5": {"Google/Nest", "iot"},
	"54:60:09": {"Google/Nest", "iot"},
	"60:5B:B4": {"Google/Nest", "iot"},
	"6C:AD:F8": {"Google/Nest", "iot"},
	"78:D2:94": {"Google/Nest", "iot"},
	"98:D2:93": {"Google/Nest", "iot"},
	"A4:77:33": {"Google/Nest", "iot"},
	"AC:67:5D": {"Google/Nest", "iot"},
	"D8:EB:46": {"Google/Nest", "iot"},
	"E4:F0:42": {"Google/Nest", "iot"},
	"F4:F5:D8": {"Google/Nest", "iot"},
	"F4:F5:E8": {"Google/Nest", "iot"},

	// ── Sonos (IoT) ──────────────────────────────────────────────────────────
	"00:0E:58": {"Sonos", "iot"},
	"34:7E:5C": {"Sonos", "iot"},
	"48:A6:B8": {"Sonos", "iot"},
	"5C:AA:FD": {"Sonos", "iot"},
	"78:28:CA": {"Sonos", "iot"},
	"94:9F:3E": {"Sonos", "iot"},
	"B8:E9:37": {"Sonos", "iot"},
	"C4:41:1E": {"Sonos", "iot"},

	// ── Shelly (IoT) ─────────────────────────────────────────────────────────
	"08:3A:F2": {"Shelly", "iot"},
	"30:C6:F7": {"Shelly", "iot"},
	"34:AB:95": {"Shelly", "iot"},
	"44:17:93": {"Shelly", "iot"},
	"48:E7:29": {"Shelly", "iot"},
	"84:CC:A8": {"Shelly", "iot"},
	"E8:9F:6D": {"Shelly", "iot"},
	"E8:DB:84": {"Shelly", "iot"},

	// ── Tuya / Smart Life (IoT) ──────────────────────────────────────────────
	"10:D5:61": {"Tuya", "iot"},
	"18:69:D4": {"Tuya", "iot"},
	"24:62:AB": {"Tuya", "iot"},
	"2C:F4:32": {"Tuya", "iot"},
	"30:C9:22": {"Tuya", "iot"},
	"34:EA:34": {"Tuya", "iot"},
	"44:32:C8": {"Tuya", "iot"},
	"50:02:91": {"Tuya", "iot"},
	"50:8A:06": {"Tuya", "iot"},
	"7C:78:B2": {"Tuya", "iot"},
	"84:F3:EB": {"Tuya", "iot"},
	"90:38:0C": {"Tuya", "iot"},
	"A0:92:08": {"Tuya", "iot"},
	"A4:CF:12": {"Tuya", "iot"},
	"BC:DD:C2": {"Tuya", "iot"},
	"C0:49:EF": {"Tuya", "iot"},
	"D4:A6:51": {"Tuya", "iot"},
	"D8:1F:12": {"Tuya", "iot"},
	"E0:98:06": {"Tuya", "iot"},
	"E8:68:E7": {"Tuya", "iot"},
	"F0:FE:6B": {"Tuya", "iot"},
}
