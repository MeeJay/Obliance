// Obliance Legacy Agent — minimal agent for Windows Server 2008 R2+.
// Compiles with Go 1.20. No gopsutil, no systray, no tunnels.
// Single-file agent: push metrics, poll commands, run scripts, report back.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc"
)

// ── Build-time version injection ─────────────────────────────────────────────

var agentVersion = "dev"

// ── Constants ────────────────────────────────────────────────────────────────

const (
	serviceName      = "OblianceAgent"
	configDirDefault = `C:\ProgramData\OblianceAgent`
)

// ── Config ───────────────────────────────────────────────────────────────────

var (
	configDir  string
	configFile string
)

func init() {
	programData := os.Getenv("PROGRAMDATA")
	if programData == "" {
		programData = `C:\ProgramData`
	}
	configDir = filepath.Join(programData, "OblianceAgent")
	configFile = filepath.Join(configDir, "config.json")
}

type Config struct {
	ServerURL            string `json:"serverUrl"`
	APIKey               string `json:"apiKey"`
	DeviceUUID           string `json:"deviceUuid"`
	CheckIntervalSeconds int    `json:"checkIntervalSeconds"`
	AgentVersion         string `json:"agentVersion"`
}

func loadConfig() (*Config, error) {
	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	cfg.ServerURL = strings.Trim(cfg.ServerURL, `"`)
	cfg.APIKey = strings.Trim(cfg.APIKey, `"`)
	return &cfg, nil
}

func saveConfig(cfg *Config) error {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configFile, data, 0644)
}

func loadConfigFromRegistry() (*Config, error) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\OblianceAgent`, registry.QUERY_VALUE)
	if err != nil {
		return nil, fmt.Errorf("registry key not found: %w", err)
	}
	defer k.Close()

	serverURL, _, err := k.GetStringValue("ServerUrl")
	if err != nil || serverURL == "" {
		return nil, fmt.Errorf("ServerUrl not in registry")
	}
	apiKey, _, err := k.GetStringValue("ApiKey")
	if err != nil || apiKey == "" {
		return nil, fmt.Errorf("ApiKey not in registry")
	}
	return &Config{
		ServerURL:            serverURL,
		APIKey:               apiKey,
		CheckIntervalSeconds: 60,
		AgentVersion:         agentVersion,
	}, nil
}

func setupConfig(urlArg, keyArg string) *Config {
	cfg, err := loadConfig()
	if err != nil {
		regCfg, regErr := loadConfigFromRegistry()
		if regErr == nil {
			cfg = regCfg
		}
	} else {
		if regCfg, regErr := loadConfigFromRegistry(); regErr == nil {
			if regCfg.ServerURL != "" && regCfg.ServerURL != cfg.ServerURL {
				log.Printf("Registry override: ServerURL %s -> %s", cfg.ServerURL, regCfg.ServerURL)
				cfg.ServerURL = regCfg.ServerURL
			}
			if regCfg.APIKey != "" && regCfg.APIKey != cfg.APIKey {
				log.Printf("Registry override: APIKey changed")
				cfg.APIKey = regCfg.APIKey
			}
		}
	}

	if cfg == nil {
		if urlArg == "" || keyArg == "" {
			fmt.Fprintf(os.Stderr, "First run: provide --url <serverUrl> --key <apiKey>\n")
			os.Exit(1)
		}
		cfg = &Config{
			ServerURL:            strings.TrimRight(urlArg, "/"),
			APIKey:               keyArg,
			DeviceUUID:           resolveDeviceUUID(""),
			CheckIntervalSeconds: 60,
			AgentVersion:         agentVersion,
		}
		if err := saveConfig(cfg); err != nil {
			log.Printf("Warning: could not save config: %v", err)
		}
	}

	if urlArg != "" {
		cfg.ServerURL = strings.TrimRight(urlArg, "/")
	}
	if keyArg != "" {
		cfg.APIKey = keyArg
	}

	// Normalise http -> https
	if strings.HasPrefix(cfg.ServerURL, "http://") {
		cfg.ServerURL = "https://" + cfg.ServerURL[len("http://"):]
	}
	cfg.ServerURL = strings.TrimRight(cfg.ServerURL, "/")

	cfg.DeviceUUID = resolveDeviceUUID(cfg.DeviceUUID)
	if cfg.CheckIntervalSeconds == 0 {
		cfg.CheckIntervalSeconds = 60
	}
	if cfg.AgentVersion != agentVersion {
		cfg.AgentVersion = agentVersion
		_ = saveConfig(cfg)
	}

	return cfg
}

// ── UUID helpers ─────────────────────────────────────────────────────────────

func generateUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

var uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Must stay in sync with agent/machine_uuid.go.
var badHardwareUUIDs = map[string]bool{
	"00000000-0000-0000-0000-000000000000": true,
	"ffffffff-ffff-ffff-ffff-ffffffffffff": true,
	"12345678-1234-5678-90ab-cddeefaabbcc": true,
	"12345678-1234-5678-1234-567812345678": true,
	"03000200-0400-0500-0006-000700080009": true,
	"00020003-0004-0005-0006-000700080009": true,
	"01020304-0506-0708-090a-0b0c0d0e0f10": true,
	"4c4c4544-0000-1010-8010-c4c04f313233": true,
}

var placeholderSerials = map[string]bool{
	"": true, "0": true, "00000000": true, "000000000000": true,
	"none": true, "n/a": true, "not specified": true, "not applicable": true,
	"default string": true, "to be filled by o.e.m.": true, "to be filled by oem": true,
	"system serial number": true, "system productname": true, "oem": true,
	"chassis serial number": true, "123456": true, "1234567890": true, "unknown": true,
}

func normaliseUUID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if !uuidRe.MatchString(s) {
		return ""
	}
	if badHardwareUUIDs[s] {
		return ""
	}
	return s
}

func isPlaceholderSerial(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	if placeholderSerials[s] {
		return true
	}
	if len(s) > 0 {
		allSame := true
		for i := 1; i < len(s); i++ {
			if s[i] != s[0] {
				allSame = false
				break
			}
		}
		if allSame {
			return true
		}
	}
	return false
}

// hashToUUIDv5 matches machine_uuid.go exactly. Do not modify.
func hashToUUIDv5(input string) string {
	sum := sha256.Sum256([]byte(input))
	var b [16]byte
	copy(b[:], sum[:16])
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// readMachineUUID reads SMBIOS UUID via wmic (available on Server 2008+).
func readMachineUUID() string {
	out, err := exec.Command("wmic", "csproduct", "get", "UUID", "/value").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "UUID=") {
			if uuid := normaliseUUID(strings.TrimPrefix(line, "UUID=")); uuid != "" {
				return uuid
			}
		}
	}
	return ""
}

// readSystemDiskSerial returns the hardware serial of physical disk 0 via
// wmic. Server 2008 R2 lacks Get-Partition, so we assume disk 0 is the
// system disk, which holds true on virtually all Windows installs.
func readSystemDiskSerial() string {
	out, err := exec.Command("wmic", "diskdrive", "where", "Index=0", "get", "SerialNumber", "/value").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "SerialNumber=") {
			return strings.TrimSpace(strings.TrimPrefix(line, "SerialNumber="))
		}
	}
	return ""
}

func deriveHardwareUUID() string {
	raw := strings.TrimSpace(readSystemDiskSerial())
	if raw == "" || isPlaceholderSerial(raw) {
		return ""
	}
	u := hashToUUIDv5("obliance-disk:" + strings.ToLower(raw))
	log.Printf("Device UUID: derived from system disk serial -> %s", u)
	return u
}

func resolveDeviceUUID(stored string) string {
	if hw := readMachineUUID(); hw != "" {
		if hw != stored {
			log.Printf("Device UUID: using machine UUID %s", hw)
		}
		return hw
	}
	if derived := deriveHardwareUUID(); derived != "" {
		if derived != stored {
			log.Printf("Device UUID: SMBIOS invalid, using disk-derived UUID %s", derived)
		}
		return derived
	}
	if stored != "" {
		log.Printf("Device UUID: hardware sources failed, reusing stored UUID %s", stored)
		return stored
	}
	fresh := generateUUID()
	log.Printf("Device UUID: WARNING no hardware ID available, generated random UUID %s", fresh)
	return fresh
}

// ── Windows syscall-based metrics ────────────────────────────────────────────

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	procGetSystemTimes       = kernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetDiskFreeSpaceExW  = kernel32.NewProc("GetDiskFreeSpaceExW")
)

type fileTime struct {
	LowDateTime  uint32
	HighDateTime uint32
}

func fileTimeToUint64(ft fileTime) uint64 {
	return uint64(ft.HighDateTime)<<32 | uint64(ft.LowDateTime)
}

// CPU measurement state
var (
	prevIdleTime   uint64
	prevKernelTime uint64
	prevUserTime   uint64
	cpuMu          sync.Mutex
	cpuFirstCall   = true
)

func getCPUPercent() float64 {
	var idle, kernel, user fileTime
	ret, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	if ret == 0 {
		return 0
	}

	idleVal := fileTimeToUint64(idle)
	kernelVal := fileTimeToUint64(kernel)
	userVal := fileTimeToUint64(user)

	cpuMu.Lock()
	defer cpuMu.Unlock()

	if cpuFirstCall {
		prevIdleTime = idleVal
		prevKernelTime = kernelVal
		prevUserTime = userVal
		cpuFirstCall = false
		return 0
	}

	idleDelta := idleVal - prevIdleTime
	kernelDelta := kernelVal - prevKernelTime
	userDelta := userVal - prevUserTime
	totalDelta := kernelDelta + userDelta

	prevIdleTime = idleVal
	prevKernelTime = kernelVal
	prevUserTime = userVal

	if totalDelta == 0 {
		return 0
	}
	// kernel time includes idle time
	usedDelta := totalDelta - idleDelta
	pct := float64(usedDelta) / float64(totalDelta) * 100.0
	// Round to 1 decimal
	return float64(int(pct*10+0.5)) / 10.0
}

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

type memInfo struct {
	TotalMB uint64
	UsedMB  uint64
	Percent float64
}

func getMemoryInfo() memInfo {
	var ms memoryStatusEx
	ms.Length = uint32(unsafe.Sizeof(ms))
	ret, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&ms)))
	if ret == 0 {
		return memInfo{}
	}
	totalMB := ms.TotalPhys / 1048576
	usedMB := (ms.TotalPhys - ms.AvailPhys) / 1048576
	pct := 0.0
	if ms.TotalPhys > 0 {
		pct = float64(ms.TotalPhys-ms.AvailPhys) / float64(ms.TotalPhys) * 100.0
		pct = float64(int(pct*10+0.5)) / 10.0
	}
	return memInfo{TotalMB: totalMB, UsedMB: usedMB, Percent: pct}
}

type diskInfoLocal struct {
	Mount   string
	TotalGB float64
	UsedGB  float64
	Percent float64
}

func getDiskUsage(drive string) (diskInfoLocal, bool) {
	drivePtr, err := syscall.UTF16PtrFromString(drive)
	if err != nil {
		return diskInfoLocal{}, false
	}
	var freeBytesAvailable, totalBytes, totalFreeBytes uint64
	ret, _, _ := procGetDiskFreeSpaceExW.Call(
		uintptr(unsafe.Pointer(drivePtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	if ret == 0 || totalBytes == 0 {
		return diskInfoLocal{}, false
	}
	usedBytes := totalBytes - totalFreeBytes
	totalGB := float64(int(float64(totalBytes)/1073741824*10+0.5)) / 10.0
	usedGB := float64(int(float64(usedBytes)/1073741824*10+0.5)) / 10.0
	pct := float64(int(float64(usedBytes)/float64(totalBytes)*1000+0.5)) / 10.0
	return diskInfoLocal{
		Mount:   drive,
		TotalGB: totalGB,
		UsedGB:  usedGB,
		Percent: pct,
	}, true
}

func getDisks() []diskInfoLocal {
	var disks []diskInfoLocal
	// Check drives A-Z
	for c := 'A'; c <= 'Z'; c++ {
		drive := string(c) + `:\`
		driveType := getDriveType(drive)
		if driveType == 3 { // DRIVE_FIXED
			if d, ok := getDiskUsage(drive); ok {
				disks = append(disks, d)
			}
		}
	}
	return disks
}

var procGetDriveTypeW = kernel32.NewProc("GetDriveTypeW")

func getDriveType(root string) uint32 {
	p, err := syscall.UTF16PtrFromString(root)
	if err != nil {
		return 0
	}
	ret, _, _ := procGetDriveTypeW.Call(uintptr(unsafe.Pointer(p)))
	return uint32(ret)
}

// ── OS info ──────────────────────────────────────────────────────────────────

type osInfo struct {
	Platform string `json:"platform"`
	Release  string `json:"release"`
	Arch     string `json:"arch"`
	BootTime int64  `json:"bootTime,omitempty"`
	Timezone string `json:"timezone,omitempty"`
}

func getOSInfo() osInfo {
	tz, _ := time.Now().Zone()
	release := getWindowsVersion()
	return osInfo{
		Platform: "windows",
		Release:  release,
		Arch:     runtime.GOARCH,
		Timezone: tz,
	}
}

func getWindowsVersion() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return "unknown"
	}
	defer k.Close()

	productName, _, _ := k.GetStringValue("ProductName")
	buildNumber, _, _ := k.GetStringValue("CurrentBuildNumber")
	if productName == "" {
		return "unknown"
	}
	if buildNumber != "" {
		return productName + " (Build " + buildNumber + ")"
	}
	return productName
}

// ── Network info ─────────────────────────────────────────────────────────────

func getLocalNetworkInfo() (ipLocal, macAddress string) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 || len(iface.HardwareAddr) == 0 {
			continue
		}
		if iface.Flags&net.FlagUp == 0 {
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
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			return ip.String(), iface.HardwareAddr.String()
		}
	}
	return "", ""
}

// ── Agent events ─────────────────────────────────────────────────────────────

type agentEvent struct {
	Type      string                 `json:"type"`
	Timestamp string                 `json:"timestamp"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

