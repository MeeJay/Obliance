package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/getlantern/systray"
)

//go:embed icon_normal.ico
var iconNormal []byte

//go:embed icon_privacy.ico
var iconPrivacy []byte

//go:embed icon_disconnected.ico
var iconDisconnected []byte

// ── Privacy state (shared with agent service via file) ──────────────────────

type privacyState struct {
	Enabled   bool   `json:"enabled"`
	ChangedAt string `json:"changedAt"`
	ChangedBy string `json:"changedBy"`
}

var (
	configDir   string
	privacyFile string
	versionFile string
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
	privacyFile = filepath.Join(configDir, "privacy.json")
	versionFile = filepath.Join(configDir, "config.json")
}

func readPrivacy() privacyState {
	data, err := os.ReadFile(privacyFile)
	if err != nil {
		return privacyState{}
	}
	var s privacyState
	json.Unmarshal(data, &s)
	return s
}

func writePrivacy(enabled bool, by string) {
	s := privacyState{
		Enabled:   enabled,
		ChangedAt: time.Now().UTC().Format(time.RFC3339),
		ChangedBy: by,
	}
	data, _ := json.MarshalIndent(s, "", "  ")
	os.WriteFile(privacyFile, data, 0644)
}

func readAgentVersion() string {
	data, err := os.ReadFile(versionFile)
	if err != nil {
		return "?"
	}
	var cfg struct {
		AgentVersion string `json:"agentVersion"`
	}
	json.Unmarshal(data, &cfg)
	if cfg.AgentVersion == "" {
		return "?"
	}
	return cfg.AgentVersion
}

func readOblireachVersion() string {
	// Oblireach stores its data in ProgramData\OblireachAgent (Windows)
	// or /etc/oblireach-agent (Linux/macOS).
	var reachDataDir, reachBinDir string
	if runtime.GOOS == "windows" {
		programData := os.Getenv("PROGRAMDATA")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		reachDataDir = filepath.Join(programData, "OblireachAgent")
		reachBinDir = filepath.Join(os.Getenv("ProgramFiles"), "ObliReachAgent")
	} else {
		reachDataDir = "/etc/oblireach-agent"
		reachBinDir = "/etc/oblireach-agent"
	}

	// Check if the binary exists
	exeName := "oblireach-agent"
	if runtime.GOOS == "windows" {
		exeName = "oblireach-agent.exe"
	}
	if _, err := os.Stat(filepath.Join(reachBinDir, exeName)); os.IsNotExist(err) {
		return "" // not installed
	}

	// Primary: read version.txt written by the agent on startup
	if data, err := os.ReadFile(filepath.Join(reachDataDir, "version.txt")); err == nil {
		v := strings.TrimSpace(string(data))
		if v != "" && v != "dev" {
			return v
		}
	}

	// Fallback: read VERSION file next to the binary (MSI installs it)
	if data, err := os.ReadFile(filepath.Join(reachBinDir, "VERSION")); err == nil {
		v := strings.TrimSpace(string(data))
		if v != "" && v != "dev" {
			return v
		}
	}

	return ""
}

func isAgentServiceRunning() bool {
	if runtime.GOOS != "windows" {
		return false
	}
	out, err := hiddenCmd("sc", "query", "OblianceAgent").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "RUNNING")
}

