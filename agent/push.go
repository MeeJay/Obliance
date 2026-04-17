package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ── Agent events ─────────────────────────────────────────────────────────────

// AgentEvent represents a discrete event reported to the server (e.g. boot, login).
type AgentEvent struct {
	Type      string                 `json:"type"`
	Timestamp string                 `json:"timestamp"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

var (
	pendingEvents   []AgentEvent
	pendingEventsMu sync.Mutex
)

func addEvent(eventType string, data map[string]interface{}) {
	pendingEventsMu.Lock()
	defer pendingEventsMu.Unlock()
	pendingEvents = append(pendingEvents, AgentEvent{
		Type:      eventType,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data:      data,
	})
}

func drainEvents() []AgentEvent {
	pendingEventsMu.Lock()
	defer pendingEventsMu.Unlock()
	if len(pendingEvents) == 0 {
		return nil
	}
	events := make([]AgentEvent, len(pendingEvents))
	copy(events, pendingEvents)
	pendingEvents = pendingEvents[:0]
	return events
}

// ── Push request / response types ─────────────────────────────────────────────

type pushBody struct {
	DeviceUUID            string       `json:"deviceUuid"`
	Hostname              string       `json:"hostname"`
	AgentVersion          string       `json:"agentVersion"`
	OSInfo                OSInfo       `json:"osInfo"`
	Metrics               Metrics      `json:"metrics"`
	Acks                  []CommandAck `json:"acks,omitempty"`
	IPLocal               string       `json:"ipLocal,omitempty"`
	MACAddress            string       `json:"macAddress,omitempty"`
	PrivacyMode           bool         `json:"privacyMode"`
	AirgapMode            bool         `json:"airgapMode"`
	LastLoggedInUser      string       `json:"lastLoggedInUser,omitempty"`
	DistroFamily          string       `json:"distroFamily,omitempty"`
	Events                []AgentEvent `json:"events,omitempty"`
	WatchdogRestartCount  int          `json:"watchdogRestartCount,omitempty"`
	WatchdogLastRestartAt string       `json:"watchdogLastRestartAt,omitempty"`
}

// AgentCommand is a command delivered from the server in a push response.
type AgentCommand struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"`
	Payload  map[string]interface{} `json:"payload,omitempty"`
	Priority string                 `json:"priority,omitempty"`
}

type pushResponse struct {
	Status        string `json:"status"`
	LatestVersion string `json:"latestVersion,omitempty"` // piggybacked version info
	Config        *struct {
		CheckIntervalSeconds     int  `json:"checkIntervalSeconds"`
		PushIntervalSeconds      int  `json:"pushIntervalSeconds"`
		ScanIntervalSeconds      int  `json:"scanIntervalSeconds"`
		TaskRetrieveDelaySeconds int  `json:"taskRetrieveDelaySeconds"`
		RemediationEnabled       *bool `json:"remediationEnabled,omitempty"`
	} `json:"config,omitempty"`
	Commands    []AgentCommand `json:"commands,omitempty"`
	NextPollIn  int            `json:"nextPollIn,omitempty"` // seconds
	// Legacy one-shot command field — kept for backward compatibility.
	Command string `json:"command,omitempty"`
}

var httpClient = &http.Client{Timeout: 30 * time.Second}

// ── Distro family detection ──────────────────────────────────────────────────

var (
	cachedDistroFamily string
	distroFamilyOnce   sync.Once
)

// getDistroFamily returns a normalized distribution family string.
// The value is computed once and cached for the lifetime of the process.
func getDistroFamily() string {
	distroFamilyOnce.Do(func() {
		cachedDistroFamily = detectDistroFamily()
	})
	return cachedDistroFamily
}

func detectDistroFamily() string {
	switch runtime.GOOS {
	case "windows":
		return "windows"
	case "darwin":
		return "macos"
	case "freebsd":
		return "freebsd"
	case "linux":
		return detectLinuxDistroFamily()
	default:
		return runtime.GOOS
	}
}