var (
	pendingEvents   []agentEvent
	pendingEventsMu sync.Mutex
)

func addEvent(eventType string, data map[string]interface{}) {
	pendingEventsMu.Lock()
	defer pendingEventsMu.Unlock()
	pendingEvents = append(pendingEvents, agentEvent{
		Type:      eventType,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data:      data,
	})
}

func drainEvents() []agentEvent {
	pendingEventsMu.Lock()
	defer pendingEventsMu.Unlock()
	if len(pendingEvents) == 0 {
		return nil
	}
	events := make([]agentEvent, len(pendingEvents))
	copy(events, pendingEvents)
	pendingEvents = pendingEvents[:0]
	return events
}

// ── Push types ───────────────────────────────────────────────────────────────

type cpuMetrics struct {
	Percent float64 `json:"percent"`
}

type memMetrics struct {
	TotalMB uint64  `json:"totalMb"`
	UsedMB  uint64  `json:"usedMb"`
	Percent float64 `json:"percent"`
}

type diskMetrics struct {
	Mount   string  `json:"mount"`
	TotalGB float64 `json:"totalGb"`
	UsedGB  float64 `json:"usedGb"`
	Percent float64 `json:"percent"`
}

type metrics struct {
	CPU    *cpuMetrics   `json:"cpu,omitempty"`
	Memory *memMetrics   `json:"memory,omitempty"`
	Disks  []diskMetrics `json:"disks,omitempty"`
}

type commandAck struct {
	CommandID   string      `json:"commandId"`
	CommandType string      `json:"commandType,omitempty"`
	Status      string      `json:"status"`
	Result      interface{} `json:"result,omitempty"`
}

type pushBody struct {
	DeviceUUID   string       `json:"deviceUuid"`
	Hostname     string       `json:"hostname"`
	AgentVersion string       `json:"agentVersion"`
	OSInfo       osInfo       `json:"osInfo"`
	Metrics      metrics      `json:"metrics"`
	Acks         []commandAck `json:"acks,omitempty"`
	IPLocal      string       `json:"ipLocal,omitempty"`
	MACAddress   string       `json:"macAddress,omitempty"`
	PrivacyMode  bool         `json:"privacyMode"`
	AirgapMode   bool         `json:"airgapMode"`
	Events       []agentEvent `json:"events,omitempty"`
}

type agentCommand struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}

type pushResponse struct {
	Status        string         `json:"status"`
	LatestVersion string         `json:"latestVersion,omitempty"`
	Commands      []agentCommand `json:"commands,omitempty"`
	NextPollIn    int            `json:"nextPollIn,omitempty"`
	Config        *struct {
		CheckIntervalSeconds int `json:"checkIntervalSeconds"`
		PushIntervalSeconds  int `json:"pushIntervalSeconds"`
	} `json:"config,omitempty"`
}

// ── Ack accumulator ──────────────────────────────────────────────────────────

var (
	pendingAcks   []commandAck
	pendingAcksMu sync.Mutex
)

func addAck(ack commandAck) {
	pendingAcksMu.Lock()
	defer pendingAcksMu.Unlock()
	pendingAcks = append(pendingAcks, ack)
}

func drainAcks() []commandAck {
	pendingAcksMu.Lock()
	defer pendingAcksMu.Unlock()
	if len(pendingAcks) == 0 {
		return nil
	}
	acks := make([]commandAck, len(pendingAcks))
	copy(acks, pendingAcks)
	pendingAcks = pendingAcks[:0]
	return acks
}

// ── Privacy / Airgap state ───────────────────────────────────────────────────

var (
	privacyFile string
	airgapFile  string
)

func init() {
	privacyFile = filepath.Join(configDir, "privacy.json")
	airgapFile = filepath.Join(configDir, "airgap.json")
}

type privacyState struct {
	Enabled   bool   `json:"enabled"`
	ChangedAt string `json:"changedAt"`
	ChangedBy string `json:"changedBy"`
}

type airgapState struct {
	Enabled   bool     `json:"enabled"`
	ChangedAt string   `json:"changedAt"`
	ChangedBy string   `json:"changedBy"`
	ServerIPs []string `json:"serverIPs,omitempty"`
}

func readPrivacyEnabled() bool {
	data, err := os.ReadFile(privacyFile)
	if err != nil {
		return false
	}
	var state privacyState
	if err := json.Unmarshal(data, &state); err != nil {
		return false
	}
	return state.Enabled
}

func readAirgapEnabled() bool {
	data, err := os.ReadFile(airgapFile)
	if err != nil {
		return false
	}
	var state airgapState
	if err := json.Unmarshal(data, &state); err != nil {
		return false
	}
	return state.Enabled
}

