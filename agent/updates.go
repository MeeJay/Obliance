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
func InstallUpdate(updateUID string) error {
	switch runtime.GOOS {
	case "windows":
		return installWindowsUpdate(updateUID)
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
	const psScript = `$ErrorActionPreference='SilentlyContinue'
$mod = Get-Module -ListAvailable PSWindowsUpdate -ErrorAction SilentlyContinue
if ($mod) {
  Import-Module PSWindowsUpdate -ErrorAction SilentlyContinue
  $updates = Get-WindowsUpdate -AcceptAll -IgnoreReboot 2>$null
  if ($updates) {
    $updates | ForEach-Object {
      $severity = if ($_.MsrcSeverity) { $_.MsrcSeverity.ToLower() } else { 'unknown' }
      "$($_.KBArticleIDs -join ',')|$($_.Title)|$severity|$($_.Categories[0].Name)|$($_.Size)|$($_.RebootRequired)"
    }
    exit 0
  }
}
# COM API fallback (no module required, Windows-native)
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
try { $result = $searcher.Search("IsInstalled=0 and Type='Software'") } catch { exit 1 }
foreach ($u in $result.Updates) {
  $kb = ($u.KBArticleIDs | Select-Object -First 1)
  $sev = if ($u.MsrcSeverity) { $u.MsrcSeverity.ToLower() } else { 'unknown' }
  $cat = if ($u.Categories.Count -gt 0) { $u.Categories.Item(0).Name } else { '' }
  $reboot = if ($u.InstallationBehavior.RebootBehavior -eq 1) { 'True' } else { 'False' }
  "$kb|$($u.Title)|$sev|$cat|$($u.MaxDownloadSize)|$reboot"
}`

	out, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-Command", psScript,
	).Output()
	if err != nil {
		return nil, fmt.Errorf("windows update scan: %w", err)
	}

	var updates []UpdateInfo
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
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
		if len(parts) >= 3 && parts[2] != "" {
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
	return updates, nil
}

func installWindowsUpdate(updateUID string) error {
	// Accept KBxxxxxxxx or bare numeric ID.
	kbID := updateUID
	if !strings.HasPrefix(strings.ToUpper(kbID), "KB") {
		kbID = "KB" + kbID
	}
	script := fmt.Sprintf(`$ErrorActionPreference='Stop'
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
			Severity:  "unknown",
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
			Severity:  "unknown",
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
				Severity:       "unknown",
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
	default:
		return "unknown"
	}
}

// sanitizeUID creates a simple slug from a title string for use as an update UID
// when no KB/package ID is available.
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
