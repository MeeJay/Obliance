//go:build windows

package main

import (
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

// lhmCoreClocksMu / lhmCoreClocksVal cache the per-physical-core effective
// clock speeds (in MHz) collected from LHM as a side-effect of the last
// collectLHMByDLL call. collectLHMCoreClocks() returns a copy.
var (
	lhmCoreClocksMu  sync.Mutex
	lhmCoreClocksVal []float64
)

// collectLHMCoreClocks returns the per-core clock speeds collected during the
// most recent collectLHMByDLL invocation.  Returns nil if LHM has not run yet
// or the CPU lacks Clock sensors.
func collectLHMCoreClocks() []float64 {
	lhmCoreClocksMu.Lock()
	defer lhmCoreClocksMu.Unlock()
	if len(lhmCoreClocksVal) == 0 {
		return nil
	}
	cp := make([]float64, len(lhmCoreClocksVal))
	copy(cp, lhmCoreClocksVal)
	return cp
}

// collectPlatformTemps returns Windows-specific temperature sensors that
// gopsutil's host.SensorsTemperatures() misses (ACPI thermal zones only).
//
// Sources probed in order:
//  1. NVMe/SATA drive temperatures via Get-StorageReliabilityCounter
//     (PowerShell Storage module, built into Windows 10/11 — no driver required)
//  2. LibreHardwareMonitor WMI sensors (CPU, MB, drives, fans, voltages)
//     (requires LHM running as a Windows service — see note below)
//  3. ASUS ATK WMI ACPI sensors (CPU temp, MB temp) for older ASUS boards
//     (via AsusAtkWmi_WMNB DSTS — works on pre-AM5 boards; Zen 4/5 returns 0)
//
// GPU temperatures are extracted from the GPU metrics collected by collectGPUs()
// and added to the Temps list automatically in collectMetrics() — covering
// NVIDIA, AMD, and Intel GPUs on all platforms without any duplication.
//
// CPU temperatures on Windows without helper software require a kernel-mode
// driver (WinRing0/WinIo). To get full sensor coverage, install and run
// LibreHardwareMonitor as a Windows service:
//   LibreHardwareMonitor.exe --service
// This registers the root\LibreHardwareMonitor WMI namespace used by source 2.
func collectPlatformTemps() []TempSensor {
	var out []TempSensor
	out = append(out, collectNVMeTemps()...)
	out = append(out, collectLHMTemps()...)
	out = append(out, collectAsusATKTemps()...)
	return out
}

// collectNVMeTemps queries NVMe and SATA drive temperatures via
// Get-StorageReliabilityCounter, part of the Storage PowerShell module
// shipped with Windows 10/11. No driver or external tool required.
func collectNVMeTemps() []TempSensor {
	const script = `$ErrorActionPreference='SilentlyContinue'
$disks = Get-PhysicalDisk
foreach ($d in $disks) {
    try {
        $r = Get-StorageReliabilityCounter -PhysicalDisk $d
        if ($null -ne $r.Temperature -and $r.Temperature -gt 0) {
            Write-Output "$($d.FriendlyName)|$($r.Temperature)"
        }
    } catch {}
}`

	raw, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-Command", script,
	).Output()
	if err != nil || len(raw) == 0 {
		return nil
	}

	var sensors []TempSensor
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		temp, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		if err != nil || temp <= 0 || temp > 120 {
			continue
		}
		label := fmt.Sprintf("drive_%s", sanitizeLabel(name))
		sensors = append(sensors, TempSensor{
			Label:   label,
			Celsius: math.Round(temp*10) / 10,
		})
	}
	return sensors
}

// collectLHMTemps reads all temperature sensors from LibreHardwareMonitor.
//
// Strategy (in order):
//  1. PRIMARY — load the bundled LHM DLLs (extracted to %ProgramData%\Obliance\lhm\
//     on first run) directly via PowerShell .NET reflection.  The WinRing0 kernel
//     driver is embedded inside LibreHardwareMonitorLib.dll and is automatically
//     installed the first time computer.Open() is called.  Requires the agent to
//     run as Administrator / SYSTEM (standard for a Windows service).
//
//  2. FALLBACK — query the root\LibreHardwareMonitor WMI namespace.  This works
//     when LibreHardwareMonitor has been installed separately as a Windows service
//     (LibreHardwareMonitor.exe --service) without any DLL extraction step.
func collectLHMTemps() []TempSensor {
	if dllDir, ok := ensureLHMExtracted(); ok {
		if sensors := collectLHMByDLL(dllDir); len(sensors) > 0 {
			return sensors
		}
	}
	return collectLHMByWMI()
}

