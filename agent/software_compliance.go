package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// ── Software compliance types ────────────────────────────────────────────────

type SoftwareEntrySourceConfig struct {
	PackageManager  string `json:"packageManager"`
	PackageId       string `json:"packageId"`
	MsiUrl          string `json:"msiUrl"`
	RepoPackageId   int    `json:"repoPackageId,omitempty"`
	RepoPackageUuid string `json:"repoPackageUuid,omitempty"`
	InstallScript   string `json:"installScript"`
	MsiParams       string `json:"msiParams"`
	PlatformScope   string `json:"platformScope"`
}

type SoftwareComplianceEntry struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	MatchType     string `json:"matchType"`     // exact, contains, regex
	Publisher     string `json:"publisher"`
	MinVersion    string `json:"minVersion"`
	MaxVersion    string `json:"maxVersion"`
	InstallSource string `json:"installSource"` // winget, choco, apt, dnf, brew, pkg, msi, custom
	InstallID     string `json:"installId"`
	InstallScript string `json:"installScript"`
	MsiUrl        string `json:"msiUrl"`
	MsiParams     string `json:"msiParams"`
	Sources       []SoftwareEntrySourceConfig `json:"sources,omitempty"`
}

type SoftwareComplianceEntryResult struct {
	EntryID              int    `json:"entryId"`
	EntryName            string `json:"entryName"`
	Status               string `json:"status"` // compliant, non_compliant, remediated, remediation_failed, error
	MatchedSoftware      string `json:"matchedSoftware,omitempty"`
	MatchedVersion       string `json:"matchedVersion,omitempty"`
	RemediationTriggered bool   `json:"remediationTriggered"`
	Detail               string `json:"detail,omitempty"`
	CheckedAt            string `json:"checkedAt"`
}

// ── Multi-source platform matching ──────────────────────────────────────────

// selectMatchingSource returns the first source whose platformScope matches the
// current OS / distro family, or nil if none match.
func selectMatchingSource(sources []SoftwareEntrySourceConfig) *SoftwareEntrySourceConfig {
	family := getDistroFamily()
	for i := range sources {
		s := &sources[i]
		switch s.PlatformScope {
		case "any":
			return s
		case "windows":
			if runtime.GOOS == "windows" {
				return s
			}
		case "macos":
			if runtime.GOOS == "darwin" {
				return s
			}
		case "freebsd":
			if runtime.GOOS == "freebsd" {
				return s
			}
		case "rhel":
			if family == "rhel" || family == "centos" {
				return s
			}
		default:
			// Direct match on distro family (e.g. "debian" == "debian", "fedora" == "fedora").
			if s.PlatformScope == family {
				return s
			}
		}
	}
	return nil
}

// entryFromSource builds a backward-compatible SoftwareComplianceEntry from a
// matched source config, preserving the original entry's matching fields.
func entryFromSource(base SoftwareComplianceEntry, src *SoftwareEntrySourceConfig) SoftwareComplianceEntry {
	return SoftwareComplianceEntry{
		ID:            base.ID,
		Name:          base.Name,
		MatchType:     base.MatchType,
		Publisher:     base.Publisher,
		MinVersion:    base.MinVersion,
		MaxVersion:    base.MaxVersion,
		InstallSource: src.PackageManager,
		InstallID:     src.PackageId,
		InstallScript: src.InstallScript,
		MsiUrl:        src.MsiUrl,
		MsiParams:     src.MsiParams,
	}
}

// ── Command handlers ─────────────────────────────────────────────────────────