// showToast displays a Windows toast notification.
func showToast(title, message string) {
	if runtime.GOOS != "windows" {
		return
	}
	// Use PowerShell with Windows.UI.Notifications (built-in, no module needed).
	script := fmt.Sprintf(`
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>%s</text>
      <text>%s</text>
    </binding>
  </visual>
</toast>
"@
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Obliance Agent").Show($toast)
`, escapeXML(title), escapeXML(message))
	cmd := hiddenCmd("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Run()
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}

// ── Tray ────────────────────────────────────────────────────────────────────

var (
	mVersion *systray.MenuItem
	mStatus  *systray.MenuItem
	mPrivacy *systray.MenuItem
)

func main() {
	// Single-instance guard: prevent multiple tray apps from running.
	if !acquireSingleInstanceLock() {
		// Another instance is already running — exit silently.
		os.Exit(0)
	}
	systray.Run(onReady, onExit)
}

func onReady() {
	systray.SetIcon(iconNormal)
	systray.SetTooltip("Obliance Agent")

	version := readAgentVersion()
	mVersion = systray.AddMenuItem("Obliance Agent v"+version, "")
	mVersion.Disable()

	reachVersion := readOblireachVersion()
	if reachVersion != "" {
		mReachVersion := systray.AddMenuItem("Oblireach Agent v"+reachVersion, "")
		mReachVersion.Disable()
	} else {
		// Binary exists but version unknown — check if installed at all
		var reachDir string
		if runtime.GOOS == "windows" {
			reachDir = filepath.Join(os.Getenv("ProgramFiles"), "ObliReachAgent")
		} else {
			reachDir = "/etc/oblireach-agent"
		}
		exeName := "oblireach-agent"
		if runtime.GOOS == "windows" {
			exeName = "oblireach-agent.exe"
		}
		if _, err := os.Stat(filepath.Join(reachDir, exeName)); err == nil {
			mReachVersion := systray.AddMenuItem("Oblireach Agent (version unknown)", "")
			mReachVersion.Disable()
		}
	}

	mStatus = systray.AddMenuItem("Status: checking...", "")
	mStatus.Disable()

	systray.AddSeparator()

	mPrivacy = systray.AddMenuItem("Privacy Mode: OFF", "Toggle privacy mode")

	systray.AddSeparator()

	mQuit := systray.AddMenuItem("Quit", "Close tray icon")

	// Initial state
	refreshState()

	// Watch for file changes and menu clicks
	go watchLoop()

	go func() {
		for {
			select {
			case <-mPrivacy.ClickedCh:
				state := readPrivacy()
				newEnabled := !state.Enabled
				writePrivacy(newEnabled, "user")
				refreshState()
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func onExit() {}

// isPrivacyLocked returns true when the privacy file is read-only.
func isPrivacyLocked() bool {
	info, err := os.Stat(privacyFile)
	if err != nil {
		return false
	}
	return info.Mode().Perm()&0200 == 0
}

func refreshState() {
	state := readPrivacy()
	locked := isPrivacyLocked()
	running := isAgentServiceRunning()

	// Icon priority: disconnected (grey) > privacy (orange) > normal (red)
	if !running {
		systray.SetIcon(iconDisconnected)
	} else if state.Enabled {
		systray.SetIcon(iconPrivacy)
	} else {
		systray.SetIcon(iconNormal)
	}

	if state.Enabled {
		if locked {
			systray.SetTooltip("Obliance Agent — Privacy Mode ON (locked)")
			mPrivacy.SetTitle("Privacy Mode: ON  (locked)")
			mPrivacy.Disable()
		} else {
			systray.SetTooltip("Obliance Agent — Privacy Mode ON")
			mPrivacy.SetTitle("Privacy Mode: ON  (click to disable)")
			mPrivacy.Enable()
		}
	} else {
		if locked {
			systray.SetTooltip("Obliance Agent — Privacy Mode OFF (locked)")
			mPrivacy.SetTitle("Privacy Mode: OFF  (locked)")
			mPrivacy.Disable()
		} else {
			systray.SetTooltip("Obliance Agent")
			mPrivacy.SetTitle("Privacy Mode: OFF  (click to enable)")
			mPrivacy.Enable()
		}
	}

	if running {
		mStatus.SetTitle("Status: Connected")
	} else {
		mStatus.SetTitle("Status: Disconnected")
	}
}

// watchLoop polls privacy.json for changes (e.g., remote disable) and refreshes UI.
func watchLoop() {
	var lastMod time.Time
	var lastEnabled bool

	for {
		time.Sleep(2 * time.Second)

		info, err := os.Stat(privacyFile)
		if err != nil {
			continue
		}
		if info.ModTime().Equal(lastMod) {
			continue
		}
		lastMod = info.ModTime()

		state := readPrivacy()
		refreshState()

		// If privacy was just disabled remotely, show a toast.
		if lastEnabled && !state.Enabled && state.ChangedBy == "remote" {
			showToast("Obliance Agent", "Privacy mode has been disabled by your administrator.")
		}
		lastEnabled = state.Enabled
	}
}

// Icons are embedded from .ico files via //go:embed directives at the top.
// icon_normal.ico     = Obliance "O" logo (red gradient)
// icon_privacy.ico    = Obliance "O" logo (orange)
// icon_disconnected.ico = Obliance "O" logo (grey)

func init() {
	// Ensure log output goes somewhere visible on Windows.
	logFile := filepath.Join(configDir, "tray.log")
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		log.SetOutput(f)
	}
}