// ── Running script tracker (for cancel_script) ──────────────────────────────

var (
	runningScripts   = make(map[string]context.CancelFunc)
	runningScriptsMu sync.Mutex
)

func trackScript(cmdID string, cancel context.CancelFunc) {
	runningScriptsMu.Lock()
	defer runningScriptsMu.Unlock()
	runningScripts[cmdID] = cancel
}

func untrackScript(cmdID string) {
	runningScriptsMu.Lock()
	defer runningScriptsMu.Unlock()
	delete(runningScripts, cmdID)
}

func cancelScript(cmdID string) bool {
	runningScriptsMu.Lock()
	defer runningScriptsMu.Unlock()
	if cancel, ok := runningScripts[cmdID]; ok {
		cancel()
		delete(runningScripts, cmdID)
		return true
	}
	return false
}

// ── Push loop ────────────────────────────────────────────────────────────────

var httpClient = &http.Client{Timeout: 30 * time.Second}

func push(cfg *Config) {
	hostname, _ := os.Hostname()
	ipLocal, macAddr := getLocalNetworkInfo()

	mem := getMemoryInfo()
	cpuPct := getCPUPercent()
	disks := getDisks()

	var diskM []diskMetrics
	for _, d := range disks {
		diskM = append(diskM, diskMetrics{
			Mount:   d.Mount,
			TotalGB: d.TotalGB,
			UsedGB:  d.UsedGB,
			Percent: d.Percent,
		})
	}

	body := pushBody{
		DeviceUUID:   cfg.DeviceUUID,
		Hostname:     hostname,
		AgentVersion: cfg.AgentVersion,
		OSInfo:       getOSInfo(),
		Metrics: metrics{
			CPU:    &cpuMetrics{Percent: cpuPct},
			Memory: &memMetrics{TotalMB: mem.TotalMB, UsedMB: mem.UsedMB, Percent: mem.Percent},
			Disks:  diskM,
		},
		Acks:        drainAcks(),
		IPLocal:     ipLocal,
		MACAddress:  macAddr,
		PrivacyMode: readPrivacyEnabled(),
		AirgapMode:  readAirgapEnabled(),
		Events:      drainEvents(),
	}

	data, err := json.Marshal(body)
	if err != nil {
		log.Printf("Push error (marshal): %v", err)
		return
	}

	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/push", bytes.NewReader(data))
	if err != nil {
		log.Printf("Push error (request): %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)

	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("Push error: %v", err)
		return
	}
	defer resp.Body.Close()

	var result pushResponse
	_ = json.NewDecoder(resp.Body).Decode(&result)

	if resp.StatusCode == 200 || resp.StatusCode == 202 {
		log.Printf("Push OK (status=%d, acks=%d, commands=%d)",
			resp.StatusCode, len(body.Acks), len(result.Commands))

		// Update poll interval from server
		if result.NextPollIn > 0 && result.NextPollIn != cfg.CheckIntervalSeconds {
			cfg.CheckIntervalSeconds = result.NextPollIn
			_ = saveConfig(cfg)
			log.Printf("Check interval updated to %ds", cfg.CheckIntervalSeconds)
		} else if result.Config != nil {
			interval := result.Config.PushIntervalSeconds
			if interval == 0 {
				interval = result.Config.CheckIntervalSeconds
			}
			if interval > 0 && interval != cfg.CheckIntervalSeconds {
				cfg.CheckIntervalSeconds = interval
				_ = saveConfig(cfg)
				log.Printf("Check interval updated to %ds", cfg.CheckIntervalSeconds)
			}
		}

		// Dispatch commands
		for _, cmd := range result.Commands {
			handleCommand(cmd)
		}
	} else {
		log.Printf("Push returned status %d", resp.StatusCode)
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func payloadString(payload map[string]interface{}, key string) string {
	if payload == nil {
		return ""
	}
	if v, ok := payload[key].(string); ok {
		return v
	}
	return ""
}

func payloadBool(payload map[string]interface{}, key string) bool {
	if payload == nil {
		return false
	}
	if v, ok := payload[key].(bool); ok {
		return v
	}
	return false
}

func newHiddenCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

func newHiddenCmdContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

// containsTraversal checks for ".." path traversal attempts.
func containsTraversal(p string) bool {
	cleaned := filepath.Clean(p)
	return strings.Contains(cleaned, "..")
}

// isDangerousDelete returns true if the given path should never be deleted.
func isDangerousDelete(p string) bool {
	cleaned := filepath.Clean(p)
	upper := strings.ToUpper(cleaned)
	// Drive root: "C:\" or "C:"
	if len(upper) == 3 && upper[1] == ':' && (upper[2] == '\\' || upper[2] == '/') {
		return true
	}
	if len(upper) == 2 && upper[1] == ':' {
		return true
	}
	norm := strings.ReplaceAll(upper, "/", "\\")
	if norm == `C:\WINDOWS` || norm == `C:\WINDOWS\SYSTEM32` || norm == `C:\PROGRAM FILES` || norm == `C:\PROGRAM FILES (X86)` {
		return true
	}
	return false
}

// ── Command handler ──────────────────────────────────────────────────────────

func handleCommand(cmd agentCommand) {
	log.Printf("Command received: id=%s type=%s", cmd.ID, cmd.Type)

	// Immediately ack that we're working on it
	addAck(commandAck{
		CommandID:   cmd.ID,
		CommandType: cmd.Type,
		Status:      "ack_running",
	})

	go executeCommand(cmd)
}

func executeCommand(cmd agentCommand) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC in command %s (%s): %v", cmd.ID, cmd.Type, r)
			addAck(commandAck{
				CommandID:   cmd.ID,
				CommandType: cmd.Type,
				Status:      "failure",
				Result:      map[string]string{"error": fmt.Sprintf("panic: %v", r)},
			})
		}
	}()

	var result interface{}
	var execErr error

	switch cmd.Type {
	// ── Supported commands ──
	case "run_script":
		result, execErr = handleRunScript(cmd)
	case "cancel_script":
		result, execErr = handleCancelScript(cmd)
	case "restart_agent":
		result, execErr = handleRestartAgent()
	case "scan_inventory":
		result, execErr = handleScanInventory()
	case "reboot":
		execErr = handleReboot(cmd)
	case "shutdown":
		execErr = handleShutdown(cmd)
	case "sleep":
		execErr = handleSleep(cmd)
	case "list_processes":
		result, execErr = handleListProcesses()
	case "kill_process":
		result, execErr = handleKillProcess(cmd)
	case "list_services":
		result, execErr = handleListServices()
	case "restart_service":
		result, execErr = handleRestartService(cmd)
	case "start_service":
		result, execErr = handleStartService(cmd)
	case "stop_service":
		result, execErr = handleStopService(cmd)
	case "list_directory":
		result, execErr = handleListDirectory(cmd)
	case "create_directory":
		result, execErr = handleCreateDirectory(cmd)
	case "rename_file":
		result, execErr = handleRenameFile(cmd)
	case "delete_file":
		result, execErr = handleDeleteFile(cmd)
	case "check_compliance":
		result, execErr = handleCheckCompliance(cmd)
	case "scan_updates":
		result, execErr = handleScanUpdates()
	case "install_update":
		result, execErr = handleInstallUpdate(cmd)
	case "install_updates":
		result, execErr = handleInstallUpdates(cmd)
	case "uninstall_agent":
		execErr = handleUninstallAgent()
	case "list_wts_sessions":
		result, execErr = handleListWtsSessions()
	case "disable_privacy_mode":
		result, execErr = handleDisablePrivacyMode()
	case "enable_airgap":
		result, execErr = handleEnableAirgap(cmd)
	case "disable_airgap":
		result, execErr = handleDisableAirgap()

	// ── Unsupported commands — explicit "not supported" ──
	case "open_remote_tunnel", "close_remote_tunnel",
		"install_oblireach",
		"scan_network",
		"download_file", "upload_file",
		"check_software_compliance", "install_software", "uninstall_software",
		"remediate_rule":
		execErr = fmt.Errorf("not supported on legacy agent")

	default:
		execErr = fmt.Errorf("unsupported on legacy agent")
	}

	if execErr != nil {
		log.Printf("Command %s (%s) failed: %v", cmd.ID, cmd.Type, execErr)
		addAck(commandAck{
			CommandID:   cmd.ID,
			CommandType: cmd.Type,
			Status:      "failure",
			Result:      map[string]string{"error": execErr.Error()},
		})
		return
	}

	addAck(commandAck{
		CommandID:   cmd.ID,
		CommandType: cmd.Type,
		Status:      "success",
		Result:      result,
	})
}

// ── run_script ───────────────────────────────────────────────────────────────