// collectLHMByDLL loads LibreHardwareMonitorLib.dll directly via PowerShell
// .NET reflection and queries CPU/motherboard temperature sensors.
// An AssemblyResolve event handler ensures all dependency DLLs in dllDir are
// found without modifying the system PATH or GAC.
func collectLHMByDLL(dllDir string) []TempSensor {
	// Escape single quotes in the path for PowerShell single-quoted strings.
	escapedDir := strings.ReplaceAll(dllDir, "'", "''")

	script := `$ErrorActionPreference='SilentlyContinue'
$d='` + escapedDir + `'
$h=[System.ResolveEventHandler]{
    param($s,$e)
    $n=[System.Reflection.AssemblyName]::new($e.Name).Name
    $p=[System.IO.Path]::Combine($d,"$n.dll")
    if([System.IO.File]::Exists($p)){return[System.Reflection.Assembly]::LoadFrom($p)}
    return $null
}
[System.AppDomain]::CurrentDomain.add_AssemblyResolve($h)
try{
    [System.Reflection.Assembly]::LoadFrom([System.IO.Path]::Combine($d,'LibreHardwareMonitorLib.dll'))|Out-Null
    $svc=Get-Service 'PawnIO' -ErrorAction SilentlyContinue
    if($svc -and $svc.Status -ne 'Running'){Start-Service 'PawnIO' -ErrorAction SilentlyContinue;Start-Sleep -Milliseconds 1000}
    $c=New-Object LibreHardwareMonitor.Hardware.Computer
    $c.IsCpuEnabled=$true;$c.IsMotherboardEnabled=$true
    $c.IsGpuEnabled=$false;$c.IsMemoryEnabled=$false
    $c.IsStorageEnabled=$false;$c.IsNetworkEnabled=$false
    $c.Open()
    $tType=[LibreHardwareMonitor.Hardware.SensorType]::Temperature
    $cType=[LibreHardwareMonitor.Hardware.SensorType]::Clock
    foreach($hw in $c.Hardware){
        $hw.Update()
        foreach($s in $hw.Sensors){
            if($s.SensorType-eq $tType-and $null-ne $s.Value-and $s.Value-gt 0){
                Write-Output "T|$($hw.Name)|$($s.Name)|$($s.Value)"
            }
            if($s.SensorType-eq $cType-and $s.Name-like 'Core #*'-and $null-ne $s.Value-and $s.Value-gt 0){
                Write-Output "C|$($hw.Name)|$($s.Name)|$($s.Value)"
            }
        }
        foreach($sub in $hw.SubHardware){
            $sub.Update()
            foreach($s in $sub.Sensors){
                if($s.SensorType-eq $tType-and $null-ne $s.Value-and $s.Value-gt 0){
                    Write-Output "T|$($hw.Name) ($($sub.Name))|$($s.Name)|$($s.Value)"
                }
                if($s.SensorType-eq $cType-and $s.Name-like 'Core #*'-and $null-ne $s.Value-and $s.Value-gt 0){
                    Write-Output "C|$($hw.Name) ($($sub.Name))|$($s.Name)|$($s.Value)"
                }
            }
        }
    }
    $c.Close()
}catch{}finally{
    [System.AppDomain]::CurrentDomain.remove_AssemblyResolve($h)
}`

	raw, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-Command", script,
	).Output()
	if err != nil || len(raw) == 0 {
		return nil
	}
	sensors, clocks := parseLHMOutputAll(string(raw))
	// Cache per-core clocks so collectLHMCoreClocks() can return them.
	lhmCoreClocksMu.Lock()
	lhmCoreClocksVal = clocks
	lhmCoreClocksMu.Unlock()
	return sensors
}

