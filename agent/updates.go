package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// ── Update types ───────────────────────────────────────────────────────────────

// UpdateInfo describes a single pending OS/software update.
type UpdateInfo struct {
	UpdateUID      string `json:"updateUid"`
	Title          string `json:"title"`
	Description    string `json:"description,omitempty"`
	Severity       string `json:"severity"` // critical, important, moderate, optional, unknown
	Category       string `json:"category,omitempty"`
	Source         string `json:"source"`
	Status         string `json:"status,omitempty"` // pending_reboot (agent-side hint, empty = available)
	SizeBytes      int64  `json:"sizeBytes,omitempty"`
	RequiresReboot bool   `json:"requiresReboot"`
}

// ── Entry points ──────────────────────────────────────────────────────────────

// ScanUpdates detects pending updates for the current platform and returns them.
func ScanUpdates() ([]UpdateInfo, error) {
	switch runtime.GOOS {
	case "windows":
		return scanWindowsUpdates()
	case "linux":
		return scanLinuxUpdates()
	case "darwin":
		return scanDarwinUpdates()
	default:
		return nil, fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
}

// InstallUpdate installs the update identified by updateUID on the current platform.
func InstallUpdate(updateUID, source string) error {
	switch runtime.GOOS {
	case "windows":
		return installWindowsUpdate(updateUID, source)
	case "linux":
		return installLinuxUpdate(updateUID)
	case "darwin":
		return installDarwinUpdate(updateUID)
	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
}

// PostUpdates POSTs the update list to the server.
func PostUpdates(updates []UpdateInfo, cfg *Config) error {
	payload := map[string]interface{}{
		"deviceUuid": cfg.DeviceUUID,
		"updates":    updates,
		"scannedAt":  time.Now().UTC(),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal updates: %w", err)
	}

	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/updates", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build updates request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("post updates: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("updates POST returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ── Windows ───────────────────────────────────────────────────────────────────

// scanWindowsUpdates uses PowerShell's PSWindowsUpdate module when available,
// falling back to the built-in Windows Update COM API (WUApiLib).
func scanWindowsUpdates() ([]UpdateInfo, error) {
	// Primary: PSWindowsUpdate module (must be pre-installed).
	// Falls back to COM API below if unavailable.
	const psScript = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference='SilentlyContinue'
$usedModule = $false
$mod = Get-Module -ListAvailable PSWindowsUpdate -ErrorAction SilentlyContinue
if ($mod) {
  Import-Module PSWindowsUpdate -ErrorAction SilentlyContinue
  $updates = Get-WindowsUpdate -AcceptAll -IgnoreReboot 2>$null
  if ($updates) {
    $usedModule = $true
    $updates | ForEach-Object {
      $severity = if ($_.MsrcSeverity) { $_.MsrcSeverity.ToLower() } else { 'unknown' }
      "$($_.KBArticleIDs -join ',')|$($_.Title)|$severity|$($_.Categories[0].Name)|$($_.Size)|$($_.RebootRequired)"
    }
  }
}
if (-not $usedModule) {
  # COM API fallback — pending (not installed) updates
  $session = New-Object -ComObject Microsoft.Update.Session
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
}
# Installed updates pending reboot — read the exact KBs from the RebootRequired registry key
$rebootKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
if (Test-Path $rebootKey) {
  try {
    # The RebootRequired key has subvalues whose names are the update GUIDs or KB numbers
    $pendingKBs = @()
    $props = Get-ItemProperty $rebootKey -ErrorAction SilentlyContinue
    if ($props) {
      $props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $pendingKBs += $_.Name }
    }
    # Query history to match GUIDs/KBs to titles
    $s3 = New-Object -ComObject Microsoft.Update.Session
    $sr3 = $s3.CreateUpdateSearcher()
    $hCount = $sr3.GetTotalHistoryCount()
    if ($hCount -gt 0) {
      $hist = $sr3.QueryHistory(0, [Math]::Min($hCount, 50))
      $matched = @{}
      foreach ($h in $hist) {
        if ($h.ResultCode -ne 2) { continue }
        $uid = $h.UpdateIdentity.UpdateID
        $kb = ''; if ($h.Title -match 'KB(\d+)') { $kb = "KB$($Matches[1])" }
        # Match if the update GUID or KB appears in pendingKBs
        $found = $false
        foreach ($pk in $pendingKBs) { if ($uid -like "*$pk*" -or $pk -like "*$uid*" -or ($kb -and $pk -like "*$kb*")) { $found = $true; break } }
        if ($found -and -not $matched[$uid]) {
          $matched[$uid] = $true
          $id = if ($kb) { $kb } else { $uid.Substring(0,8) }
          "REBOOT|$id|$($h.Title)|important|Update"
        }
      }
    }
    # If no match from history, just report that a reboot is pending generically
    if ($matched.Count -eq 0) {
      "REBOOT|REBOOT-PENDING|Windows Update - Restart Required|important|Update"
    }
  } catch {}
}`

	out, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-Command", psScript,
	).Output()
	if err != nil {
		// Don't fail the entire scan — WU may be unavailable but winget/choco still work
		log.Printf("Windows Update scan failed (continuing with package managers): %v", err)
	}

	var updates []UpdateInfo
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// REBOOT|KB...|Title|severity|category|size — installed, pending reboot
		if strings.HasPrefix(line, "REBOOT|") {
			rParts := strings.SplitN(line, "|", 6)
			if len(rParts) < 3 {
				continue
			}
			uid := strings.TrimSpace(rParts[1])
			title := strings.TrimSpace(rParts[2])
			if title == "" {
				continue
			}
			if uid == "" {
				uid = sanitizeUID(title)
			}
			sev := "important"
			if len(rParts) >= 4 && rParts[3] != "" {
				sev = normaliseSeverity(rParts[3])
			}
			cat := ""
			if len(rParts) >= 5 {
				cat = strings.TrimSpace(rParts[4])
			}
			if sev == "unknown" && cat != "" {
				sev = severityFromCategory(cat)
			}
			var sz int64
			if len(rParts) >= 6 {
				fmt.Sscanf(strings.TrimSpace(rParts[5]), "%d", &sz)
			}
			updates = append(updates, UpdateInfo{
				UpdateUID:      uid,
				Title:          title,
				Severity:       sev,
				Category:       cat,
				Source:         "windows_update",
				Status:         "pending_reboot",
				SizeBytes:      sz,
				RequiresReboot: true,
			})
			continue
		}

		// Normal: KB|Title|severity|category|size|rebootRequired
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
		rawSeverity := ""
		if len(parts) >= 3 {
			rawSeverity = strings.TrimSpace(parts[2])
		}
		category := ""
		if len(parts) >= 4 {
			category = strings.TrimSpace(parts[3])
		}
		severity := normaliseSeverity(rawSeverity)
		if severity == "unknown" && category != "" {
			severity = severityFromCategory(category)
		}
		var sizeBytes int64
		if len(parts) >= 5 {
			fmt.Sscanf(strings.TrimSpace(parts[4]), "%d", &sizeBytes)
		}
		requiresReboot := false
		if len(parts) >= 6 {
			requiresReboot = strings.EqualFold(strings.TrimSpace(parts[5]), "true")
		}
		updates = append(updates, UpdateInfo{
			UpdateUID:      uid,
			Title:          title,
			Severity:       severity,
			Category:       category,
			Source:         "windows_update",
			SizeBytes:      sizeBytes,
			RequiresReboot: requiresReboot,
		})
	}
	// Deduplicate (REBOOT entries from history + Get-HotFix may overlap)
	seen := make(map[string]bool)
	deduped := make([]UpdateInfo, 0, len(updates))
	for _, u := range updates {
		if seen[u.UpdateUID] {
			continue
		}
		seen[u.UpdateUID] = true
		deduped = append(deduped, u)
	}
	updates = deduped

	// Also scan app package managers (winget, chocolatey)
	updates = append(updates, scanWingetUpdates()...)
	updates = append(updates, scanChocolateyUpdates()...)

	return updates, nil
}

// scanWingetUpdates detects outdated apps via Windows Package Manager (winget).
// Available on Windows 10 1709+ / Windows 11. Returns an empty slice when winget
// is not installed or when every app is up to date.
func scanWingetUpdates() []UpdateInfo {
	wingetPath, err := exec.LookPath("winget")
	if err != nil {
		return nil
	}

	// --include-unknown: include apps without a known source version
	// --accept-source-agreements: non-interactive
	// --disable-interactivity: suppress progress bars (winget ≥1.5)
	cmd := exec.Command(wingetPath,
		"upgrade", "--include-unknown",
		"--accept-source-agreements",
		"--disable-interactivity",
	)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}

	// Strip ANSI escape codes that winget may emit in some terminal modes.
	ansiStripped := stripANSI(string(out))
	// Normalise CRLF → LF
	normalized := strings.ReplaceAll(ansiStripped, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")

	// Find the separator line (a long run of dashes).
	sepIdx := -1
	for i, line := range lines {
		trimmed := strings.Trim(line, "- \t")
		if len(line) > 20 && trimmed == "" {
			sepIdx = i
			break
		}
	}
	if sepIdx <= 0 || sepIdx >= len(lines)-1 {
		return nil
	}

	header := lines[sepIdx-1]
	// Determine column offsets from the header.
	namePos := strings.Index(header, "Name")
	idPos := strings.Index(header, "Id")
	versionPos := strings.Index(header, "Version")
	availablePos := strings.Index(header, "Available")
	sourcePos := strings.Index(header, "Source")
	if namePos < 0 || availablePos < 0 {
		return nil
	}

	var updates []UpdateInfo
	for _, line := range lines[sepIdx+1:] {
		runes := []rune(line)
		if len(runes) <= availablePos {
			continue
		}

		name := runeSlice(runes, namePos, idPos)
		id := runeSlice(runes, idPos, versionPos)
		available := runeSlice(runes, availablePos, sourcePos)

		if available == "" || name == "Name" {
			continue
		}
		// If name is empty or looks like a raw ID, use the ID as a prettier fallback
		if name == "" {
			name = id
		}
		// winget appends a footer like "N upgrades available."
		if strings.Contains(strings.ToLower(name), "upgrade") && strings.Contains(name, ".") {
			continue
		}

		uid := sanitizeUID(id)
		if uid == "" {
			uid = sanitizeUID(name)
		}
		source := "winget"
		if sourcePos >= 0 && len(runes) > sourcePos {
			if s := strings.TrimSpace(string(runes[sourcePos:])); s != "" {
				source = s
			}
		}

		// Prettify: if name looks like a raw ID (contains dots like Company.Product),
		// try to extract a human-readable name from it
		displayName := name
		if strings.Count(displayName, ".") >= 2 && !strings.Contains(displayName, " ") {
			displayName = prettifyWingetID(displayName)
		}

		updates = append(updates, UpdateInfo{
			UpdateUID: uid,
			Title:     displayName + " → " + available,
			Severity:  "moderate",
			Category:  "Application",
			Source:    source,
		})
	}
	return updates
}

// scanChocolateyUpdates detects outdated Chocolatey packages.
// Requires Chocolatey to be installed. Returns an empty slice otherwise.
func scanChocolateyUpdates() []UpdateInfo {
	chocoPath, err := exec.LookPath("choco")
	if err != nil {
		return nil
	}

	// -r = machine-readable pipe-separated output; --ignore-unfound = don't fail
	// on packages that have no remote source.
	out, err := exec.Command(chocoPath, "outdated", "-r", "--ignore-unfound").Output()
	if err != nil {
		return nil
	}

	var updates []UpdateInfo
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: packagename|currentVersion|newVersion|isPinned
		parts := strings.SplitN(line, "|", 4)
		if len(parts) < 3 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		available := strings.TrimSpace(parts[2])
		pinned := len(parts) >= 4 && strings.EqualFold(strings.TrimSpace(parts[3]), "true")
		if name == "" || available == "" || pinned {
			continue
		}
		updates = append(updates, UpdateInfo{
			UpdateUID: sanitizeUID("choco-" + name),
			Title:     name + " → " + available,
			Severity:  "moderate",
			Category:  "Application",
			Source:    "chocolatey",
		})
	}
	return updates
}

// stripANSI removes ANSI escape sequences (e.g. colour codes) from s.
func stripANSI(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		if s[i] == 0x1b && i+1 < len(s) && s[i+1] == '[' {
			// Skip until the terminating letter (a–z / A–Z)
			i += 2
			for i < len(s) && !(s[i] >= 'A' && s[i] <= 'Z' || s[i] >= 'a' && s[i] <= 'z') {
				i++
			}
			i++ // skip the terminating letter
		} else {
			b.WriteByte(s[i])
			i++
		}
	}
	return b.String()
}

// runeSlice extracts runes[start:end], trimming whitespace.
// end <= 0 or end > len means "to end of slice".
func runeSlice(runes []rune, start, end int) string {
	if start < 0 || start >= len(runes) {
		return ""
	}
	if end <= 0 || end > len(runes) {
		return strings.TrimSpace(string(runes[start:]))
	}
	return strings.TrimSpace(string(runes[start:end]))
}

func installWindowsUpdate(updateUID, source string) error {
	switch source {
	case "chocolatey":
		return installChocolateyUpdate(updateUID)
	case "winget":
		return installWingetUpdate(updateUID)
	default:
		return installWindowsKBUpdate(updateUID)
	}
}

func installWindowsKBUpdate(updateUID string) error {
	kbID := updateUID
	if !strings.HasPrefix(strings.ToUpper(kbID), "KB") {
		kbID = "KB" + kbID
	}
	script := fmt.Sprintf(`[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference='Stop'
$mod = Get-Module -ListAvailable PSWindowsUpdate -ErrorAction SilentlyContinue
if ($mod) {
  Import-Module PSWindowsUpdate
  Install-WindowsUpdate -KBArticleID '%s' -AcceptAll -IgnoreReboot -Confirm:$false
} else {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result = $searcher.Search("IsInstalled=0 and Type='Software'")
  $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
  foreach ($u in $result.Updates) {
    if ($u.KBArticleIDs -contains '%s') { $null = $toInstall.Add($u) }
  }
  if ($toInstall.Count -eq 0) { Write-Error 'Update not found'; exit 1 }
  $downloader = $session.CreateUpdateDownloader()
  $downloader.Updates = $toInstall
  $null = $downloader.Download()
  $installer = $session.CreateUpdateInstaller()
  $installer.Updates = $toInstall
  $installer.Install()
}`, kbID, strings.TrimPrefix(strings.ToUpper(kbID), "KB"))

	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("install update %s: %w\n%s", updateUID, err, string(out))
	}
	log.Printf("Update %s installed: %s", updateUID, strings.TrimSpace(string(out)))
	return nil
}

func installChocolateyUpdate(pkgName string) error {
	// Strip "choco-" prefix if present (added by scan)
	pkg := strings.TrimPrefix(pkgName, "choco-")
	cmd := exec.Command("choco", "upgrade", pkg, "-y", "--no-progress")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("choco upgrade %s: %w\n%s", pkg, err, string(out))
	}
	log.Printf("Chocolatey update %s: %s", pkg, strings.TrimSpace(string(out)))
	return nil
}

func installWingetUpdate(pkgID string) error {
	cmd := exec.Command("winget", "upgrade", "--id", pkgID,
		"--accept-source-agreements", "--accept-package-agreements",
		"--silent", "--disable-interactivity")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("winget upgrade %s: %w\n%s", pkgID, err, string(out))
	}
	log.Printf("Winget update %s: %s", pkgID, strings.TrimSpace(string(out)))
	return nil
}

// ── Linux ─────────────────────────────────────────────────────────────────────

func scanLinuxUpdates() ([]UpdateInfo, error) {
	// Detect package manager and delegate.
	if aptPath, err := exec.LookPath("apt"); err == nil {
		return scanAptUpdates(aptPath)
	}
	if dnfPath, err := exec.LookPath("dnf"); err == nil {
		return scanDnfUpdates(dnfPath)
	}
	if yumPath, err := exec.LookPath("yum"); err == nil {
		return scanYumUpdates(yumPath)
	}
	return nil, fmt.Errorf("no supported package manager found (apt/dnf/yum)")
}

func scanAptUpdates(aptPath string) ([]UpdateInfo, error) {
	// Update package lists first (non-fatal if it fails in restricted envs).
	_ = exec.Command(aptPath, "-qq", "update").Run()

	out, err := exec.Command(aptPath, "list", "--upgradable", "-qq").Output()
	if err != nil {
		return nil, fmt.Errorf("apt list --upgradable: %w", err)
	}

	var updates []UpdateInfo
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Listing...") {
			continue
		}
		// Format: "packagename/release version arch [upgradable from: old]"
		slashIdx := strings.Index(line, "/")
		if slashIdx < 0 {
			continue
		}
		pkgName := line[:slashIdx]
		rest := line[slashIdx+1:]
		// Extract new version: second space-separated token
		fields := strings.Fields(rest)
		newVersion := ""
		if len(fields) >= 2 {
			newVersion = fields[1]
		}
		updates = append(updates, UpdateInfo{
			UpdateUID: pkgName,
			Title:     fmt.Sprintf("%s %s", pkgName, newVersion),
			Severity:  "moderate",
			Source:    "apt",
		})
	}
	return updates, nil
}

func scanDnfUpdates(dnfPath string) ([]UpdateInfo, error) {
	out, err := exec.Command(dnfPath, "check-update", "--quiet").Output()
	// dnf check-update returns exit code 100 when updates are available — not an error.
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); !ok || exitErr.ExitCode() != 100 {
			return nil, fmt.Errorf("dnf check-update: %w", err)
		}
	}
	return parseDnfOutput(string(out), "dnf"), nil
}

func scanYumUpdates(yumPath string) ([]UpdateInfo, error) {
	out, err := exec.Command(yumPath, "check-update", "--quiet").Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); !ok || exitErr.ExitCode() != 100 {
			return nil, fmt.Errorf("yum check-update: %w", err)
		}
	}
	return parseDnfOutput(string(out), "yum"), nil
}

// parseDnfOutput parses the tabular output of `dnf/yum check-update`.
// Format: "<package>.<arch>  <version>  <repo>"
func parseDnfOutput(output, source string) []UpdateInfo {
	var updates []UpdateInfo
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Last metadata") || strings.HasPrefix(line, "Obsoleting") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pkgArch := fields[0]
		version := fields[1]
		// Strip the arch suffix (e.g. "bash.x86_64" → "bash")
		dotIdx := strings.LastIndex(pkgArch, ".")
		pkgName := pkgArch
		if dotIdx > 0 {
			pkgName = pkgArch[:dotIdx]
		}
		updates = append(updates, UpdateInfo{
			UpdateUID: pkgName,
			Title:     fmt.Sprintf("%s %s", pkgName, version),
			Severity:  "moderate",
			Source:    source,
		})
	}
	return updates
}

func installLinuxUpdate(updateUID string) error {
	// Try apt first, then dnf/yum.
	if aptPath, err := exec.LookPath("apt"); err == nil {
		cmd := exec.Command(aptPath, "-y", "install", "--only-upgrade", updateUID)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("apt install %s: %w\n%s", updateUID, err, string(out))
		}
		return nil
	}
	for _, mgr := range []string{"dnf", "yum"} {
		if mgrPath, err := exec.LookPath(mgr); err == nil {
			cmd := exec.Command(mgrPath, "-y", "update", updateUID)
			out, err := cmd.CombinedOutput()
			if err != nil {
				return fmt.Errorf("%s update %s: %w\n%s", mgr, updateUID, err, string(out))
			}
			return nil
		}
	}
	return fmt.Errorf("no supported package manager found to install update %s", updateUID)
}

// ── macOS ─────────────────────────────────────────────────────────────────────

func scanDarwinUpdates() ([]UpdateInfo, error) {
	out, err := exec.Command("softwareupdate", "-l").Output()
	if err != nil {
		return nil, fmt.Errorf("softwareupdate -l: %w", err)
	}
	return parseSoftwareupdateOutput(string(out)), nil
}

// parseSoftwareupdateOutput parses the text output of `softwareupdate -l`.
//
// The format interleaves recommendation lines and detail lines:
//
//	* Label Title-Version
//	    Title (Version), <size> [recommended] [restart]
func parseSoftwareupdateOutput(output string) []UpdateInfo {
	var updates []UpdateInfo
	var currentUID, currentTitle string

	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "* ") || strings.HasPrefix(trimmed, "- ") {
			// New update entry: "* Label-Version-NNNN" or "* Label"
			label := strings.TrimSpace(trimmed[2:])
			currentUID = label
			currentTitle = label
		} else if strings.HasPrefix(trimmed, "Title:") {
			currentTitle = strings.TrimSpace(strings.TrimPrefix(trimmed, "Title:"))
		} else if currentUID != "" && strings.Contains(trimmed, ",") {
			// Detail line: "Title (1.2.3), 123K [recommended] [restart]"
			requiresReboot := strings.Contains(strings.ToLower(trimmed), "[restart]")
			if currentTitle == "" {
				currentTitle = currentUID
			}
			updates = append(updates, UpdateInfo{
				UpdateUID:      currentUID,
				Title:          currentTitle,
				Severity:       "important",
				Source:         "softwareupdate",
				RequiresReboot: requiresReboot,
			})
			currentUID = ""
			currentTitle = ""
		}
	}
	return updates
}

func installDarwinUpdate(updateUID string) error {
	cmd := exec.Command("softwareupdate", "-i", updateUID)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("softwareupdate -i %s: %w\n%s", updateUID, err, string(out))
	}
	log.Printf("Update %s installed: %s", updateUID, strings.TrimSpace(string(out)))
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func normaliseSeverity(s string) string {
	switch strings.ToLower(s) {
	case "critical":
		return "critical"
	case "important":
		return "important"
	case "moderate":
		return "moderate"
	case "low", "optional":
		return "optional"
	case "":
		return "unknown"
	default:
		return "unknown"
	}
}

// severityFromCategory infers a severity when MsrcSeverity is absent,
// based on the Windows Update category name.
func severityFromCategory(cat string) string {
	lc := strings.ToLower(cat)
	switch {
	case strings.Contains(lc, "security"):
		return "important"
	case strings.Contains(lc, "critical"):
		return "critical"
	case strings.Contains(lc, "service pack"), strings.Contains(lc, "feature pack"):
		return "important"
	case strings.Contains(lc, "definition"), strings.Contains(lc, "defender"):
		return "moderate"
	case strings.Contains(lc, "driver"):
		return "optional"
	case strings.Contains(lc, "update rollup"), strings.Contains(lc, "cumulative"):
		return "important"
	case strings.Contains(lc, "tool"):
		return "optional"
	default:
		return "moderate"
	}
}

// sanitizeUID creates a simple slug from a title string for use as an update UID
// when no KB/package ID is available.
// prettifyWingetID turns "MicrosoftCorporationII.WinAppRuntime.Main.1.8"
// into "Win App Runtime Main" by stripping the publisher prefix and splitting CamelCase.
func prettifyWingetID(id string) string {
	// Strip leading store ID (e.g. "9PLJQ12FQ3CV-")
	if idx := strings.Index(id, "-"); idx >= 0 && idx < 20 {
		id = id[idx+1:]
	}
	parts := strings.Split(id, ".")
	// Skip the first part if it looks like a publisher (e.g. "MicrosoftCorporationII", "Google")
	start := 0
	if len(parts) > 2 {
		start = 1
	}
	// Take the product parts, skip version-like suffixes (digits only)
	var nameParts []string
	for _, p := range parts[start:] {
		// Stop at version numbers
		if len(p) > 0 && p[0] >= '0' && p[0] <= '9' {
			break
		}
		// Split CamelCase: "WinAppRuntime" → "Win App Runtime"
		var words []string
		current := ""
		for i, r := range p {
			if i > 0 && r >= 'A' && r <= 'Z' {
				if current != "" {
					words = append(words, current)
				}
				current = string(r)
			} else {
				current += string(r)
			}
		}
		if current != "" {
			words = append(words, current)
		}
		nameParts = append(nameParts, strings.Join(words, " "))
	}
	result := strings.Join(nameParts, " ")
	if result == "" {
		return id // fallback to original
	}
	return result
}

func sanitizeUID(title string) string {
	slug := strings.ToLower(title)
	slug = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return '-'
	}, slug)
	// Collapse multiple dashes.
	for strings.Contains(slug, "--") {
		slug = strings.ReplaceAll(slug, "--", "-")
	}
	slug = strings.Trim(slug, "-")
	if len(slug) > 64 {
		slug = slug[:64]
	}
	return slug
}