func handleRunScript(cmd agentCommand) (interface{}, error) {
	payload := cmd.Payload
	if payload == nil {
		return nil, fmt.Errorf("run_script: missing payload")
	}

	runtimeStr, _ := payload["runtime"].(string)
	content, _ := payload["content"].(string)
	if runtimeStr == "" {
		return nil, fmt.Errorf("run_script: runtime not specified")
	}
	if content == "" {
		return nil, fmt.Errorf("run_script: content not specified")
	}

	timeoutSec := 300 // default 5 minutes
	if v, ok := payload["timeoutSeconds"].(float64); ok && v > 0 {
		timeoutSec = int(v)
	}

	// Determine shell and script extension
	var shell string
	var args []string
	var ext string

	switch runtimeStr {
	case "powershell":
		shell = "powershell.exe"
		ext = ".ps1"
	case "cmd", "batch":
		shell = "cmd.exe"
		ext = ".bat"
	case "bash":
		shell = "bash"
		ext = ".sh"
	default:
		return nil, fmt.Errorf("run_script: unsupported runtime %q on legacy agent", runtimeStr)
	}

	// Write script to temp file
	tmpFile, err := os.CreateTemp("", "obliance-script-*"+ext)
	if err != nil {
		return nil, fmt.Errorf("run_script: cannot create temp file: %w", err)
	}
	scriptPath := tmpFile.Name()
	defer os.Remove(scriptPath)

	if _, err := tmpFile.WriteString(content); err != nil {
		tmpFile.Close()
		return nil, fmt.Errorf("run_script: cannot write script: %w", err)
	}
	tmpFile.Close()

	switch runtimeStr {
	case "powershell":
		args = []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath}
	case "cmd", "batch":
		args = []string{"/C", scriptPath}
	case "bash":
		args = []string{scriptPath}
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	// Track for cancel_script
	trackScript(cmd.ID, cancel)
	defer untrackScript(cmd.ID)

	execCmd := exec.CommandContext(ctx, shell, args...)
	execCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	var stdout, stderr bytes.Buffer
	execCmd.Stdout = &stdout
	execCmd.Stderr = &stderr

	err = execCmd.Run()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if ctx.Err() != nil {
			return map[string]interface{}{
				"stdout":   stdout.String(),
				"stderr":   stderr.String(),
				"exitCode": -1,
				"timedOut": true,
			}, nil
		} else {
			return nil, fmt.Errorf("run_script: exec error: %w", err)
		}
	}

	return map[string]interface{}{
		"stdout":   stdout.String(),
		"stderr":   stderr.String(),
		"exitCode": exitCode,
	}, nil
}

// ── cancel_script ────────────────────────────────────────────────────────────

func handleCancelScript(cmd agentCommand) (interface{}, error) {
	payload := cmd.Payload
	if payload == nil {
		return nil, fmt.Errorf("cancel_script: missing payload")
	}
	targetCmdID, ok := payload["commandQueueId"].(string)
	if !ok || targetCmdID == "" {
		return nil, fmt.Errorf("cancel_script: commandQueueId not specified")
	}
	if cancelScript(targetCmdID) {
		return map[string]string{"status": "cancelled", "commandQueueId": targetCmdID}, nil
	}
	return map[string]string{"status": "not_found", "commandQueueId": targetCmdID}, nil
}

// ── restart_agent ────────────────────────────────────────────────────────────

func handleRestartAgent() (interface{}, error) {
	log.Printf("Restarting agent service...")
	cmd := newHiddenCmd("cmd.exe", "/C", "net stop OblianceAgent && net start OblianceAgent")
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("restart: %w", err)
	}
	return map[string]string{"message": "restart initiated"}, nil
}

// ── reboot ───────────────────────────────────────────────────────────────────

func handleReboot(cmd agentCommand) error {
	log.Printf("Command %s: initiating system reboot...", cmd.ID)
	delaySecs := 60
	if cmd.Payload != nil {
		if v, ok := cmd.Payload["delaySeconds"].(float64); ok && v >= 0 {
			delaySecs = int(v)
		}
	}
	return newHiddenCmd("shutdown", "/r", "/t", fmt.Sprintf("%d", delaySecs)).Start()
}

// ── sleep ────────────────────────────────────────────────────────────────────

func handleSleep(cmd agentCommand) error {
	log.Printf("Command %s: suspending system...", cmd.ID)
	return newHiddenCmd("rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0").Start()
}

// ── shutdown ─────────────────────────────────────────────────────────────────

func handleShutdown(cmd agentCommand) error {
	log.Printf("Command %s: initiating system shutdown...", cmd.ID)
	delaySecs := 60
	if cmd.Payload != nil {
		if v, ok := cmd.Payload["delaySeconds"].(float64); ok && v >= 0 {
			delaySecs = int(v)
		}
	}
	return newHiddenCmd("shutdown", "/s", "/t", fmt.Sprintf("%d", delaySecs)).Start()
}

// ── list_processes ───────────────────────────────────────────────────────────

type processInfo struct {
	PID      int    `json:"pid"`
	Name     string `json:"name"`
	MemBytes int64  `json:"memBytes"`
	User     string `json:"user"`
}

func handleListProcesses() (interface{}, error) {
	out, err := newHiddenCmd("tasklist", "/V", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return nil, fmt.Errorf("list_processes: tasklist failed: %w", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	processes := make([]processInfo, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "\"") {
			continue
		}
		fields := parseCSVLine(line)
		if len(fields) < 7 {
			continue
		}
		// Fields: Name, PID, SessionName, Session#, MemUsage, Status, UserName, ...
		pid, _ := strconv.Atoi(fields[1])
		if pid == 0 {
			continue
		}
		memStr := strings.ReplaceAll(strings.ReplaceAll(fields[4], ",", ""), " K", "")
		memStr = strings.ReplaceAll(memStr, "\u00a0", "")
		memStr = strings.TrimSpace(memStr)
		memKB, _ := strconv.ParseInt(memStr, 10, 64)
		user := ""
		if len(fields) >= 7 {
			user = fields[6]
		}
		processes = append(processes, processInfo{
			PID:      pid,
			Name:     fields[0],
			MemBytes: memKB * 1024,
			User:     user,
		})
	}
	return map[string]interface{}{"processes": processes}, nil
}

// parseCSVLine splits a CSV line respecting double-quote escaping.
func parseCSVLine(line string) []string {
	var fields []string
	var field strings.Builder
	inQuote := false
	for i := 0; i < len(line); i++ {
		c := line[i]
		if c == '"' {
			if inQuote && i+1 < len(line) && line[i+1] == '"' {
				field.WriteByte('"')
				i++
			} else {
				inQuote = !inQuote
			}
		} else if c == ',' && !inQuote {
			fields = append(fields, field.String())
			field.Reset()
		} else {
			field.WriteByte(c)
		}
	}
	fields = append(fields, field.String())
	return fields
}

// ── kill_process ─────────────────────────────────────────────────────────────

func handleKillProcess(cmd agentCommand) (interface{}, error) {
	pidVal, ok := cmd.Payload["pid"]
	if !ok {
		return nil, fmt.Errorf("kill_process: missing pid")
	}
	pid := 0
	switch v := pidVal.(type) {
	case float64:
		pid = int(v)
	case int:
		pid = v
	case string:
		var err error
		pid, err = strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("kill_process: invalid pid %q", v)
		}
	default:
		return nil, fmt.Errorf("kill_process: invalid pid type")
	}
	if pid <= 0 {
		return nil, fmt.Errorf("kill_process: invalid pid %d", pid)
	}

	err := newHiddenCmd("taskkill", "/F", "/PID", strconv.Itoa(pid)).Run()
	if err != nil {
		return nil, fmt.Errorf("kill_process pid=%d: %w", pid, err)
	}
	log.Printf("Process %d killed successfully", pid)
	return map[string]interface{}{"killed": pid}, nil
}

// ── list_services ────────────────────────────────────────────────────────────

type serviceInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName,omitempty"`
	Status      string `json:"status"`
	StartType   string `json:"startType,omitempty"`
	RunAsUser   string `json:"runAsUser,omitempty"`
}

func handleListServices() (interface{}, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	out, err := newHiddenCmdContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		`Get-CimInstance -ClassName Win32_Service | Select-Object Name,DisplayName,State,StartMode,StartName | ConvertTo-Json -Compress`).Output()
	if err != nil {
		return nil, fmt.Errorf("list_services: powershell failed: %w", err)
	}
	trimmed := strings.TrimSpace(string(out))
	if len(trimmed) == 0 {
		return map[string]interface{}{"services": []serviceInfo{}, "count": 0}, nil
	}
	var raw []json.RawMessage
	if trimmed[0] == '[' {
		if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
			return nil, fmt.Errorf("list_services: parse error: %w", err)
		}
	} else {
		raw = []json.RawMessage{json.RawMessage(trimmed)}
	}
	type ciService struct {
		Name        string `json:"Name"`
		DisplayName string `json:"DisplayName"`
		State       string `json:"State"`
		StartMode   string `json:"StartMode"`
		StartName   string `json:"StartName"`
	}
	services := make([]serviceInfo, 0, len(raw))
	for _, r := range raw {
		var ci ciService
		if err := json.Unmarshal(r, &ci); err != nil {
			continue
		}
		services = append(services, serviceInfo{
			Name:        ci.Name,
			DisplayName: ci.DisplayName,
			Status:      strings.ToLower(ci.State),
			StartType:   strings.ToLower(ci.StartMode),
			RunAsUser:   ci.StartName,
		})
	}
	return map[string]interface{}{"services": services, "count": len(services)}, nil
}

// ── restart_service ──────────────────────────────────────────────────────────

