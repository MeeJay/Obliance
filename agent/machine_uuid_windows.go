//go:build windows

package main

import (
	"os/exec"
	"strings"
	"syscall"
)

// hiddenCmd wraps exec.Command so the child process never flashes a console
// window. Safe to call from Windows services (where no console is attached).
func hiddenCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

// readMachineUUID returns the SMBIOS UUID of this Windows machine.
// Tries Get-CimInstance first (Win8+), falls back to wmic (deprecated but
// still present on most systems for compatibility).
// Returns "" if neither method works or the UUID is all zeros / blacklisted.
func readMachineUUID() string {
	// Primary: PowerShell Get-CimInstance Win32_ComputerSystemProduct
	out, err := hiddenCmd(
		"powershell", "-NoProfile", "-NonInteractive", "-Command",
		"(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID",
	).Output()
	if err == nil {
		if uuid := normaliseUUID(strings.TrimSpace(string(out))); uuid != "" {
			return uuid
		}
	}

	// Fallback: wmic csproduct get UUID /value  ->  "UUID=XXXX-..."
	out, err = hiddenCmd("wmic", "csproduct", "get", "UUID", "/value").Output()
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "UUID=") {
				if uuid := normaliseUUID(strings.TrimPrefix(line, "UUID=")); uuid != "" {
					return uuid
				}
			}
		}
	}

	return ""
}

// readSystemDiskSerial returns the hardware serial number of the physical
// disk that hosts the Windows system volume (usually C:\).
//
// Implementation: walks SystemDrive -> Partition -> Disk via the Storage
// PowerShell module (available on Windows 8 / Server 2012 and later) to find
// the physical disk number, then reads SerialNumber from Win32_DiskDrive via
// CIM. Returns "" if any step fails or the serial is empty.
func readSystemDiskSerial() string {
	// Single PowerShell command that prints the serial of the disk hosting
	// the current system drive. Output is trimmed and a single line.
	script := `
$ErrorActionPreference = "SilentlyContinue"
$letter = ($env:SystemDrive).TrimEnd(':')
$partition = Get-Partition -DriveLetter $letter | Select-Object -First 1
if (-not $partition) { exit 1 }
$disk = Get-Disk -Number $partition.DiskNumber
if (-not $disk) { exit 1 }
$drive = Get-CimInstance -ClassName Win32_DiskDrive | Where-Object { $_.Index -eq $disk.Number } | Select-Object -First 1
if ($drive -and $drive.SerialNumber) { Write-Output $drive.SerialNumber.Trim() }
`
	out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err == nil {
		serial := strings.TrimSpace(string(out))
		if serial != "" {
			return serial
		}
	}

	// Fallback: wmic diskdrive where Index=0 get SerialNumber /value
	// Assumes disk 0 is the system disk. This is true on the vast majority
	// of Windows installs, especially ones too old for Get-Partition.
	out, err = hiddenCmd("wmic", "diskdrive", "where", "Index=0", "get", "SerialNumber", "/value").Output()
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "SerialNumber=") {
				return strings.TrimSpace(strings.TrimPrefix(line, "SerialNumber="))
			}
		}
	}

	return ""
}
