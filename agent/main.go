package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// agentVersion is injected at build time via:
//   go build -ldflags="-X main.agentVersion=x.y.z"
// The agent/VERSION file is the single source of truth — no need to edit this file.
var agentVersion = "dev"

var (
	configDir  string
	configFile string
)

func init() {
	if runtime.GOOS == "windows" {
		programData := os.Getenv("PROGRAMDATA")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		configDir = filepath.Join(programData, "OblianceAgent")
	} else {
		configDir = "/etc/obliance-agent"
	}
	configFile = filepath.Join(configDir, "config.json")
}

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	ServerURL               string `json:"serverUrl"`
	APIKey                  string `json:"apiKey"`
	DeviceUUID              string `json:"deviceUuid"`
	CheckIntervalSeconds    int    `json:"checkIntervalSeconds"`
	ScanIntervalSeconds     int    `json:"scanIntervalSeconds,omitempty"`      // 0 = disabled
	TaskRetrieveDelaySec    int    `json:"taskRetrieveDelaySeconds,omitempty"` // command-poll interval (default 10)
	RemediationEnabled      bool   `json:"remediationEnabled"`                // false = skip auto-remediation
	AgentVersion            string `json:"agentVersion"`
	BackoffUntil            int64  `json:"-"` // never persisted — in-memory only
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