func handleRestartService(cmd agentCommand) (interface{}, error) {
	name := payloadString(cmd.Payload, "name")
	if name == "" {
		return nil, fmt.Errorf("restart_service: name not specified")
	}
	out, err := newHiddenCmd("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		fmt.Sprintf(`Restart-Service -Name '%s' -Force -PassThru | Select-Object Name,Status | ConvertTo-Json -Compress`, name)).Output()
	if err != nil {
		return nil, fmt.Errorf("restart_service: %w", err)
	}
	return map[string]string{"name": name, "output": strings.TrimSpace(string(out))}, nil
}

// ── start_service ────────────────────────────────────────────────────────────

func handleStartService(cmd agentCommand) (interface{}, error) {
	name := payloadString(cmd.Payload, "name")
	if name == "" {
		return nil, fmt.Errorf("start_service: name not specified")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	out, err := newHiddenCmdContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		fmt.Sprintf(`Start-Service -Name '%s' -PassThru | Select-Object Name,Status | ConvertTo-Json -Compress`, name)).Output()
	if err != nil {
		return nil, fmt.Errorf("start_service: %w", err)
	}
	return map[string]string{"name": name, "output": strings.TrimSpace(string(out))}, nil
}

// ── stop_service ─────────────────────────────────────────────────────────────

func handleStopService(cmd agentCommand) (interface{}, error) {
	name := payloadString(cmd.Payload, "name")
	if name == "" {
		return nil, fmt.Errorf("stop_service: name not specified")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	out, err := newHiddenCmdContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		fmt.Sprintf(`Stop-Service -Name '%s' -Force -PassThru | Select-Object Name,Status | ConvertTo-Json -Compress`, name)).Output()
	if err != nil {
		return nil, fmt.Errorf("stop_service: %w", err)
	}
	return map[string]string{"name": name, "output": strings.TrimSpace(string(out))}, nil
}

// ── list_directory ───────────────────────────────────────────────────────────

type fileInfoEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
	Mode     string `json:"mode"`
}

func handleListDirectory(cmd agentCommand) (interface{}, error) {
	dirPath := payloadString(cmd.Payload, "path")

	// Empty path: list drive roots
	if dirPath == "" {
		var drives []fileInfoEntry
		for letter := 'A'; letter <= 'Z'; letter++ {
			drive := string(letter) + ":\\"
			info, err := os.Stat(drive)
			if err == nil {
				drives = append(drives, fileInfoEntry{
					Name:     drive,
					Path:     drive,
					IsDir:    true,
					Size:     0,
					Modified: info.ModTime().UTC().Format(time.RFC3339),
					Mode:     info.Mode().String(),
				})
			}
		}
		return map[string]interface{}{
			"path":  "",
			"files": drives,
		}, nil
	}

	if containsTraversal(dirPath) {
		return nil, fmt.Errorf("list_directory: path traversal not allowed")
	}

	dirPath = filepath.Clean(dirPath)

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("list_directory: %w", err)
	}

	files := make([]fileInfoEntry, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fullPath := filepath.Join(dirPath, entry.Name())
		files = append(files, fileInfoEntry{
			Name:     entry.Name(),
			Path:     fullPath,
			IsDir:    entry.IsDir(),
			Size:     info.Size(),
			Modified: info.ModTime().UTC().Format(time.RFC3339),
			Mode:     info.Mode().String(),
		})
	}

	// Sort: directories first, then alphabetical (case-insensitive).
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	return map[string]interface{}{
		"path":  dirPath,
		"files": files,
	}, nil
}

// ── create_directory ─────────────────────────────────────────────────────────

func handleCreateDirectory(cmd agentCommand) (interface{}, error) {
	dirPath := payloadString(cmd.Payload, "path")
	if dirPath == "" {
		return nil, fmt.Errorf("create_directory: missing path")
	}
	if containsTraversal(dirPath) {
		return nil, fmt.Errorf("create_directory: path traversal not allowed")
	}
	dirPath = filepath.Clean(dirPath)
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		return nil, fmt.Errorf("create_directory: %w", err)
	}
	log.Printf("Directory created: %s", dirPath)
	return map[string]interface{}{
		"path":    dirPath,
		"message": "directory created",
	}, nil
}

// ── rename_file ──────────────────────────────────────────────────────────────

func handleRenameFile(cmd agentCommand) (interface{}, error) {
	oldPath := payloadString(cmd.Payload, "oldPath")
	newPath := payloadString(cmd.Payload, "newPath")
	if oldPath == "" || newPath == "" {
		return nil, fmt.Errorf("rename_file: missing oldPath or newPath")
	}
	if containsTraversal(oldPath) || containsTraversal(newPath) {
		return nil, fmt.Errorf("rename_file: path traversal not allowed")
	}
	oldPath = filepath.Clean(oldPath)
	newPath = filepath.Clean(newPath)
	if err := os.Rename(oldPath, newPath); err != nil {
		return nil, fmt.Errorf("rename_file: %w", err)
	}
	log.Printf("Renamed %s -> %s", oldPath, newPath)
	return map[string]interface{}{
		"oldPath": oldPath,
		"newPath": newPath,
		"message": "renamed",
	}, nil
}

// ── delete_file ──────────────────────────────────────────────────────────────

func handleDeleteFile(cmd agentCommand) (interface{}, error) {
	filePath := payloadString(cmd.Payload, "path")
	if filePath == "" {
		return nil, fmt.Errorf("delete_file: missing path")
	}
	if containsTraversal(filePath) {
		return nil, fmt.Errorf("delete_file: path traversal not allowed")
	}
	filePath = filepath.Clean(filePath)
	recursive := payloadBool(cmd.Payload, "recursive")

	if isDangerousDelete(filePath) {
		return nil, fmt.Errorf("delete_file: refusing to delete protected system path %q", filePath)
	}

	info, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("delete_file: %w", err)
	}

	if info.IsDir() {
		if recursive {
			err = os.RemoveAll(filePath)
		} else {
			err = os.Remove(filePath)
		}
	} else {
		err = os.Remove(filePath)
	}

	if err != nil {
		return nil, fmt.Errorf("delete_file: %w", err)
	}

	log.Printf("Deleted: %s (recursive=%v)", filePath, recursive)
	return map[string]interface{}{
		"path":    filePath,
		"message": "deleted",
	}, nil
}

// ── scan_inventory ───────────────────────────────────────────────────────────

func handleScanInventory() (interface{}, error) {
	hostname, _ := os.Hostname()
	ipLocal, macAddr := getLocalNetworkInfo()
	osVer := getWindowsVersion()

	inventory := map[string]interface{}{
		"hostname":   hostname,
		"os":         "windows",
		"osVersion":  osVer,
		"arch":       runtime.GOARCH,
		"ipLocal":    ipLocal,
		"macAddress": macAddr,
		"legacy":     true,
	}
	return inventory, nil
}

// ── check_compliance ─────────────────────────────────────────────────────────

type complianceRule struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	Category       string      `json:"category"`
	CheckType      string      `json:"checkType"`
	TargetPlatform string      `json:"targetPlatform"`
	Target         string      `json:"target"`
	Expected       interface{} `json:"expected"`
	Operator       string      `json:"operator"`
	Severity       string      `json:"severity"`
}

type complianceRuleResult struct {
	RuleID      string      `json:"ruleId"`
	Status      string      `json:"status"`
	ActualValue interface{} `json:"actualValue,omitempty"`
	CheckedAt   string      `json:"checkedAt"`
}

func handleCheckCompliance(cmd agentCommand) (interface{}, error) {
	// Parse rules from payload
	var rules []complianceRule
	if cmd.Payload != nil {
		if rulesRaw, ok := cmd.Payload["rules"]; ok {
			rawBytes, err := json.Marshal(rulesRaw)
			if err == nil {
				_ = json.Unmarshal(rawBytes, &rules)
			}
		}
	}

	policyId := interface{}(nil)
	if cmd.Payload != nil {
		policyId = cmd.Payload["policyId"]
	}

	results := make([]complianceRuleResult, 0, len(rules))
	for _, rule := range rules {
		r := evaluateComplianceRuleLegacy(rule)
		results = append(results, r)
	}

	// If no rules, fall back to legacy firewall check
	if len(rules) == 0 {
		fw := checkFirewallStatus()
		fwStatus := "unknown"
		if strings.Contains(fw, "profiles_enabled:3") || strings.Contains(fw, "State is enabled") {
			fwStatus = "pass"
		} else if fw != "unknown" {
			fwStatus = "fail"
		}
		results = append(results, complianceRuleResult{
			RuleID:      "firewall",
			Status:      fwStatus,
			ActualValue: fw,
			CheckedAt:   time.Now().UTC().Format(time.RFC3339),
		})
	}

	// Compute score
	passed := 0
	evaluated := 0
	for _, r := range results {
		if r.Status == "skipped" || r.Status == "unknown" {
			continue
		}
		evaluated++
		if r.Status == "pass" {
			passed++
		}
	}
	score := 0.0
	if evaluated > 0 {
		score = float64(passed) / float64(evaluated) * 100.0
	}

	return map[string]interface{}{
		"policyId": policyId,
		"score":    score,
		"passed":   passed,
		"failed":   evaluated - passed,
		"total":    len(results),
		"platform": "windows",
	}, nil
}