func (d *CommandDispatcher) handleCheckSoftwareCompliance(cmd AgentCommand) (interface{}, error) {
	if cmd.Payload == nil {
		return nil, fmt.Errorf("no payload")
	}

	// Parse payload fields.
	listIdRaw, _ := cmd.Payload["listId"].(float64)
	listId := int(listIdRaw)
	listType, _ := cmd.Payload["listType"].(string) // whitelist or blacklist
	autoRemediate, _ := cmd.Payload["autoRemediate"].(bool)

	var entries []SoftwareComplianceEntry
	if entriesRaw, ok := cmd.Payload["entries"]; ok {
		rawBytes, err := json.Marshal(entriesRaw)
		if err == nil {
			_ = json.Unmarshal(rawBytes, &entries)
		}
	}

	if listType == "" {
		return nil, fmt.Errorf("missing listType (whitelist/blacklist)")
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("no entries to check")
	}

	// Scan current installed software.
	software := scanInstalledSoftware()
	log.Printf("Software compliance: scanned %d installed packages, checking %d entries (type=%s)", len(software), len(entries), listType)

	results := make([]SoftwareComplianceEntryResult, 0, len(entries))
	now := time.Now().UTC().Format(time.RFC3339)

	for _, entry := range entries {
		r := SoftwareComplianceEntryResult{
			EntryID:   entry.ID,
			EntryName: entry.Name,
			CheckedAt: now,
		}

		matched, matchedName, matchedVersion := matchSoftwareEntry(entry, software)

		// Resolve the effective entry for remediation: use multi-source if available.
		effectiveEntry := entry
		hasSource := hasInstallInfo(entry)
		if len(entry.Sources) > 0 {
			if src := selectMatchingSource(entry.Sources); src != nil {
				effectiveEntry = entryFromSource(entry, src)
				hasSource = hasInstallInfo(effectiveEntry)
			} else {
				// No matching source for this platform — cannot remediate.
				hasSource = false
			}
		}

		if listType == "whitelist" {
			// Whitelist: software MUST be present.
			if matched {
				r.Status = "compliant"
				r.MatchedSoftware = matchedName
				r.MatchedVersion = matchedVersion
			} else {
				r.Status = "non_compliant"
				r.Detail = "required software not found"
				// Auto-remediate: install the missing software.
				if autoRemediate && hasSource {
					log.Printf("Software compliance: auto-installing %s (source=%s, id=%s)", entry.Name, effectiveEntry.InstallSource, effectiveEntry.InstallID)
					if err := installSoftwarePackage(effectiveEntry); err != nil {
						log.Printf("Software compliance: install %s failed: %v", entry.Name, err)
						r.Status = "remediation_failed"
						r.Detail = fmt.Sprintf("install failed: %v", err)
					} else {
						r.Status = "remediated"
						r.Detail = "software installed successfully"
					}
					r.RemediationTriggered = true
				}
			}
		} else {
			// Blacklist: software must NOT be present.
			if !matched {
				r.Status = "compliant"
			} else {
				r.Status = "non_compliant"
				r.MatchedSoftware = matchedName
				r.MatchedVersion = matchedVersion
				r.Detail = "prohibited software found"
				// Auto-remediate: uninstall the unwanted software.
				if autoRemediate && hasSource {
					log.Printf("Software compliance: auto-uninstalling %s (source=%s, id=%s)", entry.Name, effectiveEntry.InstallSource, effectiveEntry.InstallID)
					if err := uninstallSoftwarePackage(effectiveEntry); err != nil {
						log.Printf("Software compliance: uninstall %s failed: %v", entry.Name, err)
						r.Status = "remediation_failed"
						r.Detail = fmt.Sprintf("uninstall failed: %v", err)
					} else {
						r.Status = "remediated"
						r.Detail = "software uninstalled successfully"
					}
					r.RemediationTriggered = true
				}
			}
		}

		results = append(results, r)
	}

	// Compute score.
	compliant := 0
	for _, r := range results {
		if r.Status == "compliant" || r.Status == "remediated" {
			compliant++
		}
	}
	score := 0.0
	if len(results) > 0 {
		score = float64(compliant) / float64(len(results)) * 100.0
	}

	// Post results to server asynchronously.
	cfg := d.makeConfig()
	go postSoftwareComplianceResults(listId, results, score, cfg)

	return map[string]interface{}{
		"listId":    listId,
		"listType":  listType,
		"score":     score,
		"compliant": compliant,
		"total":     len(results),
		"platform":  runtime.GOOS,
	}, nil
}