// collectLHMByWMI queries the root\LibreHardwareMonitor WMI namespace,
// available when LibreHardwareMonitor is running as a Windows service.
func collectLHMByWMI() []TempSensor {
	const script = `$ErrorActionPreference='SilentlyContinue'
$ns='root\LibreHardwareMonitor'
try{
    $hwMap=@{}
    Get-WmiObject -Namespace $ns -Class Hardware -ErrorAction Stop|ForEach-Object{$hwMap[$_.Identifier]=$_.Name}
    Get-WmiObject -Namespace $ns -Class Sensor -ErrorAction Stop|
        Where-Object{$_.SensorType-eq'Temperature'-and $_.Value-gt 0-and $_.Value-lt 150}|
        ForEach-Object{
            $hw=if($hwMap.ContainsKey($_.Parent)){$hwMap[$_.Parent]}else{''}
            Write-Output "$hw|$($_.Name)|$($_.Value)"
        }
}catch{}`

	raw, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-Command", script,
	).Output()
	if err != nil || len(raw) == 0 {
		return nil
	}
	return parseLHMOutput(string(raw))
}

// parseLHMOutputAll parses the tagged output produced by collectLHMByDLL.
// Each line starts with a type prefix:
//   - "T|hw|sensor|celsius"  — temperature sensor
//   - "C|hw|Core #N|mhz"    — per-physical-core effective clock speed
//
// Returns the temperature sensors and an ordered slice of per-core MHz values.
// Core index N maps directly to slice index N; gaps are left as 0.
func parseLHMOutputAll(raw string) ([]TempSensor, []float64) {
	var sensors []TempSensor
	seen := make(map[string]int)
	coreClocks := make(map[int]float64)

	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var prefix, rest string
		switch {
		case strings.HasPrefix(line, "T|"):
			prefix = "T"
			rest = line[2:]
		case strings.HasPrefix(line, "C|"):
			prefix = "C"
			rest = line[2:]
		default:
			// No prefix — treat as temperature line (backward compat).
			prefix = "T"
			rest = line
		}

		parts := strings.SplitN(rest, "|", 3)
		if len(parts) != 3 {
			continue
		}
		hwName := strings.TrimSpace(parts[0])
		sensorName := strings.TrimSpace(parts[1])
		val, err := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
		if err != nil || val <= 0 {
			continue
		}

		switch prefix {
		case "T":
			if val > 150 {
				continue
			}
			var baseLabel string
			if hwName != "" {
				baseLabel = "lhm_" + sanitizeLabel(hwName) + "_" + sanitizeLabel(sensorName)
			} else {
				baseLabel = "lhm_" + sanitizeLabel(sensorName)
			}
			n := seen[baseLabel]
			seen[baseLabel]++
			label := baseLabel
			if n > 0 {
				label = fmt.Sprintf("%s_%d", baseLabel, n+1)
			}
			sensors = append(sensors, TempSensor{
				Label:   label,
				Celsius: math.Round(val*10) / 10,
			})
		case "C":
			// sensorName is "Core #N" — extract the index.
			numStr := strings.TrimPrefix(sensorName, "Core #")
			if idx, err2 := strconv.Atoi(numStr); err2 == nil && idx >= 0 && val < 10000 {
				// Keep the maximum (turbo peak) if we somehow get duplicates.
				if existing, ok := coreClocks[idx]; !ok || val > existing {
					coreClocks[idx] = math.Round(val)
				}
			}
		}
	}

	// Build a dense slice indexed by core number, normalised to start at 0.
	// LHM numbers cores starting from #1 on many AMD/Intel CPUs, which would
	// leave clockSlice[0] = 0 and cause C0 to never display a clock in the UI.
	// We find the minimum index actually present and shift every entry so that
	// the first physical core always maps to slot 0 of the returned slice.
	var clockSlice []float64
	if len(coreClocks) > 0 {
		minIdx := int(^uint(0) >> 1) // max int
		maxIdx := -1
		for idx := range coreClocks {
			if idx < minIdx {
				minIdx = idx
			}
			if idx > maxIdx {
				maxIdx = idx
			}
		}
		clockSlice = make([]float64, maxIdx-minIdx+1)
		for idx, mhz := range coreClocks {
			clockSlice[idx-minIdx] = mhz
		}
	}
	return sensors, clockSlice
}