func evaluateComplianceRuleLegacy(rule complianceRule) complianceRuleResult {
	now := time.Now().UTC().Format(time.RFC3339)
	r := complianceRuleResult{RuleID: rule.ID, CheckedAt: now}

	// Skip rules for other platforms
	if rule.TargetPlatform != "all" && rule.TargetPlatform != "windows" {
		r.Status = "skipped"
		return r
	}

	switch rule.CheckType {
	case "registry":
		actual, err := checkRegistryValue(rule.Target)
		if err != nil {
			r.Status = "error"
			r.ActualValue = err.Error()
			return r
		}
		r.ActualValue = actual
		r.Status = compareValues(actual, rule.Expected, rule.Operator)

	case "command":
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		out, err := newHiddenCmdContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", rule.Target).Output()
		if err != nil {
			r.Status = "error"
			r.ActualValue = fmt.Sprintf("exec error: %v", err)
			return r
		}
		actual := strings.TrimSpace(string(out))
		r.ActualValue = actual
		r.Status = compareValues(actual, rule.Expected, rule.Operator)

	case "service":
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		out, err := newHiddenCmdContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
			fmt.Sprintf(`(Get-Service -Name '%s' -EA SilentlyContinue).Status`, rule.Target)).Output()
		if err != nil {
			r.Status = "error"
			r.ActualValue = fmt.Sprintf("service query error: %v", err)
			return r
		}
		actual := strings.TrimSpace(string(out))
		r.ActualValue = actual
		r.Status = compareValues(actual, rule.Expected, rule.Operator)

	case "file":
		_, err := os.Stat(rule.Target)
		if rule.Operator == "exists" {
			if err == nil {
				r.Status = "pass"
				r.ActualValue = "exists"
			} else {
				r.Status = "fail"
				r.ActualValue = "not found"
			}
		} else if rule.Operator == "not_exists" {
			if err != nil {
				r.Status = "pass"
				r.ActualValue = "not found"
			} else {
				r.Status = "fail"
				r.ActualValue = "exists"
			}
		} else {
			r.Status = "error"
			r.ActualValue = "unsupported file operator"
		}

	case "process":
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		out, err := newHiddenCmdContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
			fmt.Sprintf(`(Get-Process -Name '%s' -EA SilentlyContinue | Measure-Object).Count`, rule.Target)).Output()
		if err != nil {
			r.Status = "error"
			r.ActualValue = fmt.Sprintf("process check error: %v", err)
			return r
		}
		actual := strings.TrimSpace(string(out))
		r.ActualValue = actual
		r.Status = compareValues(actual, rule.Expected, rule.Operator)

	default:
		r.Status = "skipped"
		r.ActualValue = fmt.Sprintf("checkType %q not supported on legacy agent", rule.CheckType)
	}

	return r
}

func checkRegistryValue(target string) (string, error) {
	// Target format: "HKLM\Path\To\Key:ValueName"
	parts := strings.SplitN(target, ":", 2)
	if len(parts) < 2 {
		return "", fmt.Errorf("invalid registry target format (expected path:valueName)")
	}
	keyPath := parts[0]
	valueName := parts[1]

	// Determine root key
	var rootKey registry.Key
	if strings.HasPrefix(keyPath, "HKLM\\") || strings.HasPrefix(keyPath, "HKEY_LOCAL_MACHINE\\") {
		rootKey = registry.LOCAL_MACHINE
		keyPath = strings.TrimPrefix(keyPath, "HKLM\\")
		keyPath = strings.TrimPrefix(keyPath, "HKEY_LOCAL_MACHINE\\")
	} else if strings.HasPrefix(keyPath, "HKCU\\") || strings.HasPrefix(keyPath, "HKEY_CURRENT_USER\\") {
		rootKey = registry.CURRENT_USER
		keyPath = strings.TrimPrefix(keyPath, "HKCU\\")
		keyPath = strings.TrimPrefix(keyPath, "HKEY_CURRENT_USER\\")
	} else {
		return "", fmt.Errorf("unsupported registry root in %q", target)
	}

	k, err := registry.OpenKey(rootKey, keyPath, registry.QUERY_VALUE)
	if err != nil {
		return "", fmt.Errorf("open key: %w", err)
	}
	defer k.Close()

	// Try string first, then DWORD
	strVal, _, err := k.GetStringValue(valueName)
	if err == nil {
		return strVal, nil
	}
	intVal, _, err := k.GetIntegerValue(valueName)
	if err == nil {
		return strconv.FormatUint(intVal, 10), nil
	}
	return "", fmt.Errorf("value %q not found", valueName)
}

func compareValues(actual string, expected interface{}, operator string) string {
	expectedStr := fmt.Sprintf("%v", expected)
	actualLower := strings.ToLower(strings.TrimSpace(actual))
	expectedLower := strings.ToLower(strings.TrimSpace(expectedStr))

	switch operator {
	case "eq":
		if actualLower == expectedLower {
			return "pass"
		}
		return "fail"
	case "neq":
		if actualLower != expectedLower {
			return "pass"
		}
		return "fail"
	case "contains":
		if strings.Contains(actualLower, expectedLower) {
			return "pass"
		}
		return "fail"
	case "not_contains":
		if !strings.Contains(actualLower, expectedLower) {
			return "pass"
		}
		return "fail"
	case "gt":
		actualNum, err1 := strconv.ParseFloat(strings.TrimSpace(actual), 64)
		expectedNum, err2 := strconv.ParseFloat(strings.TrimSpace(expectedStr), 64)
		if err1 == nil && err2 == nil && actualNum > expectedNum {
			return "pass"
		}
		return "fail"
	case "lt":
		actualNum, err1 := strconv.ParseFloat(strings.TrimSpace(actual), 64)
		expectedNum, err2 := strconv.ParseFloat(strings.TrimSpace(expectedStr), 64)
		if err1 == nil && err2 == nil && actualNum < expectedNum {
			return "pass"
		}
		return "fail"
	case "exists":
		if actual != "" {
			return "pass"
		}
		return "fail"
	case "not_exists":
		if actual == "" {
			return "pass"
		}
		return "fail"
	case "regex":
		re, err := regexp.Compile(expectedStr)
		if err != nil {
			return "error"
		}
		if re.MatchString(actual) {
			return "pass"
		}
		return "fail"
	default:
		return "error"
	}
}

func checkFirewallStatus() string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := newHiddenCmdContext(ctx, "netsh", "advfirewall", "show", "allprofiles", "state").Output()
	if err != nil {
		return "unknown"
	}
	output := string(out)
	enabledCount := strings.Count(strings.ToLower(output), "on")
	return fmt.Sprintf("profiles_enabled:%d", enabledCount)
}

// ── scan_updates ─────────────────────────────────────────────────────────────

type updateInfo struct {
	UpdateUID      string `json:"updateUid"`
	Title          string `json:"title"`
	Description    string `json:"description,omitempty"`
	Severity       string `json:"severity"`
	Category       string `json:"category,omitempty"`
	Source         string `json:"source"`
	SizeBytes      int64  `json:"sizeBytes,omitempty"`
	RequiresReboot bool   `json:"requiresReboot"`
}

func handleScanUpdates() (interface{}, error) {
	updates, rebootPending, err := scanWindowsUpdatesLegacy()
	if err != nil {
		return nil, fmt.Errorf("scan_updates: %w", err)
	}
	return map[string]interface{}{
		"updateCount":   len(updates),
		"rebootPending": rebootPending,
		"updates":       updates,
	}, nil
}

func scanWindowsUpdatesLegacy() ([]updateInfo, bool, error) {
	const psScript = `$ErrorActionPreference='SilentlyContinue'
$session = New-Object -ComObject Microsoft.Update.Session
$session.ClientApplicationID = 'OblianceAgent'
$searcher = $session.CreateUpdateSearcher()
try { $result = $searcher.Search("IsInstalled=0 and Type='Software'") } catch { $result = $null }
if ($result) {
  foreach ($u in $result.Updates) {
    $kb = ($u.KBArticleIDs | Select-Object -First 1)
    $sev = if ($u.MsrcSeverity) { $u.MsrcSeverity.ToLower() } else { 'unknown' }
    $cat = if ($u.Categories.Count -gt 0) { $u.Categories.Item(0).Name } else { '' }
    $reboot = if ($u.InstallationBehavior.RebootBehavior -eq 1) { 'True' } else { 'False' }
    "$kb|$($u.Title)|$sev|$cat|$($u.MaxDownloadSize)|$reboot"
  }
}
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') {
  "REBOOT_PENDING"
}`

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	out, err := newHiddenCmdContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", psScript).Output()
	if err != nil {
		return nil, false, fmt.Errorf("windows update scan failed: %w", err)
	}

	var updates []updateInfo
	rebootPending := false
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if line == "REBOOT_PENDING" {
			rebootPending = true
			continue
		}

		parts := strings.SplitN(line, "|", 6)
		if len(parts) < 2 {
			continue
		}
		uid := strings.TrimSpace(parts[0])
		title := strings.TrimSpace(parts[1])
		if title == "" {
			continue
		}
		if uid == "" {
			uid = sanitizeUID(title)
		}
		severity := "unknown"
		if len(parts) >= 3 {
			severity = normaliseSeverity(strings.TrimSpace(parts[2]))
		}
		category := ""
		if len(parts) >= 4 {
			category = strings.TrimSpace(parts[3])
		}
		var sizeBytes int64
		if len(parts) >= 5 {
			fmt.Sscanf(strings.TrimSpace(parts[4]), "%d", &sizeBytes)
		}
		requiresReboot := false
		if len(parts) >= 6 {
			requiresReboot = strings.EqualFold(strings.TrimSpace(parts[5]), "true")
		}
		updates = append(updates, updateInfo{
			UpdateUID:      uid,
			Title:          title,
			Severity:       severity,
			Category:       category,
			Source:         "windows_update",
			SizeBytes:      sizeBytes,
			RequiresReboot: requiresReboot,
		})
	}

	// Deduplicate
	seen := make(map[string]bool)
	deduped := make([]updateInfo, 0, len(updates))
	for _, u := range updates {
		if seen[u.UpdateUID] {
			continue
		}
		seen[u.UpdateUID] = true
		deduped = append(deduped, u)
	}

	return deduped, rebootPending, nil
}

