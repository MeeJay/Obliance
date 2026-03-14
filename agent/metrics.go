package main

import (
	"fmt"
	"log"
	"math"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	gnet "github.com/shirou/gopsutil/v3/net"
)

// ── Metric types ───────────────────────────────────────────────────────────────

type CPUMetrics struct {
	Percent        float64   `json:"percent"`
	Cores          []float64 `json:"cores,omitempty"`
	Model          string    `json:"model,omitempty"`
	FreqMHz        float64   `json:"freqMhz,omitempty"`
	CoreClocksMHz  []float64 `json:"coreClocksMhz,omitempty"` // per-physical-core effective clock (LHM, Windows)
}

type MemMetrics struct {
	TotalMB     uint64  `json:"totalMb"`
	UsedMB      uint64  `json:"usedMb"`
	Percent     float64 `json:"percent"`
	CachedMB    uint64  `json:"cachedMb,omitempty"`
	BuffersMB   uint64  `json:"buffersMb,omitempty"`
	SwapTotalMB uint64  `json:"swapTotalMb,omitempty"`
	SwapUsedMB  uint64  `json:"swapUsedMb,omitempty"`
}

type DiskMetrics struct {
	Mount            string  `json:"mount"`
	TotalGB          float64 `json:"totalGb"`
	UsedGB           float64 `json:"usedGb"`
	Percent          float64 `json:"percent"`
	ReadBytesPerSec  uint64  `json:"readBytesPerSec,omitempty"`
	WriteBytesPerSec uint64  `json:"writeBytesPerSec,omitempty"`
}

type NetworkInterface struct {
	Name           string `json:"name"`
	InBytesPerSec  uint64 `json:"inBytesPerSec"`
	OutBytesPerSec uint64 `json:"outBytesPerSec"`
}

type NetworkMetrics struct {
	InBytesPerSec  uint64             `json:"inBytesPerSec"`
	OutBytesPerSec uint64             `json:"outBytesPerSec"`
	Interfaces     []NetworkInterface `json:"interfaces,omitempty"`
}

type TempSensor struct {
	Label   string  `json:"label"`
	Celsius float64 `json:"celsius"`
}

type EngineMetrics struct {
	Label string  `json:"label"`
	Pct   float64 `json:"pct"`
}

type GPUMetrics struct {
	Model          string          `json:"model"`
	UtilizationPct float64         `json:"utilizationPct"`
	VRAMUsedMB     uint64          `json:"vramUsedMb"`
	VRAMTotalMB    uint64          `json:"vramTotalMb"`
	TempCelsius    float64         `json:"tempCelsius,omitempty"`
	Engines        []EngineMetrics `json:"engines,omitempty"` // per-engine utilization (3D, Copy, Encode, Decode)
}

type Metrics struct {
	CPU     *CPUMetrics     `json:"cpu,omitempty"`
	Memory  *MemMetrics     `json:"memory,omitempty"`
	Disks   []DiskMetrics   `json:"disks,omitempty"`
	Network *NetworkMetrics `json:"network,omitempty"`
	LoadAvg float64         `json:"loadAvg,omitempty"`
	Temps   []TempSensor    `json:"temps,omitempty"`
	GPUs    []GPUMetrics    `json:"gpus,omitempty"`
}

type OSInfo struct {
	Platform string `json:"platform"`
	Distro   string `json:"distro,omitempty"`
	Release  string `json:"release"`
	Arch     string `json:"arch"`
}

// ── Delta tracking ─────────────────────────────────────────────────────────────

var (
	netMu       sync.Mutex
	prevNetIn   map[string]uint64
	prevNetOut  map[string]uint64
	prevNetTime time.Time

	diskMu        sync.Mutex
	prevDiskRead  map[string]uint64
	prevDiskWrite map[string]uint64
	prevDiskTime  time.Time
)

// ── CPU info cache (model + base freq collected once) ──────────────────────────

var (
	cpuOnce    sync.Once
	cpuModel   string
	cpuFreqMHz float64
)

func initCPUInfo() {
	cpuOnce.Do(func() {
		infos, err := cpu.Info()
		if err == nil && len(infos) > 0 {
			cpuModel = infos[0].ModelName
			cpuFreqMHz = infos[0].Mhz
		}
	})
}

// ── Virtual interface filter ────────────────────────────────────────────────────