func (d *CommandDispatcher) handleInstallSoftware(cmd AgentCommand) (interface{}, error) {
	if cmd.Payload == nil {
		return nil, fmt.Errorf("no payload")
	}

	// Check for multi-source payload first.
	var sources []SoftwareEntrySourceConfig
	if sourcesRaw, ok := cmd.Payload["sources"]; ok {
		rawBytes, err := json.Marshal(sourcesRaw)
		if err == nil {
			_ = json.Unmarshal(rawBytes, &sources)
		}
	}

	var entry SoftwareComplianceEntry
	if len(sources) > 0 {
		src := selectMatchingSource(sources)
		if src == nil {
			return nil, fmt.Errorf("no matching source for this platform (distro=%s, os=%s)", getDistroFamily(), runtime.GOOS)
		}
		entry = SoftwareComplianceEntry{
			InstallSource: src.PackageManager,
			InstallID:     src.PackageId,
			InstallScript: src.InstallScript,
			MsiUrl:        src.MsiUrl,
			MsiParams:     src.MsiParams,
		}
		// Handle repo package download for MSI source.
		if src.RepoPackageUuid != "" && src.PackageManager == "msi" {
			cfg := d.makeConfig()
			downloadedPath, err := downloadRepoPackage(cfg, src.RepoPackageUuid)
			if err != nil {
				return nil, fmt.Errorf("repo package download failed: %w", err)
			}
			entry.MsiUrl = downloadedPath
		}
	} else {
		source, _ := cmd.Payload["source"].(string)
		packageId, _ := cmd.Payload["packageId"].(string)
		script, _ := cmd.Payload["script"].(string)
		msiUrl, _ := cmd.Payload["msiUrl"].(string)
		msiParams, _ := cmd.Payload["msiParams"].(string)

		entry = SoftwareComplianceEntry{
			InstallSource: source,
			InstallID:     packageId,
			InstallScript: script,
			MsiUrl:        msiUrl,
			MsiParams:     msiParams,
		}
	}

	if err := installSoftwarePackage(entry); err != nil {
		return nil, fmt.Errorf("install failed: %w", err)
	}
	return map[string]string{"message": "software installed successfully"}, nil
}

func (d *CommandDispatcher) handleUninstallSoftware(cmd AgentCommand) (interface{}, error) {
	if cmd.Payload == nil {
		return nil, fmt.Errorf("no payload")
	}

	// Check for multi-source payload first.
	var sources []SoftwareEntrySourceConfig
	if sourcesRaw, ok := cmd.Payload["sources"]; ok {
		rawBytes, err := json.Marshal(sourcesRaw)
		if err == nil {
			_ = json.Unmarshal(rawBytes, &sources)
		}
	}

	var entry SoftwareComplianceEntry
	if len(sources) > 0 {
		src := selectMatchingSource(sources)
		if src == nil {
			return nil, fmt.Errorf("no matching source for this platform (distro=%s, os=%s)", getDistroFamily(), runtime.GOOS)
		}
		entry = SoftwareComplianceEntry{
			InstallSource: src.PackageManager,
			InstallID:     src.PackageId,
			InstallScript: src.InstallScript,
			MsiUrl:        src.MsiUrl,
			MsiParams:     src.MsiParams,
		}
	} else {
		source, _ := cmd.Payload["source"].(string)
		packageId, _ := cmd.Payload["packageId"].(string)
		script, _ := cmd.Payload["script"].(string)
		msiUrl, _ := cmd.Payload["msiUrl"].(string)
		msiParams, _ := cmd.Payload["msiParams"].(string)

		entry = SoftwareComplianceEntry{
			InstallSource: source,
			InstallID:     packageId,
			InstallScript: script,
			MsiUrl:        msiUrl,
			MsiParams:     msiParams,
		}
	}

	if err := uninstallSoftwarePackage(entry); err != nil {
		return nil, fmt.Errorf("uninstall failed: %w", err)
	}
	return map[string]string{"message": "software uninstalled successfully"}, nil
}

// ── Matching logic ───────────────────────────────────────────────────────────

