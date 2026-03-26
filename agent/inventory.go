package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ── Inventory data types ───────────────────────────────────────────────────────

type CpuInfo struct {
	Model       string  `json:"model"`
	Cores       int     `json:"cores"`
	Threads     int     `json:"threads"`
	SpeedMHz    float64 `json:"speedMhz,omitempty"`
	Architecture string `json:"architecture,omitempty"`
}

type MemorySlot struct {
	Slot         string `json:"slot,omitempty"`
	SizeMB       uint64 `json:"sizeMb"`
	Type         string `json:"type,omitempty"`
	SpeedMHz     int    `json:"speedMhz,omitempty"`
	Manufacturer string `json:"manufacturer,omitempty"`
}

type MemoryInfo struct {
	TotalMB uint64       `json:"totalMb"`
	Slots   []MemorySlot `json:"slots,omitempty"`
}

type DiskInfo struct {
	Model      string   `json:"model,omitempty"`
	Serial     string   `json:"serial,omitempty"`
	Type       string   `json:"type,omitempty"` // SSD, HDD, NVMe, Unknown
	SizeBytes  int64    `json:"sizeBytes"`
	Partitions []string `json:"partitions,omitempty"`
	Interface  string   `json:"interface,omitempty"` // SATA, NVMe, USB, etc.
}

type NetworkInfo struct {
	Name        string   `json:"name"`
	MACAddress  string   `json:"macAddress,omitempty"`
	Type        string   `json:"type,omitempty"` // Ethernet, WiFi, Virtual
	Addresses   []string `json:"addresses,omitempty"`
	Speed       string   `json:"speed,omitempty"`
}

type GpuInfo struct {
	Model     string `json:"model"`
	VRAM      string `json:"vram,omitempty"`
	DriverVer string `json:"driverVersion,omitempty"`
}

type MotherboardInfo struct {
	Manufacturer string `json:"manufacturer,omitempty"`
	Product      string `json:"product,omitempty"`
	Version      string `json:"version,omitempty"`
	Serial       string `json:"serial,omitempty"`
}

type BiosInfo struct {
	Vendor  string `json:"vendor,omitempty"`
	Version string `json:"version,omitempty"`
	Date    string `json:"date,omitempty"`
}

type BitLockerVolume struct {
	DriveLetter          string   `json:"driveLetter"`
	Status               string   `json:"status"`               // FullyEncrypted, FullyDecrypted, EncryptionInProgress, DecryptionInProgress, etc.
	ProtectionStatus     string   `json:"protectionStatus"`     // On, Off, Unknown
	EncryptionPercentage int      `json:"encryptionPercentage"` // 0-100
	RecoveryKeys         []string `json:"recoveryKeys"`
}

type SoftwareEntry struct {
	Name            string `json:"name"`
	Version         string `json:"version,omitempty"`
	Publisher       string `json:"publisher,omitempty"`
	InstallDate     string `json:"installDate,omitempty"`
	InstallLocation string `json:"installLocation,omitempty"`
	Source          string `json:"source,omitempty"`
	PackageID       string `json:"packageId,omitempty"`
}

type OSDetails struct {
	Edition        string `json:"edition,omitempty"`        // "Windows 11 Pro", "macOS Tahoe", "Debian 12"
	DisplayVersion string `json:"displayVersion,omitempty"` // "25H2", "26.3.1", "12.8"
	BuildNumber    string `json:"buildNumber,omitempty"`    // "26200.8037", "25D2128"
	WindowsKey     string `json:"windowsKey,omitempty"`     // Product key (partial)
	OfficeVersion  string `json:"officeVersion,omitempty"`  // "Microsoft 365 Apps" / "Office 2021"
	OfficeKey      string `json:"officeKey,omitempty"`      // Last 5 chars of product key
}

type BatteryInfo struct {
	Present         bool    `json:"present"`
	DesignCapacity  int     `json:"designCapacity,omitempty"`  // mWh
	FullCapacity    int     `json:"fullCapacity,omitempty"`    // mWh
	CurrentCapacity int     `json:"currentCapacity,omitempty"` // mWh
	HealthPercent   float64 `json:"healthPercent,omitempty"`   // fullCapacity/designCapacity * 100
	CycleCount      int     `json:"cycleCount,omitempty"`
	Status          string  `json:"status,omitempty"` // Charging, Discharging, Full, etc.
}

type InventoryData struct {
	CPU         CpuInfo                `json:"cpu"`
	Memory      MemoryInfo             `json:"memory"`
	Disks       []DiskInfo             `json:"disks"`
	Network     []NetworkInfo          `json:"networkInterfaces"`
	GPU         []GpuInfo              `json:"gpu"`
	Motherboard MotherboardInfo        `json:"motherboard"`
	BIOS        BiosInfo               `json:"bios"`
	OS          OSDetails              `json:"os"`
	Battery     *BatteryInfo           `json:"battery,omitempty"`
	Software    []SoftwareEntry        `json:"software,omitempty"`
	BitLocker   []BitLockerVolume      `json:"bitlocker,omitempty"`
	Raw         map[string]interface{} `json:"raw,omitempty"`
	ScannedAt   time.Time              `json:"scannedAt"`
}