func isVirtualIface(name string) bool {
	// Exact matches
	if name == "lo" {
		return true
	}
	// Prefix-based filter — covers Linux + Windows + macOS virtual/internal interfaces
	for _, pfx := range []string{
		// Linux
		"lo", "docker", "veth", "br-", "virbr", "vbox", "vmnet", "tap", "tun", "dummy",
		// macOS — Apple Silicon internal / system interfaces
		"anpi",   // Apple NS PCI (internal, no user traffic)
		"gif",    // IPv6-in-IPv4 tunnel
		"stf",    // 6to4 tunnel
		"ap",     // SoftAP / access point mode
		"awdl",   // Apple Wireless Direct Link (AirDrop)
		"llw",    // Low Latency WLAN
		"pktap",  // Packet tap (Wireshark hook)
		"utun",   // VPN/tunnel (WireGuard, OpenVPN, iCloud Private Relay…)
		"bridge", // Software bridge
	} {
		if strings.HasPrefix(name, pfx) {
			return true
		}
	}
	return false
}

// ── GPU collection ─────────────────────────────────────────────────────────────

// collectGPUs tries all known GPU back-ends and returns the first successful result.
func collectGPUs() []GPUMetrics {
	// 1. NVIDIA via nvidia-smi (cross-platform)
	if gpus := collectNvidiaGPUs(); len(gpus) > 0 {
		return gpus
	}
	// 2. AMD on Linux via rocm-smi
	if runtime.GOOS == "linux" {
		if gpus := collectAMDLinuxGPUs(); len(gpus) > 0 {
			return gpus
		}
	}
	// 3. Any GPU on Windows via WMI + PDH counters (covers AMD, Intel, and NVIDIA fallback)
	if runtime.GOOS == "windows" {
		if gpus := collectWindowsGPUs(); len(gpus) > 0 {
			return gpus
		}
	}
	// 4. Apple Silicon (M-series) integrated GPU via ioreg
	if runtime.GOOS == "darwin" {
		if gpus := collectAppleGPU(); len(gpus) > 0 {
			return gpus
		}
	}
	return nil
}

// collectAppleGPU detects Apple Silicon (M-series) and Intel-Mac GPUs.
// Utilization is read from the AGXAccelerator ioreg entry (no sudo required).
// VRAM is reported as unified memory (Apple Silicon has no dedicated VRAM).
func collectAppleGPU() []GPUMetrics {
	// Identify chip via sysctl (fast, no subprocess on many macOS versions)
	chipOut, err := exec.Command("sysctl", "-n", "machdep.cpu.brand_string").Output()
	if err != nil {
		return nil
	}
	chip := strings.TrimSpace(string(chipOut))

	// Apple Silicon chips all start with "Apple" (M1, M2, M3, M4 families)
	if !strings.HasPrefix(chip, "Apple") {
		// Intel Mac: discrete NVIDIA/AMD paths already handled above
		return nil
	}

	gpuModel := chip + " GPU"

	// Unified memory: Apple Silicon shares RAM with the GPU
	totalMB, usedMB := uint64(0), uint64(0)
	if vmStat, err := mem.VirtualMemory(); err == nil && vmStat.Total > 0 {
		totalMB = vmStat.Total / 1048576
		usedMB = vmStat.Used / 1048576
	}

	// GPU utilization from ioreg AGXAccelerator (no sudo, returns ~0 when idle)
	util := appleGPUUtilization()

	gpu := GPUMetrics{
		Model:          gpuModel,
		UtilizationPct: util,
		VRAMUsedMB:     usedMB,
		VRAMTotalMB:    totalMB,
	}
	return []GPUMetrics{gpu}
}

// appleGPUUtilization reads "Device Utilization %" from the AGXAccelerator
// ioreg entry. This works without root on macOS 12+ for Apple Silicon.
func appleGPUUtilization() float64 {
	out, err := exec.Command("ioreg", "-r", "-c", "AGXAccelerator", "-w", "0").Output()
	if err != nil {
		return 0
	}
	raw := string(out)

	// The entry looks like:
	//   "PerformanceStatistics" = {"Device Utilization %"=3,"Renderer Utilization %"=2,...}
	const key = `"Device Utilization %"`
	idx := strings.Index(raw, key)
	if idx < 0 {
		return 0
	}
	// After the key comes: ="  or  = <value>
	rest := strings.TrimSpace(raw[idx+len(key):])
	if !strings.HasPrefix(rest, "=") {
		return 0
	}
	rest = strings.TrimSpace(rest[1:])
	// Value ends at "," or "}" or whitespace
	end := strings.IndexAny(rest, ",}\n\r")
	if end < 0 {
		end = len(rest)
	}
	valStr := strings.TrimSpace(rest[:end])
	if v, err := strconv.ParseFloat(valStr, 64); err == nil {
		return math.Round(v*10) / 10
	}
	return 0
}

