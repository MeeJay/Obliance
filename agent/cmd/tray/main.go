package main

import (
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

// Icon byte slices are populated by platform-specific files:
//   icons_windows.go → embeds .ico (Windows uses ICO natively)
//   icons_unix.go    → embeds .png (macOS NSImage / Linux GTK use PNG)
// Declared here as vars so refreshState() can reference them directly.
var (
	iconNormal       []byte // green — connected, all good
	iconPrivacy      []byte // orange — privacy mode active
	iconDisconnected []byte // grey — service not running
	iconRemote       []byte // red — ObliReach remote session active
	iconAirgap       []byte // blue — airgap mode (network isolated)
)

// ── State files (shared with agent service via ProgramData) ──────────────────

type privacyState struct {
	Enabled   bool   `json:"enabled"`
	ChangedAt string `json:"changedAt"`
	ChangedBy string `json:"changedBy"`
}

type remoteSessionState struct {
	Active    bool   `json:"active"`
	Protocol  string `json:"protocol,omitempty"`
	StartedAt string `json:"startedAt,omitempty"`
	StartedBy string `json:"startedBy,omitempty"`
}

type airgapState struct {
	Enabled   bool   `json:"enabled"`
	ChangedAt string `json:"changedAt"`
	ChangedBy string `json:"changedBy"`
}

var (
	configDir         string
	privacyFile       string
	remoteSessionFile string
	airgapFile        string
	versionFile       string
)

func init() {
	if runtime.GOOS == "windows" {
		programData := os.Getenv("PROGRAMDATA")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		configDir = filepath.Join(programData, "OblianceAgent")
	} else {
		// macOS + Linux: matches agent/main.go init() so tray reads the
		// same files the daemon writes. privacy.json is created with mode
		// 0666 by the daemon so the user-session tray can toggle it.
		configDir = "/etc/obliance-agent"
	}
	privacyFile = filepath.Join(configDir, "privacy.json")
	remoteSessionFile = filepath.Join(configDir, "remote-session.json")
	airgapFile = filepath.Join(configDir, "airgap.json")
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
	os.WriteFile(privacyFile, data, 0666)
}

func readRemoteSession() remoteSessionState {
	data, err := os.ReadFile(remoteSessionFile)
	if err != nil {
		return remoteSessionState{}
	}
	var s remoteSessionState
	json.Unmarshal(data, &s)
	return s
}

func readAirgap() airgapState {
	data, err := os.ReadFile(airgapFile)
	if err != nil {
		return airgapState{}
	}
	var s airgapState
	json.Unmarshal(data, &s)
	return s
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
	var reachDataDir, reachBinDir string
	switch runtime.GOOS {
	case "windows":
		programData := os.Getenv("PROGRAMDATA")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		reachDataDir = filepath.Join(programData, "OblireachAgent")
		reachBinDir = filepath.Join(os.Getenv("ProgramFiles"), "ObliReachAgent")
	case "darwin":
		reachDataDir = "/Library/Application Support/Oblireach"
		reachBinDir = "/usr/local/oblireach-agent"
	default:
		reachDataDir = "/etc/oblireach-agent"
		reachBinDir = "/etc/oblireach-agent"
	}

	exeName := "oblireach-agent"
	if runtime.GOOS == "windows" {
		exeName = "oblireach-agent.exe"
	}
	if _, err := os.Stat(filepath.Join(reachBinDir, exeName)); os.IsNotExist(err) {
		return ""
	}

	if data, err := os.ReadFile(filepath.Join(reachDataDir, "version.txt")); err == nil {
		v := strings.TrimSpace(string(data))
		if v != "" && v != "dev" {
			return v
		}
	}

	if data, err := os.ReadFile(filepath.Join(reachBinDir, "VERSION")); err == nil {
		v := strings.TrimSpace(string(data))
		if v != "" && v != "dev" {
			return v
		}
	}

	return ""
}

func isAgentServiceRunning() bool {
	switch runtime.GOOS {
	case "windows":
		out, err := hiddenCmd("sc", "query", "OblianceAgent").Output()
		if err != nil {
			return false
		}
		return strings.Contains(string(out), "RUNNING")
	case "darwin":
		// launchctl list prints the PID in column 1 for loaded services.
		// A dash "-" means loaded but not running.
		out, err := hiddenCmd("launchctl", "list", "com.obliance.agent").Output()
		if err != nil {
			return false
		}
		// Look for "PID" = <number> in the plist-formatted output.
		s := string(out)
		return strings.Contains(s, `"PID" =`) && !strings.Contains(s, `"PID" = "-"`)
	case "linux":
		out, err := hiddenCmd("systemctl", "is-active", "obliance-agent").Output()
		if err != nil {
			return false
		}
		return strings.TrimSpace(string(out)) == "active"
	default:
		return false
	}
}

// showToast displays a native notification on the platform.
func showToast(title, message string) {
	switch runtime.GOOS {
	case "windows":
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
		hiddenCmd("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Run()

	case "darwin":
		// osascript needs escaping for quotes and backslashes inside the
		// AppleScript string literal.
		script := fmt.Sprintf(`display notification "%s" with title "%s"`,
			escapeAppleScript(message), escapeAppleScript(title))
		hiddenCmd("osascript", "-e", script).Run()

	case "linux":
		// notify-send is part of libnotify and pre-installed on most desktops.
		hiddenCmd("notify-send", title, message).Run()
	}
}

// escapeAppleScript escapes backslashes and double quotes for AppleScript string literals.
func escapeAppleScript(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
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
	if !acquireSingleInstanceLock() {
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
		var reachDir string
		switch runtime.GOOS {
		case "windows":
			reachDir = filepath.Join(os.Getenv("ProgramFiles"), "ObliReachAgent")
		case "darwin":
			reachDir = "/usr/local/oblireach-agent"
		default:
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

	refreshState()

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
	privacy := readPrivacy()
	locked := isPrivacyLocked()
	running := isAgentServiceRunning()
	remote := readRemoteSession()
	airgap := readAirgap()

	// Icon priority: airgap (blue) > remote (red) > disconnected (grey) > privacy (orange) > normal (green)
	switch {
	case airgap.Enabled:
		systray.SetIcon(iconAirgap)
		systray.SetTooltip("Obliance Agent — AIRGAP (network isolated)")
	case remote.Active:
		systray.SetIcon(iconRemote)
		tooltip := "Obliance Agent — Remote session active"
		if remote.Protocol != "" {
			tooltip += " (" + remote.Protocol + ")"
		}
		systray.SetTooltip(tooltip)
	case !running:
		systray.SetIcon(iconDisconnected)
		systray.SetTooltip("Obliance Agent — Disconnected")
	case privacy.Enabled:
		systray.SetIcon(iconPrivacy)
	default:
		systray.SetIcon(iconNormal)
		systray.SetTooltip("Obliance Agent")
	}

	// Privacy tooltip (only set if not already overridden)
	if !airgap.Enabled && !remote.Active && running && privacy.Enabled {
		if locked {
			systray.SetTooltip("Obliance Agent — Privacy Mode ON (locked)")
		} else {
			systray.SetTooltip("Obliance Agent — Privacy Mode ON")
		}
	}

	// Privacy menu item
	if privacy.Enabled {
		if locked {
			mPrivacy.SetTitle("Privacy Mode: ON  (locked)")
			mPrivacy.Disable()
		} else {
			mPrivacy.SetTitle("Privacy Mode: ON  (click to disable)")
			mPrivacy.Enable()
		}
	} else {
		if locked {
			mPrivacy.SetTitle("Privacy Mode: OFF  (locked)")
			mPrivacy.Disable()
		} else {
			mPrivacy.SetTitle("Privacy Mode: OFF  (click to enable)")
			mPrivacy.Enable()
		}
	}

	// Status line
	if airgap.Enabled {
		mStatus.SetTitle("Status: AIRGAP — Network isolated")
	} else if remote.Active {
		label := "Status: Remote session"
		if remote.Protocol != "" {
			label += " (" + remote.Protocol + ")"
		}
		mStatus.SetTitle(label)
	} else if running {
		mStatus.SetTitle("Status: Connected")
	} else {
		mStatus.SetTitle("Status: Disconnected")
	}
}

// watchLoop polls state files for changes and refreshes UI every 2 seconds.
// Service state (connected/disconnected) is checked every 10 seconds even
// without file changes, since service start/stop doesn't touch any file.
func watchLoop() {
	var lastPrivacyMod time.Time
	var lastRemoteMod time.Time
	var lastAirgapMod time.Time
	var lastPrivacyEnabled bool
	var lastRemoteActive bool
	var lastAirgapEnabled bool
	var tickCount int

	for {
		time.Sleep(2 * time.Second)
		tickCount++

		changed := false

		// Check privacy.json changes
		if info, err := os.Stat(privacyFile); err == nil {
			if !info.ModTime().Equal(lastPrivacyMod) {
				lastPrivacyMod = info.ModTime()
				changed = true
			}
		}

		// Check remote-session.json changes
		if info, err := os.Stat(remoteSessionFile); err == nil {
			if !info.ModTime().Equal(lastRemoteMod) {
				lastRemoteMod = info.ModTime()
				changed = true
			}
		}

		// Check airgap.json changes
		if info, err := os.Stat(airgapFile); err == nil {
			if !info.ModTime().Equal(lastAirgapMod) {
				lastAirgapMod = info.ModTime()
				changed = true
			}
		}

		// Periodic refresh every ~10s to catch service state changes
		if !changed && tickCount%5 == 0 {
			changed = true
		}

		if !changed {
			continue
		}

		privacy := readPrivacy()
		remote := readRemoteSession()
		airgap := readAirgap()
		refreshState()

		// Toast: privacy disabled remotely
		if lastPrivacyEnabled && !privacy.Enabled && privacy.ChangedBy == "remote" {
			showToast("Obliance Agent", "Privacy mode has been disabled by your administrator.")
		}
		lastPrivacyEnabled = privacy.Enabled

		// Toast: airgap activated/deactivated
		if !lastAirgapEnabled && airgap.Enabled {
			showToast("Obliance Agent", "AIRGAP ENABLED — This device has been network-isolated by your administrator.")
		}
		if lastAirgapEnabled && !airgap.Enabled {
			showToast("Obliance Agent", "Airgap disabled — Network access restored.")
		}
		lastAirgapEnabled = airgap.Enabled

		// Toast: remote session started
		if !lastRemoteActive && remote.Active {
			msg := "A remote session has been started"
			if remote.StartedBy != "" {
				msg += " by " + remote.StartedBy
			}
			showToast("Obliance Agent", msg)
		}
		// Toast: remote session ended
		if lastRemoteActive && !remote.Active {
			showToast("Obliance Agent", "Remote session ended.")
		}
		lastRemoteActive = remote.Active
	}
}

// Icons are embedded from .ico files via //go:embed directives at the top.
// icon_normal.ico       = Obliance "O" logo (green)  — connected, all good
// icon_privacy.ico      = Obliance "O" logo (orange) — privacy mode active
// icon_disconnected.ico = Obliance "O" logo (grey)   — service not running
// icon_remote.ico       = Obliance "O" logo (red)    — ObliReach remote session active

func init() {
	logFile := filepath.Join(configDir, "tray.log")
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		log.SetOutput(f)
	}
}
