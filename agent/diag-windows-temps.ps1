# ============================================================
# Obliance Agent - Windows Temperature Diagnostic v3
# Focused on: NVMe temps + ASUS ATK WMI driver
# Run as Administrator for full sensor access.
# ============================================================
# Usage (elevated PowerShell):
#   cd "D:\Sync Folder\Documents\Programmation\BetterKuma"
#   powershell -ExecutionPolicy Bypass -File agent\diag-windows-temps.ps1
# ============================================================

$ErrorActionPreference = 'SilentlyContinue'
$sep = "=" * 60

# -- 1. NVMe / SATA drive temperatures (Get-StorageReliabilityCounter) --------
Write-Host ""
Write-Host $sep
Write-Host "1. NVMe/SATA drive temperatures (Get-StorageReliabilityCounter)"
Write-Host $sep
try {
    $disks = Get-PhysicalDisk
    $found = $false
    foreach ($d in $disks) {
        try {
            $r = Get-StorageReliabilityCounter -PhysicalDisk $d
            $temp = $r.Temperature
            $tempMax = $r.TemperatureMax
            Write-Host ("  {0,-45} Temp={1}C  MaxTemp={2}C" -f $d.FriendlyName, $temp, $tempMax)
            $found = $true
        } catch {
            Write-Host ("  {0,-45} (query failed)" -f $d.FriendlyName)
        }
    }
    if (-not $found) { Write-Host "  (no physical disks found)" }
} catch {
    Write-Host "  ERROR: $_"
}

# -- 2. ALL classes in root\wmi (unfiltered, to find ATK) --------------------
Write-Host ""
Write-Host $sep
Write-Host "2. ALL classes in root\wmi (looking for ASUS ATK)"
Write-Host $sep
try {
    $classes = Get-WmiObject -Namespace "root\wmi" -Class "__CLASS" -List |
               Select-Object -ExpandProperty Name |
               Where-Object { $_ -notmatch "^__" } |
               Sort-Object
    Write-Host "  Total classes: $($classes.Count)"
    Write-Host "  ATK/ASUS related:"
    $atkClasses = $classes | Where-Object { $_ -match "ATK|ASUS|Acpi|Sensor|Hardware|Monitor|Temp|Fan" }
    if ($atkClasses) {
        $atkClasses | ForEach-Object { Write-Host "    $_" }
    } else {
        Write-Host "    (none matching ATK|ASUS|Acpi|Sensor|Hardware|Monitor|Temp|Fan)"
    }
    Write-Host "  All classes:"
    $classes | ForEach-Object { Write-Host "    $_" }
} catch {
    Write-Host "  ERROR: $_"
}

# -- 3. ASUS ATK driver WMI method probe (RSGA sensor read) ------------------
Write-Host ""
Write-Host $sep
Write-Host "3. ASUS ATK WMI sensor method probe (AsusWmiAcpi.sys)"
Write-Host "   Driver ATKWMIACPIIO is Running - probing known interfaces"
Write-Host $sep

# The ASUS ATK ACPI WMI uses a well-known GUID
# WMI GUID: 466747A0-07B2-11DE-8A39-0800200C9A66 (sensor read)
# Method: RSGA (Read Sensor data Global Array) or RSSS
$atkScript = `
$ErrorActionPreference='SilentlyContinue'

# Try direct WMI class access for known ASUS ATK class names
$candidates = @(
    'ATKWMIACPIIO',
    'AsusWmiAcpi',
    'AsusThermal',
    'WMIPort',
    'AsusAcpi',
    'BMI',
    'WBMI',
    'ASUS_HDD',
    'ASUS_BATTERY'
)

foreach ($cls in $candidates) {
    try {
        $obj = Get-WmiObject -Namespace 'root\wmi' -Class $cls -ErrorAction Stop
        Write-Host "FOUND: $cls"
        $obj | Format-List | Out-String | Write-Host
    } catch {}
}

# Also try via ManagementClass to get method definitions
foreach ($cls in $candidates) {
    try {
        $mc = [System.Management.ManagementClass]::new('root\wmi', $cls, $null)
        $methods = $mc.Methods | Select-Object -ExpandProperty Name
        if ($methods) {
            Write-Host "CLASS $cls HAS METHODS: $($methods -join ', ')"
        }
    } catch {}
}
`
try {
    $result = powershell.exe -NoProfile -NonInteractive -Command $atkScript
    if ($result) {
        $result | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  (no ASUS ATK classes found via direct probe)"
    }
} catch {
    Write-Host "  ERROR: $_"
}