// collectNvidiaGPUs queries nvidia-smi, trying several install paths on Windows.
func collectNvidiaGPUs() []GPUMetrics {
	paths := []string{"nvidia-smi"}
	if runtime.GOOS == "windows" {
		paths = append(paths,
			`C:\Windows\System32\nvidia-smi.exe`,
			`C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe`,
		)
	}
	for _, p := range paths {
		out, err := exec.Command(p,
			"--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,utilization.encoder,utilization.decoder",
			"--format=csv,noheader,nounits",
		).Output()
		if err != nil {
			continue
		}
		if gpus := parseNvidiaSMI(strings.TrimSpace(string(out))); len(gpus) > 0 {
			return gpus
		}
	}
	return nil
}

func parseNvidiaSMI(raw string) []GPUMetrics {
	var gpus []GPUMetrics
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ", ")
		if len(parts) < 4 {
			continue
		}
		util, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		memUsed, _ := strconv.ParseUint(strings.TrimSpace(parts[2]), 10, 64)
		memTotal, _ := strconv.ParseUint(strings.TrimSpace(parts[3]), 10, 64)
		g := GPUMetrics{
			Model:          strings.TrimSpace(parts[0]),
			UtilizationPct: math.Round(util*10) / 10,
			VRAMUsedMB:     memUsed,
			VRAMTotalMB:    memTotal,
		}
		if len(parts) >= 5 {
			if t, err := strconv.ParseFloat(strings.TrimSpace(parts[4]), 64); err == nil && t > 0 {
				g.TempCelsius = t
			}
		}
		// Engine utilization: encoder (parts[5]) and decoder (parts[6])
		// nvidia-smi returns "N/A" when unsupported — ParseFloat returns 0 in that case.
		var encodePct, decodePct float64
		if len(parts) >= 6 {
			encodePct, _ = strconv.ParseFloat(strings.TrimSpace(parts[5]), 64)
		}
		if len(parts) >= 7 {
			decodePct, _ = strconv.ParseFloat(strings.TrimSpace(parts[6]), 64)
		}
		g.Engines = []EngineMetrics{
			{Label: "3D", Pct: math.Round(util*10) / 10},
			{Label: "Encode", Pct: math.Round(encodePct*10) / 10},
			{Label: "Decode", Pct: math.Round(decodePct*10) / 10},
		}
		gpus = append(gpus, g)
	}
	return gpus
}

// collectAMDLinuxGPUs queries rocm-smi (AMD ROCm driver, Linux only).
func collectAMDLinuxGPUs() []GPUMetrics {
	out, err := exec.Command("rocm-smi",
		"--showuse", "--showmeminfo", "vram", "--showtemp", "--csv",
	).Output()
	if err != nil {
		return nil
	}
	return parseRocmSMI(strings.TrimSpace(string(out)))
}

func parseRocmSMI(raw string) []GPUMetrics {
	// Expected CSV:
	// GPU,GPU use (%),VRAM Total Memory (B),VRAM Total Used Memory (B),Temperature (Sensor edge) (°C)
	lines := strings.Split(raw, "\n")
	if len(lines) < 2 {
		return nil
	}
	var gpus []GPUMetrics
	for _, line := range lines[1:] {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) < 4 {
			continue
		}
		util, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		vramTotalB, _ := strconv.ParseUint(strings.TrimSpace(parts[2]), 10, 64)
		vramUsedB, _ := strconv.ParseUint(strings.TrimSpace(parts[3]), 10, 64)
		g := GPUMetrics{
			Model:          "AMD GPU (" + strings.TrimSpace(parts[0]) + ")",
			UtilizationPct: math.Round(util*10) / 10,
			VRAMTotalMB:    vramTotalB / 1048576,
			VRAMUsedMB:     vramUsedB / 1048576,
		}
		if len(parts) >= 5 {
			if t, err := strconv.ParseFloat(strings.TrimSpace(parts[4]), 64); err == nil && t > 0 {
				g.TempCelsius = t
			}
		}
		gpus = append(gpus, g)
	}
	return gpus
}