func sanitizeUID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "-")
	// Remove non-alphanumeric except dash and dot
	var b strings.Builder
	for _, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.' {
			b.WriteRune(c)
		}
	}
	result := b.String()
	if len(result) > 128 {
		result = result[:128]
	}
	return result
}

func normaliseSeverity(s string) string {
	switch strings.ToLower(s) {
	case "critical":
		return "critical"
	case "important":
		return "important"
	case "moderate":
		return "moderate"
	case "low", "optional", "unspecified":
		return "optional"
	default:
		return "unknown"
	}
}

// ── install_update ───────────────────────────────────────────────────────────

func handleInstallUpdate(cmd agentCommand) (interface{}, error) {
	payload := cmd.Payload
	if payload == nil {
		return nil, fmt.Errorf("install_update: missing payload")
	}
	uid, ok := payload["updateUid"].(string)
	if !ok || uid == "" {
		return nil, fmt.Errorf("install_update: updateUid not specified")
	}
	if err := installWindowsUpdateLegacy(uid); err != nil {
		return nil, err
	}
	return map[string]string{"updateUid": uid, "message": "installed successfully"}, nil
}

// ── install_updates ──────────────────────────────────────────────────────────

func handleInstallUpdates(cmd agentCommand) (interface{}, error) {
	payload := cmd.Payload
	if payload == nil {
		return nil, fmt.Errorf("install_updates: missing payload")
	}
	rawUids, ok := payload["updateUids"].([]interface{})
	if !ok || len(rawUids) == 0 {
		return nil, fmt.Errorf("install_updates: updateUids array required")
	}
	var uids []string
	for _, raw := range rawUids {
		if s, ok := raw.(string); ok && s != "" {
			uids = append(uids, s)
		}
	}
	if len(uids) == 0 {
		return nil, fmt.Errorf("install_updates: no valid uids")
	}

	for _, uid := range uids {
		if err := installWindowsUpdateLegacy(uid); err != nil {
			return nil, fmt.Errorf("install_updates: failed on %s: %w", uid, err)
		}
	}
	return map[string]interface{}{"updateUids": uids, "count": len(uids), "message": "batch install completed"}, nil
}

func installWindowsUpdateLegacy(uid string) error {
	// Use PowerShell COM API to search, download and install the update
	psScript := fmt.Sprintf(`$ErrorActionPreference='Stop'
$session = New-Object -ComObject Microsoft.Update.Session
$session.ClientApplicationID = 'OblianceAgent'
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and Type='Software'")
$found = $null
foreach ($u in $result.Updates) {
  $kb = ($u.KBArticleIDs | Select-Object -First 1)
  if ($kb -eq '%s' -or $u.Title -like '*%s*') {
    $found = $u
    break
  }
}
if (-not $found) { Write-Error "Update not found: %s"; exit 1 }
$toDownload = New-Object -ComObject Microsoft.Update.UpdateColl
$toDownload.Add($found) | Out-Null
$downloader = $session.CreateUpdateDownloader()
$downloader.Updates = $toDownload
$downloader.Download() | Out-Null
$toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
$toInstall.Add($found) | Out-Null
$installer = $session.CreateUpdateInstaller()
$installer.Updates = $toInstall
$installResult = $installer.Install()
if ($installResult.ResultCode -ne 2) { Write-Error "Install failed with code $($installResult.ResultCode)"; exit 1 }
Write-Output "OK"
`, uid, uid, uid)

	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Second)
	defer cancel()
	out, err := newHiddenCmdContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript).CombinedOutput()
	if err != nil {
		return fmt.Errorf("install update %s: %v — %s", uid, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// ── uninstall_agent ──────────────────────────────────────────────────────────

func handleUninstallAgent() error {
	log.Printf("Uninstall command received — agent will self-remove in 10 minutes...")
	go func() {
		const countdownSec = 600
		ticker := time.NewTicker(60 * time.Second)
		remaining := countdownSec
		for remaining > 0 {
			<-ticker.C
			remaining -= 60
			if remaining > 0 {
				log.Printf("Uninstall countdown: %d minutes remaining...", remaining/60)
			}
		}
		ticker.Stop()

		log.Printf("Uninstall: launching cleanup...")
		scriptPath := filepath.Join(os.TempDir(), "obliance-uninstall.bat")
		script := "@echo off\r\n" +
			"timeout /t 3 /nobreak >nul\r\n" +
			"sc stop OblianceAgent >nul 2>&1\r\n" +
			"timeout /t 2 /nobreak >nul\r\n" +
			"sc delete OblianceAgent >nul 2>&1\r\n" +
			"rd /s /q \"C:\\Program Files\\OblianceAgent\" >nul 2>&1\r\n" +
			"rd /s /q \"C:\\ProgramData\\OblianceAgent\" >nul 2>&1\r\n" +
			"reg delete \"HKLM\\SOFTWARE\\OblianceAgent\" /f >nul 2>&1\r\n" +
			"del /q \"%~f0\"\r\n"

		if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
			log.Printf("Uninstall: failed to write script: %v", err)
			return
		}

		// VBS wrapper — run batch with hidden window
		vbsPath := filepath.Join(os.TempDir(), "obliance-uninstall.vbs")
		vbs := fmt.Sprintf("CreateObject(\"WScript.Shell\").Run \"%s\", 0, False\r\n", scriptPath)
		if err := os.WriteFile(vbsPath, []byte(vbs), 0644); err != nil {
			log.Printf("Uninstall: failed to write VBS wrapper: %v", err)
			return
		}
		if err := newHiddenCmd("wscript.exe", vbsPath).Start(); err != nil {
			log.Printf("Uninstall: failed to start script: %v", err)
			return
		}
		log.Printf("Uninstall: script launched — shutting down agent...")
		os.Exit(0)
	}()
	return nil
}

// ── list_wts_sessions ────────────────────────────────────────────────────────

type wtsSession struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username"`
	State    string `json:"state"`
}