// ── Entry point ───────────────────────────────────────────────────────────────

// ScanInventory collects hardware and software inventory for the current platform.
func ScanInventory() (*InventoryData, error) {
	inv := &InventoryData{
		ScannedAt: time.Now().UTC(),
		Raw:       make(map[string]interface{}),
	}

	var err error
	switch runtime.GOOS {
	case "windows":
		err = scanWindowsInventory(inv)
	case "linux":
		err = scanLinuxInventory(inv)
	case "darwin":
		err = scanDarwinInventory(inv)
	default:
		return nil, fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
	if err != nil {
		// Non-fatal: return what was collected alongside the error.
		log.Printf("Inventory scan partial error: %v", err)
	}

	// Scan installed software (platform-aware).
	inv.Software = scanInstalledSoftware()

	// BitLocker recovery keys (Windows only).
	if runtime.GOOS == "windows" {
		inv.BitLocker = scanBitLocker()
	}

	return inv, nil
}

// PostInventory POSTs the collected inventory to the server.
func PostInventory(inv *InventoryData, cfg *Config) error {
	data, err := json.Marshal(inv)
	if err != nil {
		return fmt.Errorf("marshal inventory: %w", err)
	}

	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/inventory", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build inventory request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("post inventory: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("inventory POST returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ── Windows ───────────────────────────────────────────────────────────────────

func scanWindowsInventory(inv *InventoryData) error {
	// Use a single PowerShell call to collect all WMI data in one round-trip.
	const script = `$ErrorActionPreference='SilentlyContinue'
# CPU
$cpu = Get-WmiObject Win32_Processor | Select-Object -First 1
# Memory
$mem = Get-WmiObject Win32_PhysicalMemory
$os  = Get-WmiObject Win32_OperatingSystem
# Disks
$disks = Get-WmiObject Win32_DiskDrive
# Network
$nics  = Get-WmiObject Win32_NetworkAdapterConfiguration | Where-Object {$_.IPEnabled}
# GPU
$gpus  = Get-WmiObject Win32_VideoController
# Motherboard
$mb    = Get-WmiObject Win32_BaseBoard | Select-Object -First 1
# BIOS
$bios  = Get-WmiObject Win32_BIOS | Select-Object -First 1

$result = @{
  cpu = @{
    model   = $cpu.Name.Trim()
    cores   = [int]$cpu.NumberOfCores
    threads = [int]$cpu.NumberOfLogicalProcessors
    speed   = [int]$cpu.MaxClockSpeed
    arch    = $cpu.AddressWidth
  }
  memTotalMB = [math]::Round($os.TotalVisibleMemorySize / 1KB, 0)
  memSlots = @($mem | ForEach-Object {
    @{
      slot         = $_.DeviceLocator
      sizeMb       = [math]::Round($_.Capacity / 1MB, 0)
      type         = switch([int]$_.MemoryType){ 20{'DDR'} 21{'DDR2'} 24{'DDR3'} 26{'DDR4'} 34{'DDR5'} default{'Unknown'} }
      speedMhz     = [int]$_.Speed
      manufacturer = $_.Manufacturer.Trim()
    }
  })
  disks = @($disks | ForEach-Object {
    @{
      model      = $_.Model.Trim()
      serial     = $_.SerialNumber.Trim()
      sizeBytes  = [long]$_.Size
      mediaType  = $_.MediaType
      iface      = $_.InterfaceType
    }
  })
  nics = @($nics | ForEach-Object {
    @{
      name    = $_.Description.Trim()
      mac     = $_.MACAddress
      addrs   = @($_.IPAddress)
    }
  })
  gpus = @($gpus | Where-Object {$_.PNPDeviceID -match '^PCI'} | ForEach-Object {
    @{
      model      = $_.Caption.Trim()
      vramBytes  = [long]$_.AdapterRAM
      driverVer  = $_.DriverVersion
    }
  })
  mb = @{
    manufacturer = $mb.Manufacturer.Trim()
    product      = $mb.Product.Trim()
    version      = $mb.Version.Trim()
    serial       = $mb.SerialNumber.Trim()
  }
  bios = @{
    vendor  = $bios.Manufacturer.Trim()
    version = $bios.SMBIOSBIOSVersion.Trim()
    date    = $bios.ReleaseDate
  }
}

# OS details
$osEdition = $os.Caption.Trim()
$osBuild = $os.BuildNumber
$osVer = $os.Version
# DisplayVersion from registry (25H2 etc.)
$dispVer = try { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop).DisplayVersion } catch { '' }
# Windows product key (partial — last 5 via SoftwareLicensingProduct)
$winKey = try { (Get-WmiObject -Query "SELECT OA3xOriginalProductKey FROM SoftwareLicensingService" -ErrorAction Stop).OA3xOriginalProductKey } catch { '' }
if (-not $winKey) { $winKey = try { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SoftwareProtectionPlatform' -ErrorAction Stop).BackupProductKeyDefault } catch { '' } }
# Office version + key
$officeVer = ''
$officeKey = ''
$offPaths = @('HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration', 'HKLM:\SOFTWARE\Microsoft\Office\16.0\Common\InstalledPackages')
foreach ($p in $offPaths) {
  if (Test-Path $p) {
    $props = Get-ItemProperty $p -ErrorAction SilentlyContinue
    if ($props.ProductReleaseIds) { $officeVer = $props.ProductReleaseIds; break }
    if ($props.ClientVersionToReport) { $officeVer = "Office " + $props.ClientVersionToReport; break }
  }
}
# Office key last 5 from OSPP
$officeKey = try {
  $ospp = Get-WmiObject -Query "SELECT PartialProductKey,Name FROM SoftwareLicensingProduct WHERE ApplicationId='0ff1ce15-a989-479d-af46-f275c6370663' AND PartialProductKey IS NOT NULL" -ErrorAction Stop | Select-Object -First 1
  if ($ospp) { $ospp.PartialProductKey } else { '' }
} catch { '' }
if ($officeVer -eq '' -and $ospp.Name) { $officeVer = $ospp.Name }

$result['osDetails'] = @{
  edition        = $osEdition
  displayVersion = $dispVer
  buildNumber    = $osVer
  windowsKey     = $winKey
  officeVersion  = $officeVer
  officeKey      = $officeKey
}

# Battery
$bat = Get-WmiObject Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($bat) {
  $design = try { (Get-WmiObject BatteryStaticData -Namespace ROOT\WMI -ErrorAction Stop).DesignedCapacity } catch { 0 }
  $full   = try { (Get-WmiObject BatteryFullChargedCapacity -Namespace ROOT\WMI -ErrorAction Stop).FullChargedCapacity } catch { 0 }
  $cycle  = try { (Get-WmiObject BatteryCycleCount -Namespace ROOT\WMI -ErrorAction Stop).CycleCount } catch { 0 }
  $health = if ($design -gt 0) { [math]::Round($full / $design * 100, 1) } else { 0 }
  $result['battery'] = @{
    present        = $true
    designCapacity = [int]$design
    fullCapacity   = [int]$full
    healthPercent  = $health
    cycleCount     = [int]$cycle
    status         = switch([int]$bat.BatteryStatus){ 1{'Discharging'} 2{'AC Power'} 3{'Full'} 4{'Low'} 5{'Critical'} 6{'Charging'} default{'Unknown'} }
  }
}

$result | ConvertTo-Json -Depth 5 -Compress`

	out, err := runPS(script)
	if err != nil {
		return fmt.Errorf("powershell inventory: %w", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(bytes.TrimSpace(out), &raw); err != nil {
		return fmt.Errorf("parse powershell JSON: %w", err)
	}
	inv.Raw["wmi"] = raw

	// CPU
	if cpuRaw, ok := raw["cpu"].(map[string]interface{}); ok {
		inv.CPU = CpuInfo{
			Model:        stringField(cpuRaw, "model"),
			Cores:        intField(cpuRaw, "cores"),
			Threads:      intField(cpuRaw, "threads"),
			SpeedMHz:     float64(intField(cpuRaw, "speed")),
			Architecture: fmt.Sprintf("%d-bit", intField(cpuRaw, "arch")),
		}
	}

	// Memory
	inv.Memory.TotalMB = uint64(int64Field(raw, "memTotalMB"))
	if slots, ok := raw["memSlots"].([]interface{}); ok {
		for _, s := range slots {
			if m, ok := s.(map[string]interface{}); ok {
				inv.Memory.Slots = append(inv.Memory.Slots, MemorySlot{
					Slot:         stringField(m, "slot"),
					SizeMB:       uint64(int64Field(m, "sizeMb")),
					Type:         stringField(m, "type"),
					SpeedMHz:     intField(m, "speedMhz"),
					Manufacturer: stringField(m, "manufacturer"),
				})
			}
		}
	}

	// Disks
	if diskArr, ok := raw["disks"].([]interface{}); ok {
		for _, d := range diskArr {
			if dm, ok := d.(map[string]interface{}); ok {
				mediaType := strings.ToLower(stringField(dm, "mediaType"))
				iface := stringField(dm, "iface")
				dtype := classifyDisk(mediaType, iface, stringField(dm, "model"))
				inv.Disks = append(inv.Disks, DiskInfo{
					Model:     stringField(dm, "model"),
					Serial:    strings.TrimSpace(stringField(dm, "serial")),
					Type:      dtype,
					SizeBytes: int64Field(dm, "sizeBytes"),
					Interface: iface,
				})
			}
		}
	}

	// Network
	if nicArr, ok := raw["nics"].([]interface{}); ok {
		for _, n := range nicArr {
			if nm, ok := n.(map[string]interface{}); ok {
				var addrs []string
				if a, ok := nm["addrs"].([]interface{}); ok {
					for _, addr := range a {
						if s, ok := addr.(string); ok && s != "" {
							addrs = append(addrs, s)
						}
					}
				}
				inv.Network = append(inv.Network, NetworkInfo{
					Name:       stringField(nm, "name"),
					MACAddress: stringField(nm, "mac"),
					Addresses:  addrs,
				})
			}
		}
	}

	// GPU
	if gpuArr, ok := raw["gpus"].([]interface{}); ok {
		for _, g := range gpuArr {
			if gm, ok := g.(map[string]interface{}); ok {
				vramBytes := int64Field(gm, "vramBytes")
				vram := ""
				if vramBytes > 0 {
					vram = fmt.Sprintf("%d MB", vramBytes/1048576)
				}
				inv.GPU = append(inv.GPU, GpuInfo{
					Model:     stringField(gm, "model"),
					VRAM:      vram,
					DriverVer: stringField(gm, "driverVer"),
				})
			}
		}
	}

	// Motherboard
	if mb, ok := raw["mb"].(map[string]interface{}); ok {
		inv.Motherboard = MotherboardInfo{
			Manufacturer: stringField(mb, "manufacturer"),
			Product:      stringField(mb, "product"),
			Version:      stringField(mb, "version"),
			Serial:       stringField(mb, "serial"),
		}
	}

	// BIOS
	if bios, ok := raw["bios"].(map[string]interface{}); ok {
		inv.BIOS = BiosInfo{
			Vendor:  stringField(bios, "vendor"),
			Version: stringField(bios, "version"),
			Date:    stringField(bios, "date"),
		}
	}

	// OS Details
	if od, ok := raw["osDetails"].(map[string]interface{}); ok {
		inv.OS = OSDetails{
			Edition:        stringField(od, "edition"),
			DisplayVersion: stringField(od, "displayVersion"),
			BuildNumber:    stringField(od, "buildNumber"),
			WindowsKey:     stringField(od, "windowsKey"),
			OfficeVersion:  stringField(od, "officeVersion"),
			OfficeKey:      stringField(od, "officeKey"),
		}
	}

	// Battery
	if bat, ok := raw["battery"].(map[string]interface{}); ok {
		inv.Battery = &BatteryInfo{
			Present:        true,
			DesignCapacity:  intField(bat, "designCapacity"),
			FullCapacity:    intField(bat, "fullCapacity"),
			HealthPercent:   float64Field(bat, "healthPercent"),
			CycleCount:      intField(bat, "cycleCount"),
			Status:          stringField(bat, "status"),
		}
	}

	return nil
}

// ── Linux ─────────────────────────────────────────────────────────────────────

func scanLinuxInventory(inv *InventoryData) error {
	// CPU from /proc/cpuinfo
	if out, err := exec.Command("cat", "/proc/cpuinfo").Output(); err == nil {
		inv.CPU = parseLinuxCPUInfo(string(out))
	}

	// Memory from /proc/meminfo
	if out, err := exec.Command("cat", "/proc/meminfo").Output(); err == nil {
		inv.Memory = parseLinuxMemInfo(string(out))
	}

	// Disks via lsblk JSON
	if out, err := exec.Command("lsblk", "-J", "-o", "NAME,MODEL,SERIAL,TYPE,SIZE,TRAN,MOUNTPOINT").Output(); err == nil {
		inv.Disks = parseLinuxLsblk(out)
	}

	// Network interfaces via ip command
	if out, err := exec.Command("ip", "-j", "addr").Output(); err == nil {
		inv.Network = parseLinuxIPAddr(out)
	}

	// GPU via lspci
	if out, err := exec.Command("lspci").Output(); err == nil {
		inv.GPU = parseLinuxGPU(string(out))
	}

	// Motherboard from DMI
	inv.Motherboard = readLinuxDMI()

	// BIOS from DMI
	inv.BIOS = readLinuxBIOS()

	// OS Details
	inv.OS = collectLinuxOSDetails()

	// Battery
	inv.Battery = collectLinuxBattery()

	return nil
}

func parseLinuxCPUInfo(data string) CpuInfo {
	info := CpuInfo{Architecture: runtime.GOARCH}
	coreSet := make(map[string]bool)
	for _, line := range strings.Split(data, "\n") {
		line = strings.TrimSpace(line)
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		switch key {
		case "model name":
			if info.Model == "" {
				info.Model = val
			}
		case "cpu MHz":
			// Last one wins (varies per core); use first occurrence
			if info.SpeedMHz == 0 {
				var mhz float64
				fmt.Sscanf(val, "%f", &mhz)
				info.SpeedMHz = mhz
			}
		case "processor":
			info.Threads++
		case "core id":
			coreSet[val] = true
		}
	}
	info.Cores = len(coreSet)
	if info.Cores == 0 {
		info.Cores = info.Threads
	}
	return info
}

func parseLinuxMemInfo(data string) MemoryInfo {
	var totalKB uint64
	for _, line := range strings.Split(data, "\n") {
		if strings.HasPrefix(line, "MemTotal:") {
			fmt.Sscanf(strings.TrimPrefix(line, "MemTotal:"), "%d", &totalKB)
			break
		}
	}
	return MemoryInfo{TotalMB: totalKB / 1024}
}

func parseLinuxLsblk(data []byte) []DiskInfo {
	var result struct {
		Blockdevices []struct {
			Name       string `json:"name"`
			Model      string `json:"model"`
			Serial     string `json:"serial"`
			Type       string `json:"type"`
			Size       string `json:"size"`
			Tran       string `json:"tran"`
			Mountpoint string `json:"mountpoint"`
		} `json:"blockdevices"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil
	}
	var disks []DiskInfo
	for _, dev := range result.Blockdevices {
		if dev.Type != "disk" {
			continue
		}
		dtype := classifyDisk("", dev.Tran, dev.Model)
		disks = append(disks, DiskInfo{
			Model:     strings.TrimSpace(dev.Model),
			Serial:    strings.TrimSpace(dev.Serial),
			Type:      dtype,
			Interface: strings.ToUpper(dev.Tran),
		})
	}
	return disks
}

func parseLinuxIPAddr(data []byte) []NetworkInfo {
	var ifaces []struct {
		Ifname    string `json:"ifname"`
		Address   string `json:"address"`
		LinkType  string `json:"link_type"`
		AddrInfos []struct {
			Family string `json:"family"`
			Local  string `json:"local"`
		} `json:"addr_info"`
	}
	if err := json.Unmarshal(data, &ifaces); err != nil {
		return nil
	}
	var result []NetworkInfo
	for _, iface := range ifaces {
		if iface.Ifname == "lo" {
			continue
		}
		var addrs []string
		for _, ai := range iface.AddrInfos {
			if ai.Local != "" {
				addrs = append(addrs, ai.Local)
			}
		}
		result = append(result, NetworkInfo{
			Name:       iface.Ifname,
			MACAddress: iface.Address,
			Addresses:  addrs,
		})
	}
	return result
}

func parseLinuxGPU(lspciOutput string) []GpuInfo {
	var gpus []GpuInfo
	for _, line := range strings.Split(lspciOutput, "\n") {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "vga") || strings.Contains(lower, "3d controller") ||
			strings.Contains(lower, "display controller") {
			// Extract the description after the device class
			idx := strings.Index(line, ": ")
			if idx >= 0 {
				gpus = append(gpus, GpuInfo{Model: strings.TrimSpace(line[idx+2:])})
			}
		}
	}
	return gpus
}

func readLinuxDMI() MotherboardInfo {
	read := func(path string) string {
		out, err := exec.Command("cat", path).Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	}
	return MotherboardInfo{
		Manufacturer: read("/sys/class/dmi/id/board_vendor"),
		Product:      read("/sys/class/dmi/id/board_name"),
		Version:      read("/sys/class/dmi/id/board_version"),
		Serial:       read("/sys/class/dmi/id/board_serial"),
	}
}

func readLinuxBIOS() BiosInfo {
	read := func(path string) string {
		out, err := exec.Command("cat", path).Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	}
	return BiosInfo{
		Vendor:  read("/sys/class/dmi/id/bios_vendor"),
		Version: read("/sys/class/dmi/id/bios_version"),
		Date:    read("/sys/class/dmi/id/bios_date"),
	}
}

func collectLinuxOSDetails() OSDetails {
	od := OSDetails{}
	// /etc/os-release has PRETTY_NAME, VERSION_ID, VERSION
	if out, err := exec.Command("cat", "/etc/os-release").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				continue
			}
			val := strings.Trim(strings.TrimSpace(parts[1]), "\"")
			switch parts[0] {
			case "PRETTY_NAME":
				od.Edition = val
			case "VERSION_ID":
				od.DisplayVersion = val
			case "BUILD_ID":
				od.BuildNumber = val
			}
		}
	}
	if od.BuildNumber == "" {
		if out, err := exec.Command("uname", "-r").Output(); err == nil {
			od.BuildNumber = strings.TrimSpace(string(out))
		}
	}
	return od
}

func collectLinuxBattery() *BatteryInfo {
	// Check /sys/class/power_supply/BAT0 (or BAT1)
	for _, name := range []string{"BAT0", "BAT1", "macsmc-battery"} {
		base := "/sys/class/power_supply/" + name
		if _, err := os.Stat(base); err != nil {
			continue
		}
		read := func(f string) string {
			out, err := os.ReadFile(base + "/" + f)
			if err != nil {
				return ""
			}
			return strings.TrimSpace(string(out))
		}
		readInt := func(f string) int {
			v := read(f)
			n, _ := strconv.Atoi(v)
			return n
		}

		// Energy values in µWh, convert to mWh
		design := readInt("energy_full_design") / 1000
		full := readInt("energy_full") / 1000
		if design == 0 {
			// Some systems use charge_full_design (µAh) instead
			design = readInt("charge_full_design") / 1000
			full = readInt("charge_full") / 1000
		}
		health := 0.0
		if design > 0 {
			health = float64(full) / float64(design) * 100
		}
		return &BatteryInfo{
			Present:        true,
			DesignCapacity: design,
			FullCapacity:   full,
			HealthPercent:  math.Round(health*10) / 10,
			CycleCount:     readInt("cycle_count"),
			Status:         read("status"),
		}
	}
	return nil
}

// ── macOS ─────────────────────────────────────────────────────────────────────

func scanDarwinInventory(inv *InventoryData) error {
	// system_profiler outputs JSON for each data type.
	types := []string{
		"SPHardwareDataType",
		"SPMemoryDataType",
		"SPStorageDataType",
		"SPNetworkDataType",
		"SPDisplaysDataType",
	}

	out, err := exec.Command("system_profiler", append([]string{"-json"}, types...)...).Output()
	if err != nil {
		return fmt.Errorf("system_profiler: %w", err)
	}

	var sp map[string][]map[string]interface{}
	if err := json.Unmarshal(out, &sp); err != nil {
		return fmt.Errorf("parse system_profiler JSON: %w", err)
	}
	inv.Raw["system_profiler"] = sp

	// Hardware (CPU, memory total)
	for _, item := range sp["SPHardwareDataType"] {
		inv.CPU = CpuInfo{
			Model:        stringField(item, "cpu_type"),
			Cores:        intField(item, "number_processors"),
			SpeedMHz:     parseMHzString(stringField(item, "current_processor_speed")),
			Architecture: runtime.GOARCH,
		}
		// Logical processors may be in a separate key
		if tc := intField(item, "packages"); tc > 0 && inv.CPU.Cores == 0 {
			inv.CPU.Cores = tc
		}
		memStr := stringField(item, "physical_memory")
		inv.Memory.TotalMB = parseMemString(memStr)
	}

	// Memory slots
	for _, item := range sp["SPMemoryDataType"] {
		slots, ok := item["_items"].([]interface{})
		if !ok {
			continue
		}
		for _, s := range slots {
			sm, ok := s.(map[string]interface{})
			if !ok {
				continue
			}
			sizeMB := parseMemString(stringField(sm, "dimm_size"))
			inv.Memory.Slots = append(inv.Memory.Slots, MemorySlot{
				Slot:         stringField(sm, "dimm_tag"),
				SizeMB:       sizeMB,
				Type:         stringField(sm, "dimm_type"),
				SpeedMHz:     parseSpeedString(stringField(sm, "dimm_speed")),
				Manufacturer: stringField(sm, "dimm_manufacturer"),
			})
		}
	}

	// Storage
	for _, item := range sp["SPStorageDataType"] {
		sizeStr := stringField(item, "size_in_bytes")
		var sizeBytes int64
		fmt.Sscanf(sizeStr, "%d", &sizeBytes)
		mediaType := stringField(item, "spstorage_is_internal")
		iface := stringField(item, "spstorage_interface_type")
		dtype := classifyDisk("", iface, stringField(item, "disk_name"))
		if mediaType == "" {
			mediaType = iface
		}
		inv.Disks = append(inv.Disks, DiskInfo{
			Model:     stringField(item, "disk_name"),
			SizeBytes: sizeBytes,
			Type:      dtype,
			Interface: iface,
		})
	}

	// Network
	for _, item := range sp["SPNetworkDataType"] {
		name := stringField(item, "interface")
		if name == "" {
			name = stringField(item, "_name")
		}
		mac := ""
		if eth, ok := item["Ethernet"].(map[string]interface{}); ok {
			mac = stringField(eth, "MAC Address")
		}
		var addrs []string
		if ipv4, ok := item["IPv4"].(map[string]interface{}); ok {
			if addr := stringField(ipv4, "Addresses"); addr != "" {
				addrs = append(addrs, addr)
			}
		}
		if ipv6, ok := item["IPv6"].(map[string]interface{}); ok {
			if addr := stringField(ipv6, "Addresses"); addr != "" {
				addrs = append(addrs, addr)
			}
		}
		inv.Network = append(inv.Network, NetworkInfo{
			Name:       name,
			MACAddress: mac,
			Addresses:  addrs,
		})
	}

	// GPU
	for _, item := range sp["SPDisplaysDataType"] {
		inv.GPU = append(inv.GPU, GpuInfo{
			Model: stringField(item, "spdisplays_vendor") + " " + stringField(item, "_name"),
			VRAM:  stringField(item, "spdisplays_vram"),
		})
	}

	// OS Details via sw_vers
	if out, err := exec.Command("sw_vers").Output(); err == nil {
		od := OSDetails{}
		for _, line := range strings.Split(string(out), "\n") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) != 2 {
				continue
			}
			val := strings.TrimSpace(parts[1])
			switch strings.TrimSpace(parts[0]) {
			case "ProductName":
				od.Edition = val
			case "ProductVersion":
				od.DisplayVersion = val
			case "BuildVersion":
				od.BuildNumber = val
			}
		}
		inv.OS = od
	}

	// Battery via system_profiler SPPowerDataType
	if out, err := exec.Command("system_profiler", "-json", "SPPowerDataType").Output(); err == nil {
		var pw map[string][]map[string]interface{}
		if json.Unmarshal(out, &pw) == nil {
			for _, item := range pw["SPPowerDataType"] {
				if bi, ok := item["sppower_battery_health_info"].(map[string]interface{}); ok {
					cycle, _ := strconv.Atoi(fmt.Sprintf("%v", bi["sppower_battery_cycle_count"]))
					maxCap := stringField(bi, "sppower_battery_health_maximum_capacity")
					health := 0.0
					if strings.HasSuffix(maxCap, "%") {
						fmt.Sscanf(maxCap, "%f%%", &health)
					}
					inv.Battery = &BatteryInfo{
						Present:       true,
						CycleCount:    cycle,
						HealthPercent: health,
						Status:        stringField(bi, "sppower_battery_health"),
					}
					break
				}
			}
		}
	}

	return nil
}

// ── Software scanning ─────────────────────────────────────────────────────────

// scanBitLocker retrieves BitLocker status and recovery keys for all volumes.
// Uses manage-bde which requires admin privileges (agent runs as SYSTEM).
func scanBitLocker() []BitLockerVolume {
	// List all BitLocker-capable volumes
	out, err := runPS(`$vols = Get-BitLockerVolume -ErrorAction SilentlyContinue
if (-not $vols) { exit 0 }
$result = @()
foreach ($v in $vols) {
  $keys = @()
  foreach ($p in $v.KeyProtector) {
    if ($p.KeyProtectorType -eq 'RecoveryPassword' -and $p.RecoveryPassword) {
      $keys += $p.RecoveryPassword
    }
  }
  $result += [PSCustomObject]@{
    driveLetter          = $v.MountPoint
    status               = $v.VolumeStatus.ToString()
    protectionStatus     = $v.ProtectionStatus.ToString()
    encryptionPercentage = $v.EncryptionPercentage
    recoveryKeys         = $keys
  }
}
$result | ConvertTo-Json -Compress`)
	if err != nil {
		return nil
	}

	raw := strings.TrimSpace(string(out))
	if raw == "" {
		return nil
	}

	// PowerShell returns a single object (not array) when there's only one volume
	var volumes []BitLockerVolume
	if strings.HasPrefix(raw, "[") {
		json.Unmarshal([]byte(raw), &volumes)
	} else {
		var single BitLockerVolume
		if json.Unmarshal([]byte(raw), &single) == nil {
			volumes = []BitLockerVolume{single}
		}
	}
	return volumes
}

func scanInstalledSoftware() []SoftwareEntry {
	switch runtime.GOOS {
	case "windows":
		return scanWindowsSoftware()
	case "linux":
		return scanLinuxSoftware()
	case "darwin":
		return scanDarwinSoftware()
	}
	return nil
}

func scanWindowsSoftware() []SoftwareEntry {
	const script = `$ErrorActionPreference='SilentlyContinue'
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$apps = Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -ne $null -and $_.DisplayName.Trim() -ne '' } |
  Select-Object DisplayName,DisplayVersion,Publisher,InstallDate,InstallLocation |
  Sort-Object DisplayName -Unique
$apps | ForEach-Object {
  $line = "$($_.DisplayName)|$($_.DisplayVersion)|$($_.Publisher)|$($_.InstallDate)|$($_.InstallLocation)"
  Write-Output $line
}`

	out, err := runPS(script)
	if err != nil {
		log.Printf("Software scan (registry) error: %v", err)
		return nil
	}

	var entries []SoftwareEntry
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 5)
		entry := SoftwareEntry{Source: "registry"}
		if len(parts) >= 1 {
			entry.Name = strings.TrimSpace(parts[0])
		}
		if len(parts) >= 2 {
			entry.Version = strings.TrimSpace(parts[1])
		}
		if len(parts) >= 3 {
			entry.Publisher = strings.TrimSpace(parts[2])
		}
		if len(parts) >= 4 {
			entry.InstallDate = strings.TrimSpace(parts[3])
		}
		if len(parts) >= 5 {
			entry.InstallLocation = strings.TrimSpace(parts[4])
		}
		if entry.Name != "" {
			entries = append(entries, entry)
		}
	}
	return entries
}

func scanLinuxSoftware() []SoftwareEntry {
	var entries []SoftwareEntry

	// dpkg (Debian/Ubuntu)
	if out, err := exec.Command("dpkg-query", "-W", "-f=${Package}|${Version}|${Maintainer}\n").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			parts := strings.SplitN(strings.TrimSpace(line), "|", 3)
			if len(parts) >= 2 && parts[0] != "" {
				entries = append(entries, SoftwareEntry{
					Name:      parts[0],
					Version:   parts[1],
					Publisher: safeGet(parts, 2),
					Source:    "dpkg",
				})
			}
		}
	}

	// rpm (RHEL/CentOS/Fedora)
	if len(entries) == 0 {
		if out, err := exec.Command("rpm", "-qa", "--queryformat", "%{NAME}|%{VERSION}|%{VENDOR}\n").Output(); err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				parts := strings.SplitN(strings.TrimSpace(line), "|", 3)
				if len(parts) >= 2 && parts[0] != "" {
					entries = append(entries, SoftwareEntry{
						Name:      parts[0],
						Version:   parts[1],
						Publisher: safeGet(parts, 2),
						Source:    "rpm",
					})
				}
			}
		}
	}

	// flatpak
	if out, err := exec.Command("flatpak", "list", "--app", "--columns=application,version,origin").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			parts := strings.Fields(line)
			if len(parts) >= 1 {
				e := SoftwareEntry{Source: "flatpak", PackageID: parts[0]}
				if len(parts) >= 2 {
					e.Version = parts[1]
				}
				e.Name = parts[0]
				entries = append(entries, e)
			}
		}
	}

	// snap
	if out, err := exec.Command("snap", "list").Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		for _, line := range lines[1:] { // skip header
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				entries = append(entries, SoftwareEntry{
					Name:    parts[0],
					Version: parts[1],
					Source:  "snap",
				})
			}
		}
	}

	return entries
}

func scanDarwinSoftware() []SoftwareEntry {
	var entries []SoftwareEntry

	// Applications from /Applications
	if out, err := exec.Command("ls", "/Applications").Output(); err == nil {
		for _, app := range strings.Split(string(out), "\n") {
			app = strings.TrimSpace(app)
			if strings.HasSuffix(app, ".app") {
				name := strings.TrimSuffix(app, ".app")
				entries = append(entries, SoftwareEntry{Name: name, Source: "applications"})
			}
		}
	}

	// Homebrew
	if out, err := exec.Command("brew", "list", "--versions").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			parts := strings.Fields(strings.TrimSpace(line))
			if len(parts) >= 2 {
				entries = append(entries, SoftwareEntry{
					Name:      parts[0],
					Version:   parts[len(parts)-1],
					Source:    "homebrew",
					PackageID: parts[0],
				})
			}
		}
	}

	// mas (Mac App Store)
	if out, err := exec.Command("mas", "list").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			// Format: "1234567890 App Name (1.0)"
			spaceIdx := strings.Index(line, " ")
			if spaceIdx < 0 {
				continue
			}
			rest := strings.TrimSpace(line[spaceIdx+1:])
			version := ""
			if parenOpen := strings.LastIndex(rest, "("); parenOpen >= 0 {
				version = strings.Trim(rest[parenOpen:], "()")
				rest = strings.TrimSpace(rest[:parenOpen])
			}
			entries = append(entries, SoftwareEntry{
				Name:      rest,
				Version:   version,
				Source:    "mas",
				PackageID: strings.TrimSpace(line[:spaceIdx]),
			})
		}
	}

	return entries
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func classifyDisk(mediaType, iface, model string) string {
	lower := strings.ToLower(model + " " + mediaType + " " + iface)
	if strings.Contains(lower, "nvme") {
		return "NVMe"
	}
	if strings.Contains(lower, "ssd") || strings.Contains(lower, "solid") {
		return "SSD"
	}
	if strings.Contains(lower, "usb") {
		return "USB"
	}
	if strings.Contains(lower, "hdd") || strings.Contains(lower, "hard disk") || strings.Contains(lower, "sata") {
		return "HDD"
	}
	return "Unknown"
}

func parseMHzString(s string) float64 {
	// "2.4 GHz" → 2400, "1200 MHz" → 1200
	s = strings.TrimSpace(s)
	var val float64
	var unit string
	fmt.Sscanf(s, "%f %s", &val, &unit)
	if strings.ToLower(unit) == "ghz" {
		return val * 1000
	}
	return val
}

func parseMemString(s string) uint64 {
	// "8 GB" → 8192, "512 MB" → 512
	s = strings.TrimSpace(s)
	var val float64
	var unit string
	fmt.Sscanf(s, "%f %s", &val, &unit)
	switch strings.ToUpper(unit) {
	case "GB":
		return uint64(val * 1024)
	case "TB":
		return uint64(val * 1024 * 1024)
	default:
		return uint64(val)
	}
}

func parseSpeedString(s string) int {
	// "2400 MHz" → 2400
	var val int
	fmt.Sscanf(s, "%d", &val)
	return val
}

func stringField(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
		return fmt.Sprintf("%v", v)
	}
	return ""
}

func intField(m map[string]interface{}, key string) int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		}
	}
	return 0
}

func int64Field(m map[string]interface{}, key string) int64 {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return int64(n)
		case int:
			return int64(n)
		case int64:
			return n
		}
	}
	return 0
}

func float64Field(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return n
		case int:
			return float64(n)
		case int64:
			return float64(n)
		}
	}
	return 0
}

func safeGet(parts []string, idx int) string {
	if idx < len(parts) {
		return parts[idx]
	}
	return ""
}