func matchSoftwareEntry(entry SoftwareComplianceEntry, software []SoftwareEntry) (matched bool, name string, version string) {
	for _, sw := range software {
		nameMatch := false

		switch entry.MatchType {
		case "exact":
			nameMatch = strings.EqualFold(sw.Name, entry.Name)
		case "contains":
			nameMatch = strings.Contains(strings.ToLower(sw.Name), strings.ToLower(entry.Name))
		case "regex":
			re, err := regexp.Compile("(?i)" + entry.Name)
			if err != nil {
				log.Printf("Software compliance: invalid regex %q: %v", entry.Name, err)
				continue
			}
			nameMatch = re.MatchString(sw.Name)
		default:
			// Default to contains if matchType is unset.
			nameMatch = strings.Contains(strings.ToLower(sw.Name), strings.ToLower(entry.Name))
		}

		if !nameMatch {
			continue
		}

		// Check publisher if specified.
		if entry.Publisher != "" {
			if !strings.Contains(strings.ToLower(sw.Publisher), strings.ToLower(entry.Publisher)) {
				continue
			}
		}

		// Check version constraints if specified.
		if entry.MinVersion != "" && sw.Version != "" {
			if compareVersions(sw.Version, entry.MinVersion) < 0 {
				continue
			}
		}
		if entry.MaxVersion != "" && sw.Version != "" {
			if compareVersions(sw.Version, entry.MaxVersion) > 0 {
				continue
			}
		}

		return true, sw.Name, sw.Version
	}
	return false, "", ""
}

// compareVersions performs a simple dot-separated version comparison.
// Returns -1, 0, or 1 like strcmp.
func compareVersions(a, b string) int {
	partsA := strings.Split(a, ".")
	partsB := strings.Split(b, ".")
	maxLen := len(partsA)
	if len(partsB) > maxLen {
		maxLen = len(partsB)
	}
	for i := 0; i < maxLen; i++ {
		var na, nb int
		if i < len(partsA) {
			fmt.Sscanf(partsA[i], "%d", &na)
		}
		if i < len(partsB) {
			fmt.Sscanf(partsB[i], "%d", &nb)
		}
		if na < nb {
			return -1
		}
		if na > nb {
			return 1
		}
	}
	return 0
}

// ── Install / Uninstall ──────────────────────────────────────────────────────

func hasInstallInfo(entry SoftwareComplianceEntry) bool {
	return entry.InstallID != "" || entry.InstallScript != "" || entry.MsiUrl != ""
}

func installSoftwarePackage(entry SoftwareComplianceEntry) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	var out []byte
	var err error

	switch entry.InstallSource {
	case "winget":
		if entry.InstallID == "" {
			return fmt.Errorf("winget install requires installId")
		}
		out, err = runInstallCmd(ctx, "winget", "install", "--id", entry.InstallID,
			"--accept-source-agreements", "--accept-package-agreements", "-h")
	case "choco":
		if entry.InstallID == "" {
			return fmt.Errorf("choco install requires installId")
		}
		out, err = runInstallCmd(ctx, "choco", "install", entry.InstallID, "-y", "--no-progress")
	case "apt":
		if entry.InstallID == "" {
			return fmt.Errorf("apt install requires installId")
		}
		out, err = runInstallCmd(ctx, "apt-get", "install", "-y", entry.InstallID)
	case "dnf":
		if entry.InstallID == "" {
			return fmt.Errorf("dnf install requires installId")
		}
		out, err = runInstallCmd(ctx, "dnf", "install", "-y", entry.InstallID)
	case "brew":
		if entry.InstallID == "" {
			return fmt.Errorf("brew install requires installId")
		}
		out, err = runInstallCmd(ctx, "brew", "install", entry.InstallID)
	case "pkg":
		if entry.InstallID == "" {
			return fmt.Errorf("pkg install requires installId")
		}
		out, err = runInstallCmd(ctx, "pkg", "install", "-y", entry.InstallID)
	case "yum":
		if entry.InstallID == "" {
			return fmt.Errorf("yum install requires installId")
		}
		out, err = runInstallCmd(ctx, "yum", "install", "-y", entry.InstallID)
	case "snap":
		if entry.InstallID == "" {
			return fmt.Errorf("snap install requires installId")
		}
		out, err = runInstallCmd(ctx, "snap", "install", entry.InstallID)
	case "flatpak":
		if entry.InstallID == "" {
			return fmt.Errorf("flatpak install requires installId")
		}
		out, err = runInstallCmd(ctx, "flatpak", "install", "-y", "flathub", entry.InstallID)
	case "msi":
		return installMsiPackage(entry.MsiUrl, entry.MsiParams)
	case "custom":
		if entry.InstallScript == "" {
			return fmt.Errorf("custom install requires installScript")
		}
		out, err = runCustomScript(ctx, entry.InstallScript)
	default:
		return fmt.Errorf("unsupported install source: %s", entry.InstallSource)
	}

	if ctx.Err() == context.DeadlineExceeded {
		return fmt.Errorf("%s install %s: timed out after 15 minutes", entry.InstallSource, entry.InstallID)
	}
	if err != nil {
		return fmt.Errorf("%s install %s: %w\n%s", entry.InstallSource, entry.InstallID, err, string(out))
	}
	log.Printf("Software install %s (%s): %s", entry.InstallID, entry.InstallSource, strings.TrimSpace(string(out)))
	return nil
}