func detectLinuxDistroFamily() string {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return "linux"
	}
	defer f.Close()

	var distroID string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "ID=") {
			distroID = strings.Trim(strings.TrimPrefix(line, "ID="), "\"")
			break
		}
	}
	if distroID == "" {
		return "linux"
	}

	// Map known distro IDs to normalized families.
	familyMap := map[string]string{
		"ubuntu":               "debian",
		"debian":               "debian",
		"linuxmint":            "debian",
		"pop":                  "debian",
		"elementary":           "debian",
		"raspbian":             "debian",
		"centos":               "rhel",
		"rhel":                 "rhel",
		"rocky":                "rhel",
		"alma":                 "rhel",
		"oracle":               "rhel",
		"fedora":               "fedora",
		"arch":                 "arch",
		"manjaro":              "arch",
		"endeavouros":          "arch",
		"opensuse":             "suse",
		"suse":                 "suse",
		"opensuse-leap":        "suse",
		"opensuse-tumbleweed":  "suse",
	}

	if family, ok := familyMap[distroID]; ok {
		return family
	}
	return distroID
}

// dispatcher is the package-level command dispatcher shared by mainLoop and push.
var dispatcher *CommandDispatcher


func push(cfg *Config) {
	hostname, _ := os.Hostname()

	// Collect pending acks from the dispatcher (if initialised).
	var acks []CommandAck
	if dispatcher != nil {
		acks = dispatcher.GetAndClearAcks()
	}

	ipLocal, macAddress := getLocalNetworkInfo()
	// Drain watchdog restart events so they're reported alongside metrics.
	// If the push fails (non-2xx), we restore them so the next attempt
	// will carry them up.
	wdCount, wdLast := drainWatchdogRestarts()
	body := pushBody{
		DeviceUUID:            cfg.DeviceUUID,
		Hostname:              hostname,
		AgentVersion:          cfg.AgentVersion,
		OSInfo:                getOSInfo(),
		Metrics:               collectMetrics(),
		Acks:                  acks,
		IPLocal:               ipLocal,
		MACAddress:            macAddress,
		PrivacyMode:           IsPrivacyMode(),
		AirgapMode:            IsAirgapMode(),
		LastLoggedInUser:      getLastLoggedInUser(),
		DistroFamily:          getDistroFamily(),
		Events:                drainEvents(),
		WatchdogRestartCount:  wdCount,
		WatchdogLastRestartAt: wdLast,
	}

	data, err := json.Marshal(body)
	if err != nil {
		log.Printf("Push error (marshal): %v", err)
		restoreWatchdogRestarts(wdCount, wdLast)
		return
	}

	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/push", bytes.NewReader(data))
	if err != nil {
		log.Printf("Push error (request): %v", err)
		restoreWatchdogRestarts(wdCount, wdLast)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)

	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("Push error: %v", err)
		restoreWatchdogRestarts(wdCount, wdLast)
		return
	}
	defer resp.Body.Close()

	var result pushResponse
	_ = json.NewDecoder(resp.Body).Decode(&result)

	switch resp.StatusCode {
	case 200:
		backoffLevel = 0
		cfg.BackoffUntil = 0

		// Update poll interval from response — prefer nextPollIn, fall back to config field.
		if result.NextPollIn > 0 && result.NextPollIn != cfg.CheckIntervalSeconds {
			cfg.CheckIntervalSeconds = result.NextPollIn
			_ = saveConfig(cfg)
			log.Printf("Check interval updated to %ds (nextPollIn)", cfg.CheckIntervalSeconds)
		} else if result.Config != nil {
			interval := result.Config.PushIntervalSeconds
			if interval == 0 {
				interval = result.Config.CheckIntervalSeconds
			}
			if interval > 0 && interval != cfg.CheckIntervalSeconds {
				cfg.CheckIntervalSeconds = interval
				_ = saveConfig(cfg)
				log.Printf("Check interval updated to %ds", cfg.CheckIntervalSeconds)
			}
		}
		// Always update scan interval when config is present (independent of poll interval changes).
		if result.Config != nil && result.Config.ScanIntervalSeconds != cfg.ScanIntervalSeconds {
			cfg.ScanIntervalSeconds = result.Config.ScanIntervalSeconds
			_ = saveConfig(cfg)
			log.Printf("Scan interval updated to %ds", cfg.ScanIntervalSeconds)
		}
		// Update task retrieve delay when admin changes it.
		if result.Config != nil && result.Config.TaskRetrieveDelaySeconds > 0 &&
			result.Config.TaskRetrieveDelaySeconds != cfg.TaskRetrieveDelaySec {
			cfg.TaskRetrieveDelaySec = result.Config.TaskRetrieveDelaySeconds
			_ = saveConfig(cfg)
			log.Printf("Task retrieve delay updated to %ds", cfg.TaskRetrieveDelaySec)
		}
		// Update remediation flag when admin toggles it per device.
		if result.Config != nil && result.Config.RemediationEnabled != nil {
			enabled := *result.Config.RemediationEnabled
			if enabled != cfg.RemediationEnabled {
				cfg.RemediationEnabled = enabled
				_ = saveConfig(cfg)
				log.Printf("Compliance remediation enabled: %v", enabled)
			}
			// Sync live dispatcher so in-flight compliance checks use the new flag immediately.
			if dispatcher != nil {
				dispatcher.SetRemediationEnabled(enabled)
			}
		}

		log.Printf("Push OK (acks sent: %d, commands received: %d)", len(acks), len(result.Commands))

		// Dispatch incoming commands asynchronously.
		if dispatcher != nil {
			for _, cmd := range result.Commands {
				dispatcher.HandleCommand(cmd)
			}
		}

		// Handle legacy one-shot command (e.g. "uninstall") — must be processed
		// before the version check since commands like "uninstall" call os.Exit.
		if result.Command != "" {
			log.Printf("Received legacy command from server: %s", result.Command)
			if result.Command == "uninstall" {
				handleUninstallCommand(cfg)
				return // not reached if uninstall succeeds
			}
		}

		// Version piggybacked on push response — skip update while a tunnel is
		// active so we never restart the agent mid-session.
		if result.LatestVersion != "" && activeTunnels.count() == 0 {
			applyUpdateIfNewer(cfg, result.LatestVersion)
		}

	case 202:
		log.Printf("Device pending approval...")
		if result.NextPollIn > 0 && result.NextPollIn != cfg.CheckIntervalSeconds {
			cfg.CheckIntervalSeconds = result.NextPollIn
			_ = saveConfig(cfg)
		} else if result.Config != nil {
			interval := result.Config.PushIntervalSeconds
			if interval == 0 {
				interval = result.Config.CheckIntervalSeconds
			}
			if interval > 0 && interval != cfg.CheckIntervalSeconds {
				cfg.CheckIntervalSeconds = interval
				_ = saveConfig(cfg)
			}
		}
		// Pending devices can also receive commands.
		if dispatcher != nil {
			for _, cmd := range result.Commands {
				dispatcher.HandleCommand(cmd)
			}
		}
		if result.Command != "" {
			log.Printf("Received legacy command from server: %s", result.Command)
			if result.Command == "uninstall" {
				handleUninstallCommand(cfg)
				return
			}
		}
		if result.LatestVersion != "" && activeTunnels.count() == 0 {
			applyUpdateIfNewer(cfg, result.LatestVersion)
		}

	case 401:
		idx := backoffLevel
		if idx >= len(backoffSteps) {
			idx = len(backoffSteps) - 1
		}
		backoffSecs := backoffSteps[idx]
		log.Printf("Unauthorized. Backing off for %ds...", backoffSecs)
		backoffLevel++
		cfg.BackoffUntil = time.Now().UnixMilli() + int64(backoffSecs)*1000
		_ = saveConfig(cfg)

	default:
		log.Printf("Push returned unexpected status %d", resp.StatusCode)
	}
}