# Alternative: use .NET ManagementObjectSearcher directly in PowerShell
Write-Host ""
Write-Host "  Trying .NET ManagementObjectSearcher for ATKWMIACPIIO..."
try {
    $searcher = New-Object System.Management.ManagementObjectSearcher(
        "root\wmi", "SELECT * FROM ATKWMIACPIIO"
    )
    $results = $searcher.Get()
    if ($results.Count -gt 0) {
        Write-Host "  ATKWMIACPIIO instances found: $($results.Count)"
        foreach ($r in $results) {
            $r.Properties | ForEach-Object {
                Write-Host "    $($_.Name) = $($_.Value)"
            }
        }
    } else {
        Write-Host "  (no ATKWMIACPIIO instances)"
    }
} catch {
    Write-Host "  (ATKWMIACPIIO query failed: $_)"
}

# -- 4. Enumerate ALL root\wmi instances briefly -----------------------------
Write-Host ""
Write-Host $sep
Write-Host "4. Sampling root\wmi instances (first 5 classes with instances)"
Write-Host $sep
try {
    $classes = Get-WmiObject -Namespace "root\wmi" -Class "__CLASS" -List |
               Select-Object -ExpandProperty Name |
               Where-Object { $_ -notmatch "^__" } |
               Sort-Object
    $count = 0
    foreach ($cls in $classes) {
        if ($count -ge 10) { break }
        try {
            $objs = Get-WmiObject -Namespace "root\wmi" -Class $cls -ErrorAction Stop
            if ($objs) {
                Write-Host "  [$cls] - $(@($objs).Count) instance(s)"
                $objs | Select-Object -First 1 | ForEach-Object {
                    $_.PSObject.Properties |
                        Where-Object { $_.MemberType -ne 'ScriptMethod' -and $null -ne $_.Value } |
                        Select-Object -First 8 |
                        ForEach-Object { Write-Host "      $($_.Name) = $($_.Value)" }
                }
                $count++
            }
        } catch {}
    }
    if ($count -eq 0) { Write-Host "  (no instantiable classes found)" }
} catch {
    Write-Host "  ERROR: $_"
}

# -- 5. ASUS Optimization WMI (from ASUS system tray if installed) -----------
Write-Host ""
Write-Host $sep
Write-Host "5. ASUS Optimization / Armoury Crate WMI sensors"
Write-Host $sep
try {
    $ns = "root\WMI"
    $obj = Get-WmiObject -Namespace $ns -Class "AsusAtkWmi_WMNB" -ErrorAction Stop
    Write-Host "  FOUND AsusAtkWmi_WMNB!"
    $obj | Format-List
} catch { Write-Host "  (AsusAtkWmi_WMNB not found)" }

try {
    $obj = Get-WmiObject -Namespace "root\WMI" -Class "ASUS_Sensor" -ErrorAction Stop
    Write-Host "  FOUND ASUS_Sensor!"
    $obj | Format-List
} catch { Write-Host "  (ASUS_Sensor not found)" }

# -- Summary -----------------------------------------------------------------
Write-Host ""
Write-Host $sep
Write-Host "SUMMARY - share this full output"
Write-Host $sep
Write-Host "Key findings to look for:"
Write-Host "  Section 1: NVMe temps > 0 means we can read drive temps"
Write-Host "  Section 2: Any ATK/ASUS class name in root\wmi"
Write-Host "  Section 3: ATKWMIACPIIO instances with sensor data"
Write-Host "  Section 4: Any class with temperature-looking values"
Write-Host ""