// parseLHMOutput parses lines of the form "HW Name|Sensor Name|Value"
// produced by both collectLHMByDLL and collectLHMByWMI.
func parseLHMOutput(raw string) []TempSensor {
	var sensors []TempSensor
	seen := make(map[string]int)
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 3)
		if len(parts) != 3 {
			continue
		}
		hwName := strings.TrimSpace(parts[0])
		sensorName := strings.TrimSpace(parts[1])
		temp, err := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
		if err != nil || temp <= 0 || temp > 150 {
			continue
		}
		var baseLabel string
		if hwName != "" {
			baseLabel = "lhm_" + sanitizeLabel(hwName) + "_" + sanitizeLabel(sensorName)
		} else {
			baseLabel = "lhm_" + sanitizeLabel(sensorName)
		}
		n := seen[baseLabel]
		seen[baseLabel]++
		label := baseLabel
		if n > 0 {
			label = fmt.Sprintf("%s_%d", baseLabel, n+1)
		}
		sensors = append(sensors, TempSensor{
			Label:   label,
			Celsius: math.Round(temp*10) / 10,
		})
	}
	return sensors
}

// collectAsusATKTemps reads temperature sensors from the ASUS ATK WMI ACPI
// driver (AsusAtkWmi_WMNB) present on ASUS motherboards.
//
// Uses the DSTS method: device_status format is 0x00010000|(temp*10) when valid,
// or 0 when the sensor ID is not supported by the board.
//
// This works reliably on pre-AM5 ASUS boards. On modern Zen 4/Zen 5 AM5 boards
// the DSTS interface returns 0 for all sensor IDs; use LHM (source 3) instead.
//
// Sensor ID reference: LibreHardwareMonitor AsusWmiIO.cs
func collectAsusATKTemps() []TempSensor {
	const script = `$ErrorActionPreference='SilentlyContinue'
$ns = 'root\wmi'
$ids = @(
    0x00020003, 0x00030003, 0x00040003, 0x00050003,
    0x00060003, 0x00070003, 0x00080003, 0x00090003,
    0x000A0003, 0x000B0003, 0x000C0003, 0x000D0003,
    0x000E0003, 0x000F0003, 0x00100003, 0x00110003,
    0x00120003, 0x00130003, 0x00140003, 0x00150003
)
$nameMap = @{
    0x00020003 = 'cpu_temp'
    0x00030003 = 'mb_temp'
    0x00060003 = 'cpu_temp_2'
    0x00070003 = 'mb_temp_2'
}
try {
    $objs = @(Get-WmiObject -Namespace $ns -Class AsusAtkWmi_WMNB -ErrorAction Stop)
    foreach ($o in $objs) {
        foreach ($id in $ids) {
            try {
                $r = $o.DSTS($id)
                $s = [uint32]$r.device_status
                if (($s -band 0xFFFF0000) -eq 0x00010000) {
                    $tenths = $s -band 0x0000FFFF
                    $c = $tenths / 10.0
                    $n = if ($nameMap.ContainsKey($id)) { $nameMap[$id] } else { 'temp_0x{0:x6}' -f $id }
                    Write-Output "$n|$c"
                }
            } catch {}
        }
    }
} catch {}`

	raw, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-Command", script,
	).Output()
	if err != nil || len(raw) == 0 {
		return nil
	}

	var sensors []TempSensor
	seen := make(map[string]bool)
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		temp, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		if err != nil || temp <= 0 || temp > 150 {
			continue
		}
		label := "asus_" + sanitizeLabel(name)
		if seen[label] {
			continue
		}
		seen[label] = true
		sensors = append(sensors, TempSensor{
			Label:   label,
			Celsius: math.Round(temp*10) / 10,
		})
	}
	return sensors
}

// sanitizeLabel converts a sensor name to a lowercase snake_case label.
func sanitizeLabel(s string) string {
	s = strings.ToLower(s)
	for _, ch := range []string{" ", "/", "\\", "-", ".", "(", ")", ":", ","} {
		s = strings.ReplaceAll(s, ch, "_")
	}
	for strings.Contains(s, "__") {
		s = strings.ReplaceAll(s, "__", "_")
	}
	return strings.Trim(s, "_")
}