// collectWindowsGPUs uses PowerShell to query WMI (name) + PDH counters
// (utilization, VRAM, temperature) — works for AMD, Intel, and any WDDM 2.x GPU on Windows 10+.
func collectWindowsGPUs() []GPUMetrics {
	// PDH counter '\GPU Engine(*engtype_3D*)\Utilization Percentage' sums 3D load.
	// PDH counter '\GPU Local Adapter Memory(*)\Local Usage/Budget' gives VRAM.
	// PDH counter '\GPU Thermal Zone(*)\Temperature' gives temperature (WDDM 2.7+, Windows 10 2004+).
	//   Works for all vendors (NVIDIA, AMD, Intel) without any external software.
	// WMI Win32_VideoController gives name; AdapterRAM is capped at 4GB by WMI
	// so we prefer the PDH Local Budget value for total VRAM.
	const script = `$ErrorActionPreference='SilentlyContinue'
$util=try{[math]::Round(((Get-Counter '\GPU Engine(*engtype_3D*)\Utilization Percentage').CounterSamples|Measure-Object CookedValue -Sum).Sum,1)}catch{0}
$copy=try{[math]::Round(((Get-Counter '\GPU Engine(*engtype_Copy*)\Utilization Percentage').CounterSamples|Measure-Object CookedValue -Sum).Sum,1)}catch{0}
$venc=try{[math]::Round(((Get-Counter '\GPU Engine(*engtype_VideoEncode*)\Utilization Percentage').CounterSamples|Measure-Object CookedValue -Sum).Sum,1)}catch{0}
$vdec=try{[math]::Round(((Get-Counter '\GPU Engine(*engtype_VideoDecode*)\Utilization Percentage').CounterSamples|Measure-Object CookedValue -Sum).Sum,1)}catch{0}
$vramUsedMB=try{[math]::Round(((Get-Counter '\GPU Local Adapter Memory(*)\Local Usage').CounterSamples|Measure-Object CookedValue -Sum).Sum/1MB,0)}catch{0}
$vramTotalMB=try{[math]::Round(((Get-Counter '\GPU Local Adapter Memory(*)\Local Budget').CounterSamples|Measure-Object CookedValue -Sum).Sum/1MB,0)}catch{0}
$tempRaw=try{((Get-Counter '\GPU Thermal Zone(*)\Temperature').CounterSamples|Where-Object{$_.CookedValue -gt 0}|Measure-Object CookedValue -Maximum).Maximum}catch{0}
$gpus=Get-WmiObject Win32_VideoController|Where-Object{$_.PNPDeviceID -match '^PCI'}
foreach($g in $gpus){$vt=if($vramTotalMB -gt 0){$vramTotalMB}else{[math]::Round($g.AdapterRAM/1MB,0)};Write-Output "$($g.Caption)|$util|$vramUsedMB|$vt|$tempRaw|$copy|$venc|$vdec"}`

	out, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-Command", script,
	).Output()
	if err != nil {
		return nil
	}
	var gpus []GPUMetrics
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) < 4 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		if name == "" {
			continue
		}
		util, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		vramUsed, _ := strconv.ParseUint(strings.TrimSpace(parts[2]), 10, 64)
		vramTotal, _ := strconv.ParseUint(strings.TrimSpace(parts[3]), 10, 64)
		gpu := GPUMetrics{
			Model:          name,
			UtilizationPct: math.Round(util*10) / 10,
			VRAMUsedMB:     vramUsed,
			VRAMTotalMB:    vramTotal,
		}
		// GPU Thermal Zone temperature (Windows 10 2004+, WDDM 2.7+).
		// The PDH cooked value scale varies by driver:
		//   > 1000 → decikelvin (e.g. 3330 → ~60°C)
		//   > 200  → Kelvin     (e.g. 333  → ~60°C)
		//   else   → Celsius directly
		if len(parts) >= 5 {
			if raw, err := strconv.ParseFloat(strings.TrimSpace(parts[4]), 64); err == nil && raw > 0 {
				celsius := raw
				switch {
				case raw > 1000:
					celsius = raw/10 - 273.15
				case raw > 200:
					celsius = raw - 273.15
				}
				if celsius > 0 && celsius < 150 {
					gpu.TempCelsius = math.Round(celsius*10) / 10
				}
			}
		}
		// Per-engine utilization: 3D, Copy, VideoEncode, VideoDecode (parts[5-7]).
		var copyPct, vencPct, vdecPct float64
		if len(parts) >= 6 {
			copyPct, _ = strconv.ParseFloat(strings.TrimSpace(parts[5]), 64)
		}
		if len(parts) >= 7 {
			vencPct, _ = strconv.ParseFloat(strings.TrimSpace(parts[6]), 64)
		}
		if len(parts) >= 8 {
			vdecPct, _ = strconv.ParseFloat(strings.TrimSpace(parts[7]), 64)
		}
		gpu.Engines = []EngineMetrics{
			{Label: "3D", Pct: math.Round(util*10) / 10},
			{Label: "Copy", Pct: math.Round(copyPct*10) / 10},
			{Label: "Encode", Pct: math.Round(vencPct*10) / 10},
			{Label: "Decode", Pct: math.Round(vdecPct*10) / 10},
		}
		gpus = append(gpus, gpu)
	}
	return gpus
}