func handleListWtsSessions() (interface{}, error) {
	// Use "query session" command and parse output (no WTS API needed)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := newHiddenCmdContext(ctx, "query", "session").Output()
	if err != nil {
		return nil, fmt.Errorf("list_wts_sessions: query session failed: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	sessions := make([]wtsSession, 0)
	for i, line := range lines {
		if i == 0 {
			// Skip header line
			continue
		}
		line = strings.TrimRight(line, "\r")
		if len(line) < 20 {
			continue
		}

		// Parse fixed-width columns from "query session"
		// Format: SESSIONNAME  USERNAME  ID  STATE  TYPE  DEVICE
		// The username column may be empty.
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}

		// Determine which field is the ID (first purely numeric field)
		sessionName := ""
		username := ""
		sessionID := 0
		state := ""
		idIdx := -1

		for fi, f := range fields {
			if n, err := strconv.Atoi(f); err == nil && fi < 4 {
				sessionID = n
				idIdx = fi
				break
			}
		}
		if idIdx < 0 {
			continue
		}

		// Fields before ID
		switch idIdx {
		case 1:
			// SESSIONNAME ID STATE ...
			sessionName = fields[0]
		case 2:
			// SESSIONNAME USERNAME ID STATE ...
			sessionName = fields[0]
			username = fields[1]
		default:
			sessionName = fields[0]
		}

		// State is the field after ID
		if idIdx+1 < len(fields) {
			state = strings.ToLower(fields[idIdx+1])
		}

		// Map state to our standard names
		switch state {
		case "active", "actif":
			state = "active"
		case "disc":
			state = "disconnected"
		case "conn":
			state = "connected"
		default:
			// keep as-is
		}

		// Skip sessions with no user (services session, listeners)
		if username == "" && (state != "active" || sessionName == "services" || sessionName == "Services") {
			continue
		}

		sessions = append(sessions, wtsSession{
			ID:       sessionID,
			Name:     sessionName,
			Username: username,
			State:    state,
		})
	}
	return map[string]interface{}{"sessions": sessions}, nil
}

// ── disable_privacy_mode ─────────────────────────────────────────────────────

func handleDisablePrivacyMode() (interface{}, error) {
	// Check if privacy.json is read-only (locked)
	info, err := os.Stat(privacyFile)
	if err == nil && info.Mode().Perm()&0200 == 0 {
		return nil, fmt.Errorf("Privacy Mode locked on this device")
	}

	state := privacyState{
		Enabled:   false,
		ChangedAt: time.Now().UTC().Format(time.RFC3339),
		ChangedBy: "remote",
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("privacy: marshal: %w", err)
	}
	if err := os.WriteFile(privacyFile, data, 0644); err != nil {
		return nil, fmt.Errorf("privacy: write: %w", err)
	}
	log.Printf("privacy: mode set to false (by remote)")
	return map[string]string{"message": "privacy mode disabled"}, nil
}

// ── enable_airgap ────────────────────────────────────────────────────────────

func handleEnableAirgap(cmd agentCommand) (interface{}, error) {
	serverIPsRaw, _ := cmd.Payload["serverIPs"].([]interface{})
	var ips []string
	for _, v := range serverIPsRaw {
		if s, ok := v.(string); ok {
			ips = append(ips, s)
		}
	}

	firewallBackupFile := filepath.Join(configDir, "airgap-firewall-backup.wfw")

	// 1. Export current firewall state
	log.Printf("airgap: exporting current firewall state to %s", firewallBackupFile)
	outB, err := newHiddenCmd("netsh", "advfirewall", "export", firewallBackupFile).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("airgap: export firewall state: %v — %s", err, string(outB))
	}

	// 2. Delete ALL firewall rules
	log.Printf("airgap: deleting all firewall rules")
	for _, dir := range []string{"in", "out"} {
		outB, err = newHiddenCmd("netsh", "advfirewall", "firewall", "delete", "rule", "name=all", "dir="+dir).CombinedOutput()
		if err != nil {
			log.Printf("airgap: delete all %s rules: %v — %s (continuing)", dir, err, string(outB))
		}
	}

	// 3. Set default policy: block all
	log.Printf("airgap: setting default policy to block all")
	outB, err = newHiddenCmd("netsh", "advfirewall", "set", "allprofiles",
		"firewallpolicy", "blockinbound,blockoutbound").CombinedOutput()
	if err != nil {
		restoreFirewall(firewallBackupFile)
		return nil, fmt.Errorf("airgap: set block policy: %v — %s", err, string(outB))
	}

	// 4. Add Allow rules — Obliance server, DNS, DHCP, loopback
	type fwRule struct {
		name string
		args []string
	}

	var rules []fwRule

	// Loopback
	rules = append(rules, fwRule{
		name: "Obliance-Airgap-Loopback-Out",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-Loopback-Out", "dir=out", "action=allow", "remoteip=127.0.0.1"},
	})
	rules = append(rules, fwRule{
		name: "Obliance-Airgap-Loopback-In",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-Loopback-In", "dir=in", "action=allow", "remoteip=127.0.0.1"},
	})

	// DNS (UDP 53)
	rules = append(rules, fwRule{
		name: "Obliance-Airgap-DNS",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-DNS", "dir=out", "action=allow", "protocol=UDP", "remoteport=53"},
	})

	// DHCP (UDP 67/68)
	rules = append(rules, fwRule{
		name: "Obliance-Airgap-DHCP-Out",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-DHCP-Out", "dir=out", "action=allow", "protocol=UDP", "localport=68", "remoteport=67"},
	})
	rules = append(rules, fwRule{
		name: "Obliance-Airgap-DHCP-In",
		args: []string{"advfirewall", "firewall", "add", "rule",
			"name=Obliance-Airgap-DHCP-In", "dir=in", "action=allow", "protocol=UDP", "localport=68", "remoteport=67"},
	})

	// Server IPs
	for _, ip := range ips {
		rules = append(rules, fwRule{
			name: "Obliance-Airgap-Allow-" + ip,
			args: []string{"advfirewall", "firewall", "add", "rule",
				"name=Obliance-Airgap-Allow-" + ip, "dir=out", "action=allow", "remoteip=" + ip},
		})
		rules = append(rules, fwRule{
			name: "Obliance-Airgap-Allow-" + ip + "-In",
			args: []string{"advfirewall", "firewall", "add", "rule",
				"name=Obliance-Airgap-Allow-" + ip + "-In", "dir=in", "action=allow", "remoteip=" + ip},
		})
	}

	for _, r := range rules {
		outB, err := newHiddenCmd("netsh", r.args...).CombinedOutput()
		if err != nil {
			log.Printf("airgap: failed to add rule %s: %v — %s", r.name, err, string(outB))
			restoreFirewall(firewallBackupFile)
			return nil, fmt.Errorf("airgap: failed to add rule %q: %v", r.name, err)
		}
		log.Printf("airgap: added rule %s", r.name)
	}

	// Persist airgap state
	agState := airgapState{
		Enabled:   true,
		ChangedAt: time.Now().UTC().Format(time.RFC3339),
		ChangedBy: "remote",
		ServerIPs: ips,
	}
	stateData, _ := json.MarshalIndent(agState, "", "  ")
	_ = os.WriteFile(airgapFile, stateData, 0644)

	log.Printf("airgap: enabled successfully")
	return map[string]string{"message": "airgap enabled"}, nil
}

// ── disable_airgap ───────────────────────────────────────────────────────────

func handleDisableAirgap() (interface{}, error) {
	firewallBackupFile := filepath.Join(configDir, "airgap-firewall-backup.wfw")
	if err := restoreFirewall(firewallBackupFile); err != nil {
		return nil, fmt.Errorf("disable_airgap: %w", err)
	}

	// Persist airgap state
	agState := airgapState{
		Enabled:   false,
		ChangedAt: time.Now().UTC().Format(time.RFC3339),
		ChangedBy: "remote",
	}
	stateData, _ := json.MarshalIndent(agState, "", "  ")
	_ = os.WriteFile(airgapFile, stateData, 0644)

	log.Printf("airgap: disabled successfully")
	return map[string]string{"message": "airgap disabled"}, nil
}

// restoreFirewall imports the saved firewall state, or resets to Windows
// defaults if no backup is available.
func restoreFirewall(backupFile string) error {
	if _, err := os.Stat(backupFile); err == nil {
		log.Printf("airgap: restoring firewall from backup %s", backupFile)
		outB, err := newHiddenCmd("netsh", "advfirewall", "import", backupFile).CombinedOutput()
		if err != nil {
			log.Printf("airgap: import failed: %v — %s, falling back to reset", err, string(outB))
			outB2, err2 := newHiddenCmd("netsh", "advfirewall", "reset").CombinedOutput()
			if err2 != nil {
				return fmt.Errorf("airgap: both import and reset failed: import=%v reset=%v — %s", err, err2, string(outB2))
			}
			log.Printf("airgap: firewall reset to Windows defaults (backup import failed)")
			return nil
		}
		log.Printf("airgap: firewall restored from backup")
		os.Remove(backupFile)
		return nil
	}

	// No backup — reset to safe defaults
	log.Printf("airgap: no backup found, resetting firewall to Windows defaults")
	outB, err := newHiddenCmd("netsh", "advfirewall", "reset").CombinedOutput()
	if err != nil {
		return fmt.Errorf("airgap: reset firewall: %v — %s", err, string(outB))
	}
	return nil
}

// ── Command polling ──────────────────────────────────────────────────────────

type commandPollResponse struct {
	Commands []agentCommand `json:"commands"`
}

func pollCommands(cfg *Config) {
	req, err := http.NewRequest("GET", cfg.ServerURL+"/api/agent/commands", nil)
	if err != nil {
		return
	}
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)

	resp, err := httpClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var result commandPollResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return
	}

	if len(result.Commands) > 0 {
		log.Printf("[cmd-poll] received %d command(s)", len(result.Commands))
		for _, cmd := range result.Commands {
			handleCommand(cmd)
		}
	}
}

// ── Main loop ────────────────────────────────────────────────────────────────

func mainLoop(cfg *Config) {
	log.Printf("Obliance Legacy Agent v%s starting", cfg.AgentVersion)
	log.Printf("Server: %s", cfg.ServerURL)
	log.Printf("Device UUID: %s", cfg.DeviceUUID)

	// Seed the CPU measurement with a first call (delta-based)
	getCPUPercent()
	time.Sleep(1 * time.Second)

	// Report machine_boot event on startup
	addEvent("machine_boot", nil)

	// Command poller goroutine — polls every 10 seconds
	go func() {
		for {
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("PANIC in command poller: %v", r)
					}
				}()
				pollCommands(cfg)
			}()
			time.Sleep(10 * time.Second)
		}
	}()

	// Main push loop
	for {
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("PANIC in push loop: %v", r)
				}
			}()
			push(cfg)
		}()
		time.Sleep(time.Duration(cfg.CheckIntervalSeconds) * time.Second)
	}
}

// ── Windows service ──────────────────────────────────────────────────────────

type agentSvc struct {
	urlFlag *string
	keyFlag *string
}

func (s *agentSvc) Execute(_ []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	// Redirect log to file in service mode
	logPath := filepath.Join(configDir, "agent-legacy.log")
	if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644); err == nil {
		log.SetOutput(f)
	}

	status <- svc.Status{State: svc.StartPending}

	cfg := setupConfig(*s.urlFlag, *s.keyFlag)

	status <- svc.Status{
		State:   svc.Running,
		Accepts: svc.AcceptStop | svc.AcceptShutdown,
	}

	go mainLoop(cfg)

	for {
		c := <-r
		switch c.Cmd {
		case svc.Stop, svc.Shutdown:
			log.Printf("Obliance Legacy Agent stopping...")
			status <- svc.Status{State: svc.StopPending}
			return false, 0
		case svc.Interrogate:
			status <- c.CurrentStatus
		}
	}
}

// ── Entry point ──────────────────────────────────────────────────────────────

func main() {
	urlFlag := flag.String("url", "", "Server URL (required on first run)")
	keyFlag := flag.String("key", "", "API key (required on first run)")
	flag.Parse()

	// Detect Windows service mode
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Fatalf("Failed to detect service mode: %v", err)
	}
	if isService {
		if err := svc.Run(serviceName, &agentSvc{urlFlag, keyFlag}); err != nil {
			log.Fatalf("Service run failed: %v", err)
		}
		return
	}

	// Interactive mode
	cfg := setupConfig(*urlFlag, *keyFlag)
	mainLoop(cfg)
}