// setupConfig loads or creates config from file, registry (Windows), or CLI flags.
func setupConfig(urlArg, keyArg string) *Config {
	cfg, err := loadConfig()
	if err != nil {
		// No config file — try Windows registry as fallback
		regCfg, regErr := loadConfigFromRegistry()
		if regErr == nil {
			cfg = regCfg
		}
	}

	if cfg == nil {
		if urlArg == "" || keyArg == "" {
			fmt.Fprintf(os.Stderr, "First run: provide --url <serverUrl> --key <apiKey>\n")
			fmt.Fprintf(os.Stderr, "Example: obliance-agent --url https://obliance.example.com --key your-api-key\n")
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
		} else {
			log.Printf("First run: config saved to %s", configFile)
		}
	}

	// CLI flags override config file (useful for updates)
	if urlArg != "" {
		cfg.ServerURL = strings.TrimRight(urlArg, "/")
	}
	if keyArg != "" {
		cfg.APIKey = keyArg
	}

	// Auto-upgrade http:// → https:// (MSI upgrades may reinstall with the
	// original URL scheme; normalising here breaks the cycle permanently).
	if strings.HasPrefix(cfg.ServerURL, "http://") {
		cfg.ServerURL = "https://" + cfg.ServerURL[len("http://"):]
		log.Printf("ServerURL normalised to https://")
	}
	cfg.ServerURL = strings.TrimRight(cfg.ServerURL, "/")

	cfg.DeviceUUID = resolveDeviceUUID(cfg.DeviceUUID)
	if cfg.DeviceUUID != "" {
		_ = saveConfig(cfg)
	}
	if cfg.CheckIntervalSeconds == 0 {
		cfg.CheckIntervalSeconds = 60
	}
	if cfg.TaskRetrieveDelaySec == 0 {
		cfg.TaskRetrieveDelaySec = 10
	}
	// Always use the binary's built-in version (overrides stale config.json value).
	// Save back to disk so config.json stays accurate after an update.
	if cfg.AgentVersion != agentVersion {
		cfg.AgentVersion = agentVersion
		if err := saveConfig(cfg); err != nil {
			log.Printf("Warning: could not update agentVersion in config: %v", err)
		} else {
			log.Printf("Agent version updated to %s in config", agentVersion)
		}
	}

	return cfg
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func generateUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant bits
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ── Version comparison ────────────────────────────────────────────────────────

// parseSemver parses a "MAJOR.MINOR.PATCH" string (leading "v" is stripped).
// Returns (0,0,0) on any parse error so malformed versions are treated as
// lower than any real version.
func parseSemver(v string) (int, int, int) {
	v = strings.TrimPrefix(v, "v")
	parts := strings.SplitN(v, ".", 3)
	if len(parts) != 3 {
		return 0, 0, 0
	}
	major, _ := strconv.Atoi(parts[0])
	minor, _ := strconv.Atoi(parts[1])
	patch, _ := strconv.Atoi(parts[2])
	return major, minor, patch
}

// isStrictlyNewer returns true only when remote is strictly greater than current.
func isStrictlyNewer(remote, current string) bool {
	rMaj, rMin, rPatch := parseSemver(remote)
	cMaj, cMin, cPatch := parseSemver(current)
	if rMaj != cMaj {
		return rMaj > cMaj
	}
	if rMin != cMin {
		return rMin > cMin
	}
	return rPatch > cPatch
}

// ── Auto-update ───────────────────────────────────────────────────────────────

// checkForUpdate calls GET /api/agent/version once (at startup) and delegates
// to applyUpdateIfNewer. During normal operation the version is piggybacked
// on every push response, so this startup check just handles the initial boot.
func checkForUpdate(cfg *Config) {
	type versionResponse struct {
		Version string `json:"version"`
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(cfg.ServerURL + "/api/agent/version")
	if err != nil {
		log.Printf("Auto-update: version check failed: %v", err)
		return
	}
	defer resp.Body.Close()

	var info versionResponse
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil || info.Version == "" {
		return
	}

	applyUpdateIfNewer(cfg, info.Version)
}

// verifyFileSHA256 checks the SHA-256 of a downloaded file against the expected hash.
func verifyFileSHA256(filePath, expectedHash string) bool {
	if expectedHash == "" {
		return true // no hash provided — skip check
	}
	f, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false
	}
	actual := hex.EncodeToString(h.Sum(nil))
	return actual == expectedHash
}

// updateMu prevents concurrent auto-update attempts. Multiple goroutines
// (checkForUpdate, commandPoller, push) may call applyUpdateIfNewer at the
// same time; without this guard they race on the same temp files and schtasks
// entry, causing one goroutine to delete the MSI that the other's batch
// script needs — silently breaking the update.
var updateMu sync.Mutex
var updateInProgress bool

// applyUpdateIfNewer downloads and applies an update when remoteVersion is
// strictly newer than the running agentVersion. Safe to call from push()
// (periodic) and checkForUpdate (startup) — exits/restarts if an update is
// applied, returns immediately if already up to date or on any error.
func applyUpdateIfNewer(cfg *Config, remoteVersion string) {
	if !isStrictlyNewer(remoteVersion, agentVersion) {
		return
	}

	updateMu.Lock()
	if updateInProgress {
		updateMu.Unlock()
		return
	}
	updateInProgress = true
	updateMu.Unlock()

	// Reset flag on failure so the next push cycle can retry.
	defer func() {
		updateMu.Lock()
		updateInProgress = false
		updateMu.Unlock()
	}()

	log.Printf("Auto-update: new version available %s → %s, downloading...", agentVersion, remoteVersion)

	// Notify the server we are about to go offline for an update.
	// This sets the "UPDATING" badge in the UI and suppresses offline alerts
	// for up to 10 minutes, so admins are not paged during a routine update.
	notifyServerUpdating(cfg)

	// On Windows we download the full MSI so that the installer handles
	// service registration and other setup. On other platforms we download the bare binary.
	var filename string
	if runtime.GOOS == "windows" {
		filename = "obliance-agent.msi"
	} else {
		filename = fmt.Sprintf("obliance-agent-%s-%s", runtime.GOOS, runtime.GOARCH)
	}

	client := &http.Client{Timeout: 120 * time.Second} // larger timeout for MSI download
	dlResp, err := client.Get(cfg.ServerURL + "/api/agent/download/" + filename)
	if err != nil {
		log.Printf("Auto-update: download request failed: %v", err)
		return
	}
	defer dlResp.Body.Close()
	if dlResp.StatusCode != 200 {
		log.Printf("Auto-update: download failed (HTTP %d)", dlResp.StatusCode)
		return
	}

	if runtime.GOOS == "windows" {
		// Save MSI to a temp path — it does not need to be next to the exe.
		msiPath := filepath.Join(os.TempDir(), "obliance-agent.msi")
		f, err := os.OpenFile(msiPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			log.Printf("Auto-update: cannot write MSI temp file: %v", err)
			return
		}
		written, err := io.Copy(f, dlResp.Body)
		if err != nil {
			f.Close()
			os.Remove(msiPath)
			log.Printf("Auto-update: MSI download write error: %v", err)
			return
		}
		f.Close()
		if dlResp.ContentLength > 0 && written != dlResp.ContentLength {
			os.Remove(msiPath)
			log.Printf("Auto-update: MSI download truncated (%d/%d bytes) — skipping", written, dlResp.ContentLength)
			return
		}
		// Verify integrity via SHA-256 hash from server
		expectedHash := dlResp.Header.Get("X-Content-SHA256")
		if !verifyFileSHA256(msiPath, expectedHash) {
			os.Remove(msiPath)
			log.Printf("Auto-update: MSI hash mismatch — download corrupted, skipping")
			return
		}

		// Launch msiexec via a detached batch script — the script outlives the
		// service process. msiexec will stop the service, install the new version,
		// then restart it.
		if err := applyWindowsMSIUpdate(msiPath, cfg.ServerURL, cfg.APIKey); err != nil {
			os.Remove(msiPath)
			log.Printf("Auto-update: Windows MSI update failed: %v", err)
			return
		}
	} else {
		// Unix: write the new binary then atomically rename it over the running one.
		exePath, err := os.Executable()
		if err != nil {
			log.Printf("Auto-update: cannot resolve executable path: %v", err)
			return
		}
		tmpPath := exePath + ".new"
		f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
		if err != nil {
			log.Printf("Auto-update: cannot write temp file: %v", err)
			return
		}
		written, err := io.Copy(f, dlResp.Body)
		if err != nil {
			f.Close()
			os.Remove(tmpPath)
			log.Printf("Auto-update: download write error: %v", err)
			return
		}
		f.Close()
		// Verify download is complete — a truncated binary causes SEGV on exec.
		if dlResp.ContentLength > 0 && written != dlResp.ContentLength {
			os.Remove(tmpPath)
			log.Printf("Auto-update: download truncated (%d/%d bytes) — skipping", written, dlResp.ContentLength)
			return
		}
		// Verify integrity via SHA-256 hash from server
		expectedHash := dlResp.Header.Get("X-Content-SHA256")
		if !verifyFileSHA256(tmpPath, expectedHash) {
			os.Remove(tmpPath)
			log.Printf("Auto-update: binary hash mismatch — download corrupted, skipping")
			return
		}
		if err := os.Rename(tmpPath, exePath); err != nil {
			os.Remove(tmpPath)
			log.Printf("Auto-update: rename failed: %v", err)
			return
		}
		log.Printf("Auto-update: updated to v%s, restarting...", remoteVersion)
		// Unix: exec into the new binary in-place (same PID, works without a service manager).
		restartWithNewBinary(exePath)
		return // not reached; restartWithNewBinary always exits
	}

	// Windows: the detached batch script handles the restart via msiexec.
	// Exit here so the exe file is unlocked before msiexec tries to overwrite it.
	log.Printf("Auto-update: MSI update to v%s initiated — service will restart shortly...", remoteVersion)
	restartWithNewBinary("") // Windows version ignores the argument and calls os.Exit(0)
}

// applyWindowsMSIUpdate launches a detached batch script that runs msiexec
// silently. The script is used instead of calling msiexec directly so that it
// outlives the service process (the agent exits immediately after Start()).
//
// msiexec /quiet handles the full install sequence:
//  1. Stop the OblianceAgent service (WiX <ServiceControl Stop="both">)
//  2. Overwrite obliance-agent.exe and any other packaged files
//  3. Restart the OblianceAgent service with the new binary
//
// SERVERURL and APIKEY are forwarded so that the service arguments in the MSI
// are populated even when config.json already exists (belt-and-suspenders).
func applyWindowsMSIUpdate(msiPath, serverURL, apiKey string) error {
	logPath := filepath.Join(os.TempDir(), "obliance-update.log")
	// Write the update script inside the agent install dir (not %TEMP%) to avoid
	// SIGMA rule "Scheduled Task with Batch Script in Suspicious Location".
	scriptPath := `C:\Program Files\OblianceAgent\obliance-msi-update.bat`

	// Batch script with:
	//  - 5s initial wait (service needs time to fully stop)
	//  - Retry loop for error 1618 (another msiexec in progress)
	//  - Recovery: if service disappeared (partial MajorUpgrade), recreate it
	//  - Final check: ensure service is running regardless of MSI exit code
	exePath := `C:\Program Files\OblianceAgent\obliance-agent.exe`
	script := fmt.Sprintf(
		"@echo off\r\n"+
			"ping -n 6 127.0.0.1 >nul\r\n"+
			"set RETRIES=0\r\n"+
			":RETRY\r\n"+
			"msiexec /i \"%s\" /quiet /norestart SERVERURL=\"%s\" APIKEY=\"%s\" /l*v \"%s\"\r\n"+
			"set MSI_EXIT=%%ERRORLEVEL%%\r\n"+
			"if %%MSI_EXIT%%==1618 (\r\n"+
			"  set /a RETRIES+=1\r\n"+
			"  if %%RETRIES%% LSS 5 (\r\n"+
			"    ping -n 31 127.0.0.1 >nul\r\n"+
			"    goto RETRY\r\n"+
			"  )\r\n"+
			")\r\n"+
			"ping -n 6 127.0.0.1 >nul\r\n"+
			"sc query OblianceAgent >nul 2>&1\r\n"+
			"if %%ERRORLEVEL%% NEQ 0 (\r\n"+
			"  if exist \"%s\" (\r\n"+
			"    sc create OblianceAgent binPath= \"\\\"%s\\\"\" start= auto obj= LocalSystem\r\n"+
			"    sc description OblianceAgent \"Obliance Monitoring Agent\"\r\n"+
			"    sc failure OblianceAgent reset= 86400 actions= restart/60000/restart/60000/restart/60000\r\n"+
			"  )\r\n"+
			")\r\n"+
			"net start OblianceAgent >nul 2>&1\r\n"+
			"del /q \"%s\"\r\n"+
			"schtasks /delete /tn OblianceUpdate /f >nul 2>&1\r\n"+
			"del /q \"%%~f0\"\r\n",
		msiPath, serverURL, apiKey, logPath, exePath, exePath, msiPath)
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return fmt.Errorf("write MSI update script: %w", err)
	}

	// Use a scheduled task to run the batch script directly (no cmd.exe /c wrapper)
	// from the agent install dir to avoid EDR/SIGMA rules flagging bat execution
	// from TEMP directories or cmd.exe wrappers in scheduled tasks.
	// Delete any stale task first.
	newCmd("schtasks", "/delete", "/tn", "OblianceUpdate", "/f").Run()
	if err := newCmd("schtasks",
		"/create", "/tn", "OblianceUpdate",
		"/tr", scriptPath,
		"/sc", "once",
		"/st", "00:00",
		"/ru", "SYSTEM",
		"/rl", "HIGHEST",
		"/f",
	).Run(); err != nil {
		return fmt.Errorf("schtasks create: %w", err)
	}
	if err := newCmd("schtasks", "/run", "/tn", "OblianceUpdate").Run(); err != nil {
		return fmt.Errorf("schtasks run: %w", err)
	}
	return nil
}