func uninstallSoftwarePackage(entry SoftwareComplianceEntry) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	var out []byte
	var err error

	switch entry.InstallSource {
	case "winget":
		if entry.InstallID == "" {
			return fmt.Errorf("winget uninstall requires installId")
		}
		out, err = runInstallCmd(ctx, "winget", "uninstall", "--id", entry.InstallID, "-h")
	case "choco":
		if entry.InstallID == "" {
			return fmt.Errorf("choco uninstall requires installId")
		}
		out, err = runInstallCmd(ctx, "choco", "uninstall", entry.InstallID, "-y")
	case "apt":
		if entry.InstallID == "" {
			return fmt.Errorf("apt remove requires installId")
		}
		out, err = runInstallCmd(ctx, "apt-get", "remove", "-y", entry.InstallID)
	case "dnf":
		if entry.InstallID == "" {
			return fmt.Errorf("dnf remove requires installId")
		}
		out, err = runInstallCmd(ctx, "dnf", "remove", "-y", entry.InstallID)
	case "brew":
		if entry.InstallID == "" {
			return fmt.Errorf("brew uninstall requires installId")
		}
		out, err = runInstallCmd(ctx, "brew", "uninstall", entry.InstallID)
	case "pkg":
		if entry.InstallID == "" {
			return fmt.Errorf("pkg remove requires installId")
		}
		out, err = runInstallCmd(ctx, "pkg", "remove", "-y", entry.InstallID)
	case "yum":
		if entry.InstallID == "" {
			return fmt.Errorf("yum remove requires installId")
		}
		out, err = runInstallCmd(ctx, "yum", "remove", "-y", entry.InstallID)
	case "snap":
		if entry.InstallID == "" {
			return fmt.Errorf("snap remove requires installId")
		}
		out, err = runInstallCmd(ctx, "snap", "remove", entry.InstallID)
	case "flatpak":
		if entry.InstallID == "" {
			return fmt.Errorf("flatpak uninstall requires installId")
		}
		out, err = runInstallCmd(ctx, "flatpak", "uninstall", "-y", entry.InstallID)
	case "msi":
		return uninstallMsiPackage(entry.MsiUrl, entry.MsiParams)
	case "custom":
		if entry.InstallScript == "" {
			return fmt.Errorf("custom uninstall requires installScript")
		}
		out, err = runCustomScript(ctx, entry.InstallScript)
	default:
		return fmt.Errorf("unsupported install source: %s", entry.InstallSource)
	}

	if ctx.Err() == context.DeadlineExceeded {
		return fmt.Errorf("%s uninstall %s: timed out after 15 minutes", entry.InstallSource, entry.InstallID)
	}
	if err != nil {
		return fmt.Errorf("%s uninstall %s: %w\n%s", entry.InstallSource, entry.InstallID, err, string(out))
	}
	log.Printf("Software uninstall %s (%s): %s", entry.InstallID, entry.InstallSource, strings.TrimSpace(string(out)))
	return nil
}