// getCPUPercentDarwin returns overall CPU usage % on macOS by parsing `top -l 2 -n 0`.
// Used as a fallback when gopsutil cpu.Percent fails (requires CGO on darwin/arm64,
// but the agent is cross-compiled with CGO_ENABLED=0).
func getCPUPercentDarwin() (float64, bool) {
	out, err := exec.Command("top", "-l", "2", "-n", "0").Output()
	if err != nil {
		return 0, false
	}
	// top -l 2 outputs two report blocks separated by a blank line.
	// The SECOND "CPU usage:" line reflects delta since the first sample
	// (i.e. recent CPU activity), which is what we want.
	// Format: "CPU usage: 4.74% user, 6.87% sys, 88.39% idle"
	count := 0
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, "CPU usage:") {
			continue
		}
		count++
		if count < 2 {
			continue
		}
		idleIdx := strings.Index(line, "% idle")
		if idleIdx < 0 {
			return 0, false
		}
		numStr := ""
		for i := idleIdx - 1; i >= 0; i-- {
			c := line[i]
			if (c >= '0' && c <= '9') || c == '.' {
				numStr = string(c) + numStr
			} else {
				break
			}
		}
		idle, err := strconv.ParseFloat(numStr, 64)
		if err != nil {
			return 0, false
		}
		return math.Round((100-idle)*10) / 10, true
	}
	return 0, false
}

// ── Collect ────────────────────────────────────────────────────────────────────