// ── Main loop ─────────────────────────────────────────────────────────────────

var backoffSteps = []int{5 * 60, 10 * 60, 30 * 60, 60 * 60}
var backoffLevel = 0

// runScanAll triggers an automatic scan of inventory, updates, and compliance
// by dispatching synthetic commands through the dispatcher.  The ACKs are
// accumulated and sent on the next push cycle.  If the server-side command IDs
// don't exist in the DB the server simply ignores the unknown ACKs.
func runScanAll(cfg *Config) {
	if dispatcher == nil {
		return
	}
	log.Printf("Periodic Scan All triggered")
	for _, t := range []string{"scan_inventory", "scan_updates", "check_compliance", "list_services"} {
		// Use a proper UUID so the server can process the ACKs without a
		// "invalid input syntax for type uuid" PostgreSQL error. The ID won't
		// match any row in command_queue (it's synthetic) so the server will
		// simply do a no-op UPDATE, which is the intended behaviour.
		dispatcher.HandleCommand(AgentCommand{ID: generateUUID(), Type: t})
	}
}

func mainLoop(cfg *Config) {
	log.Printf("Obliance Agent v%s starting", cfg.AgentVersion)
	log.Printf("Server: %s", cfg.ServerURL)
	log.Printf("Device UUID: %s", cfg.DeviceUUID)



	// Load privacy mode state from disk and start watching for tray changes.
	loadPrivacyState()
	privacyStopCh := make(chan struct{})
	go watchPrivacyFile(privacyStopCh)

	// Ensure the tray icon process is running in each active user session.
	trayStopCh := make(chan struct{})
	go watchTrayLoop(trayStopCh)

	// Initialise the command dispatcher used by push() to dispatch commands
	// received in push responses and to accumulate acks for the next push.
	dispatcher = NewCommandDispatcher(cfg.DeviceUUID, cfg.APIKey, cfg.ServerURL, cfg.RemediationEnabled)

	// Start the persistent command channel — keeps a long-lived WebSocket open
	// so the server can push commands instantly (e.g. open_remote_tunnel)
	// instead of waiting for the next poll cycle (up to 60 s).
	go runCommandChannel(dispatcher, cfg.ServerURL, cfg.APIKey)

	// Check for a newer version before starting the command poller.
	// On Linux/macOS: atomic rename + exit (service manager restarts with new binary).
	// On Windows: writes %TEMP%\obliance-update.bat, exits; batch stops service,
	//             moves new exe in place, restarts service.
	checkForUpdate(cfg)

	// Start the dedicated command-poll goroutine — fallback for when the
	// command channel is temporarily down.  Polls GET /api/agent/commands
	// at cfg.TaskRetrieveDelaySec rate (default 10 s, admin-configurable).
	go runCommandPoller(cfg)

	// Periodic scan goroutine — wakes up every minute and triggers a full scan
	// when cfg.ScanIntervalSeconds seconds have elapsed since the last scan.
	go func() {
		lastScan := time.Time{} // zero = never scanned
		for {
			time.Sleep(60 * time.Second)
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("PANIC in periodic scan: %v", r)
					}
				}()
				secs := cfg.ScanIntervalSeconds
				if secs <= 0 {
					return // disabled
				}
				if time.Since(lastScan) >= time.Duration(secs)*time.Second {
					runScanAll(cfg)
					lastScan = time.Now()
				}
			}()
		}
	}()

	// Service watcher goroutine — periodically collects the service list and
	// POSTs it to the server so the UI stays live without any user action.
	// It also detects external changes (user restarting a service via services.msc,
	// systemctl, launchctl, etc.) because it compares states between rounds.
	// Interval: 30s on Linux/macOS (fast), 90s on Windows (PowerShell overhead).
	go func() {
		// Initial delay — let the agent fully register before the first collect.
		time.Sleep(20 * time.Second)
		watchInterval := 30 * time.Second
		if runtime.GOOS == "windows" {
			watchInterval = 90 * time.Second
		}
		for {
			if dispatcher != nil {
				dispatcher.collectAndPostServices()
			}
			time.Sleep(watchInterval)
		}
	}()

	for {
		now := time.Now().UnixMilli()
		if cfg.BackoffUntil > 0 && now < cfg.BackoffUntil {
			waitSec := (cfg.BackoffUntil - now) / 1000
			if waitSec > 60 {
				waitSec = 60
			}
			log.Printf("In backoff period, waiting %ds...", waitSec)
			time.Sleep(time.Duration(waitSec) * time.Second)
			continue
		}

		push(cfg)
		time.Sleep(time.Duration(cfg.CheckIntervalSeconds) * time.Second)
	}
}

// ── Entry point ───────────────────────────────────────────────────────────────

func main() {
	urlFlag := flag.String("url", "", "Server URL (required on first run)")
	keyFlag := flag.String("key", "", "API key (required on first run)")
	flag.Parse()

	// On Windows: detect service mode and hand off to SCM handler.
	// On Linux: runAsService is a no-op that returns immediately.
	if runAsService(urlFlag, keyFlag) {
		return
	}

	// Interactive / Linux mode
	cfg := setupConfig(*urlFlag, *keyFlag)
	mainLoop(cfg)
}