func installMsiPackage(msiUrl, params string) error {
	if msiUrl == "" {
		return fmt.Errorf("msi install: no MSI URL provided")
	}

	// If the URL is a remote path (http/https), download to temp first.
	var msiPath string
	if strings.HasPrefix(msiUrl, "http://") || strings.HasPrefix(msiUrl, "https://") {
		tmpPath := filepath.Join(os.TempDir(), "obliance-sw-install.msi")
		resp, err := http.Get(msiUrl)
		if err != nil {
			return fmt.Errorf("msi download: %w", err)
		}
		defer resp.Body.Close()
		f, err := os.Create(tmpPath)
		if err != nil {
			return fmt.Errorf("msi temp file: %w", err)
		}
		_, err = io.Copy(f, resp.Body)
		f.Close()
		if err != nil {
			os.Remove(tmpPath)
			return fmt.Errorf("msi download write: %w", err)
		}
		msiPath = tmpPath
		defer os.Remove(tmpPath)
	} else {
		// Local or UNC path.
		msiPath = msiUrl
	}

	// Default params if none specified: /quiet /norestart
	if params == "" {
		params = "/quiet /norestart"
	}

	args := []string{"/i", msiPath}
	for _, p := range strings.Fields(params) {
		args = append(args, p)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	out, err := runInstallCmd(ctx, "msiexec", args...)
	if ctx.Err() == context.DeadlineExceeded {
		return fmt.Errorf("msi install timed out after 30 minutes")
	}
	if err != nil {
		return fmt.Errorf("msi install: %w\n%s", err, string(out))
	}
	log.Printf("MSI install complete: %s", strings.TrimSpace(string(out)))
	return nil
}

func uninstallMsiPackage(msiUrl, params string) error {
	// For uninstall, msiUrl can be a product GUID or MSI path.
	if msiUrl == "" {
		return fmt.Errorf("msi uninstall: no MSI URL/GUID provided")
	}
	if params == "" {
		params = "/quiet /norestart"
	}
	args := []string{"/x", msiUrl}
	for _, p := range strings.Fields(params) {
		args = append(args, p)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	out, err := runInstallCmd(ctx, "msiexec", args...)
	if ctx.Err() == context.DeadlineExceeded {
		return fmt.Errorf("msi uninstall timed out after 30 minutes")
	}
	if err != nil {
		return fmt.Errorf("msi uninstall: %w\n%s", err, string(out))
	}
	log.Printf("MSI uninstall complete: %s", strings.TrimSpace(string(out)))
	return nil
}

// runCustomScript runs an inline script via PowerShell (Windows) or bash (Linux/macOS).
func runCustomScript(ctx context.Context, script string) ([]byte, error) {
	switch runtime.GOOS {
	case "windows":
		return runPSContext(ctx, script)
	default:
		return runInstallCmd(ctx, "bash", "-c", script)
	}
}

// ── Repo package download ────────────────────────────────────────────────────

// downloadRepoPackage downloads a software repo package from the server using
// agent API key authentication. Returns the local path to the downloaded file.
func downloadRepoPackage(cfg *Config, repoPackageUuid string) (string, error) {
	url := cfg.ServerURL + "/api/agent/software-repo/" + repoPackageUuid
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("download: server returned %d", resp.StatusCode)
	}

	tmpPath := filepath.Join(os.TempDir(), "obliance-repo-"+repoPackageUuid+".msi")
	f, err := os.Create(tmpPath)
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	_, err = io.Copy(f, resp.Body)
	f.Close()
	if err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("write temp file: %w", err)
	}

	log.Printf("Downloaded repo package %s to %s", repoPackageUuid, tmpPath)
	return tmpPath, nil
}

// ── Server reporting ─────────────────────────────────────────────────────────

func postSoftwareComplianceResults(listId int, results []SoftwareComplianceEntryResult, score float64, cfg *Config) {
	payload := map[string]interface{}{
		"listId":   listId,
		"results":  results,
		"score":    score,
		"platform": runtime.GOOS,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("postSoftwareComplianceResults: marshal error: %v", err)
		return
	}
	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/software-compliance", bytes.NewReader(data))
	if err != nil {
		log.Printf("postSoftwareComplianceResults: request error: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("postSoftwareComplianceResults: HTTP error: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("postSoftwareComplianceResults: server returned %d", resp.StatusCode)
	}
}