func collectMetrics() Metrics {
	var m Metrics
	initCPUInfo()

	// ── CPU: overall % from per-core measurements ──────────────────────────────
	corePcts, err := cpu.Percent(500*time.Millisecond, true)
	if err == nil && len(corePcts) > 0 {
		total := 0.0
		for _, p := range corePcts {
			total += p
		}
		avg := math.Round(total/float64(len(corePcts))*10) / 10
		rounded := make([]float64, len(corePcts))
		for i, p := range corePcts {
			rounded[i] = math.Round(p*10) / 10
		}
		m.CPU = &CPUMetrics{
			Percent: avg,
			Cores:   rounded,
			Model:   cpuModel,
			FreqMHz: cpuFreqMHz,
		}
	} else if runtime.GOOS == "darwin" {
		// Fallback for darwin/arm64 cross-compiled with CGO_ENABLED=0:
		// gopsutil needs CGO to call host_processor_info (Mach) — use `top` instead.
		// Per-core data is not available without CGO; Cores is left nil so the UI
		// shows only the overall gauge rather than fake identical bars.
		if pct, ok := getCPUPercentDarwin(); ok {
			m.CPU = &CPUMetrics{
				Percent: pct,
				Model:   cpuModel,
				FreqMHz: cpuFreqMHz,
			}
		}
	}

	// ── Load average (Linux/macOS only; returns error on Windows) ─────────────
	if runtime.GOOS != "windows" {
		loadStat, err := load.Avg()
		if err == nil {
			m.LoadAvg = math.Round(loadStat.Load1*100) / 100
		}
	}

	// ── Memory + swap + breakdown ──────────────────────────────────────────────
	vmStat, err := mem.VirtualMemory()
	if err == nil && vmStat.Total > 0 {
		mm := &MemMetrics{
			TotalMB: vmStat.Total / 1048576,
			UsedMB:  vmStat.Used / 1048576,
			Percent: math.Round(vmStat.UsedPercent*10) / 10,
		}
		if vmStat.Cached > 0 {
			mm.CachedMB = vmStat.Cached / 1048576
		}
		if vmStat.Buffers > 0 {
			mm.BuffersMB = vmStat.Buffers / 1048576
		}
		m.Memory = mm
	}
	swapStat, err := mem.SwapMemory()
	if err == nil && swapStat.Total > 0 && m.Memory != nil {
		m.Memory.SwapTotalMB = swapStat.Total / 1048576
		m.Memory.SwapUsedMB = swapStat.Used / 1048576
	}

	// ── Disks + I/O speeds ─────────────────────────────────────────────────────
	partitions, err := disk.Partitions(false)
	if err == nil {
		now := time.Now()
		ioCounters, _ := disk.IOCounters()

		diskMu.Lock()
		elapsed := now.Sub(prevDiskTime).Seconds()
		if prevDiskRead == nil {
			prevDiskRead = make(map[string]uint64)
			prevDiskWrite = make(map[string]uint64)
		}

		for _, p := range partitions {
			if runtime.GOOS == "linux" {
				fs := p.Fstype
				if strings.HasPrefix(fs, "tmp") || fs == "devtmpfs" ||
					fs == "proc" || fs == "sysfs" || fs == "cgroup" ||
					fs == "overlay" || strings.HasPrefix(p.Mountpoint, "/dev") ||
					strings.HasPrefix(p.Mountpoint, "/proc") ||
					strings.HasPrefix(p.Mountpoint, "/sys") {
					continue
				}
			}
			if runtime.GOOS == "darwin" {
				fs := p.Fstype
				mp := p.Mountpoint
				// Skip virtual/system filesystems
				if fs == "devfs" || fs == "autofs" || fs == "nullfs" ||
					strings.HasPrefix(fs, "map ") {
					continue
				}
				// On APFS, skip all system-internal volumes except Data
				// (user data lives at /System/Volumes/Data or just /)
				if strings.HasPrefix(mp, "/System/Volumes/") && mp != "/System/Volumes/Data" {
					continue
				}
				// Skip macOS private temp folders
				if strings.HasPrefix(mp, "/private/var/folders/") {
					continue
				}
			}
			usage, err := disk.Usage(p.Mountpoint)
			if err != nil || usage.Total == 0 {
				continue
			}
			dm := DiskMetrics{
				Mount:   p.Mountpoint,
				TotalGB: math.Round(float64(usage.Total)/1073741824*10) / 10,
				UsedGB:  math.Round(float64(usage.Used)/1073741824*10) / 10,
				Percent: math.Round(usage.UsedPercent*10) / 10,
			}

			// Resolve device key for IOCounters map
			dev := p.Device
			if runtime.GOOS == "linux" {
				parts := strings.Split(dev, "/")
				dev = parts[len(parts)-1]
				// Try base device (sda1 -> sda)
				if ioCounters != nil {
					trimmed := strings.TrimRight(dev, "0123456789")
					if trimmed != dev {
						if _, ok := ioCounters[trimmed]; ok {
							dev = trimmed
						}
					}
				}
			}
			if ioCounters != nil {
				if io, ok := ioCounters[dev]; ok && elapsed > 0 {
					prevR := prevDiskRead[dev]
					prevW := prevDiskWrite[dev]
					if (prevR > 0 || prevW > 0) && io.ReadBytes >= prevR && io.WriteBytes >= prevW {
						dm.ReadBytesPerSec = uint64(float64(io.ReadBytes-prevR) / elapsed)
						dm.WriteBytesPerSec = uint64(float64(io.WriteBytes-prevW) / elapsed)
					}
					prevDiskRead[dev] = io.ReadBytes
					prevDiskWrite[dev] = io.WriteBytes
				}
			}
			m.Disks = append(m.Disks, dm)
		}
		prevDiskTime = now
		diskMu.Unlock()
	}

	// ── Network per-interface + aggregate ──────────────────────────────────────
	netStats, err := gnet.IOCounters(true)
	if err == nil {
		now := time.Now()
		netMu.Lock()
		if prevNetIn == nil {
			prevNetIn = make(map[string]uint64)
			prevNetOut = make(map[string]uint64)
		}
		elapsed := now.Sub(prevNetTime).Seconds()
		hasElapsed := !prevNetTime.IsZero() && elapsed > 0

		var aggIn, aggOut uint64
		var ifaces []NetworkInterface

		for _, stat := range netStats {
			name := stat.Name
			if isVirtualIface(name) {
				continue
			}
			if hasElapsed {
				prevIn := prevNetIn[name]
				prevOut := prevNetOut[name]
				if stat.BytesRecv >= prevIn && stat.BytesSent >= prevOut {
					inRate := uint64(float64(stat.BytesRecv-prevIn) / elapsed)
					outRate := uint64(float64(stat.BytesSent-prevOut) / elapsed)
					aggIn += inRate
					aggOut += outRate
					ifaces = append(ifaces, NetworkInterface{
						Name:           name,
						InBytesPerSec:  inRate,
						OutBytesPerSec: outRate,
					})
				}
			}
			prevNetIn[name] = stat.BytesRecv
			prevNetOut[name] = stat.BytesSent
		}
		prevNetTime = now
		netMu.Unlock()

		if hasElapsed {
			m.Network = &NetworkMetrics{
				InBytesPerSec:  aggIn,
				OutBytesPerSec: aggOut,
				Interfaces:     ifaces,
			}
		}
	}

	// ── Temperature sensors ────────────────────────────────────────────────────
	seen := make(map[string]bool)

	// 1. gopsutil: lm-sensors on Linux, ACPI thermal zones on Windows/macOS
	sensorTemps, err := host.SensorsTemperatures()
	if err == nil {
		for _, t := range sensorTemps {
			if t.Temperature <= 0 || seen[t.SensorKey] {
				continue
			}
			seen[t.SensorKey] = true
			m.Temps = append(m.Temps, TempSensor{
				Label:   t.SensorKey,
				Celsius: math.Round(t.Temperature*10) / 10,
			})
		}
	}

	// 2. Platform-specific extras: NVMe temps + LHM + ASUS ATK (Windows),
	//    no-op on Linux/macOS where gopsutil already covers hardware sensors.
	//    Side-effect on Windows: collectPlatformTemps → collectLHMByDLL caches
	//    per-core clock speeds in lhmCoreClocksVal for use below.
	for _, t := range collectPlatformTemps() {
		if seen[t.Label] {
			continue
		}
		seen[t.Label] = true
		m.Temps = append(m.Temps, t)
	}

	// Per-core effective clock speeds from LHM (Windows only; stub returns nil).
	if m.CPU != nil {
		if clocks := collectLHMCoreClocks(); len(clocks) > 0 {
			m.CPU.CoreClocksMHz = clocks
		}
	}

	// ── GPU ────────────────────────────────────────────────────────────────────
	m.GPUs = collectGPUs()

	// Add GPU temperatures to the Temps list so they appear alongside other
	// hardware sensors. Works for all vendors (NVIDIA, AMD, Intel) on all
	// platforms — no duplication: the `seen` map above prevents double entries.
	for i, gpu := range m.GPUs {
		if gpu.TempCelsius <= 0 {
			continue
		}
		// Build a snake_case label from the GPU model name.
		name := strings.ToLower(gpu.Model)
		for _, ch := range []string{" ", "/", "\\", "-", ".", "(", ")", ":", ","} {
			name = strings.ReplaceAll(name, ch, "_")
		}
		for strings.Contains(name, "__") {
			name = strings.ReplaceAll(name, "__", "_")
		}
		name = strings.Trim(name, "_")
		label := "gpu_" + name
		if i > 0 {
			label = fmt.Sprintf("gpu_%s_%d", name, i+1)
		}
		if !seen[label] {
			seen[label] = true
			m.Temps = append(m.Temps, TempSensor{
				Label:   label,
				Celsius: math.Round(gpu.TempCelsius*10) / 10,
			})
		}
	}

	return m
}

func getOSInfo() OSInfo {
	info, err := host.Info()
	if err != nil {
		log.Printf("OSInfo error: %v", err)
		return OSInfo{
			Platform: runtime.GOOS,
			Release:  "unknown",
			Arch:     runtime.GOARCH,
		}
	}
	return OSInfo{
		Platform: info.OS,
		Distro:   info.Platform,
		Release:  info.PlatformVersion,
		Arch:     runtime.GOARCH,
	}
}
