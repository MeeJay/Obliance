package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ── Types ──────────────────────────────────────────────────────────────────────

// CommandAck reports the outcome of an AgentCommand back to the server.
// It is included in the next push request's acks[] field.
type CommandAck struct {
	CommandID string      `json:"commandId"`
	Status    string      `json:"status"` // ack_running, success, failure, timeout
	Result    interface{} `json:"result,omitempty"`
}

// CommandDispatcher receives AgentCommands, executes them in background
// goroutines, and accumulates CommandAcks for the next push cycle.
type CommandDispatcher struct {
	deviceUUID  string
	apiKey      string
	serverURL   string
	pendingAcks []CommandAck
	mu          sync.Mutex
}

// NewCommandDispatcher creates a CommandDispatcher bound to the given device.
func NewCommandDispatcher(deviceUUID, apiKey, serverURL string) *CommandDispatcher {
	return &CommandDispatcher{
		deviceUUID: deviceUUID,
		apiKey:     apiKey,
		serverURL:  serverURL,
	}
}

// GetAndClearAcks returns all pending acks and resets the internal list.
// Thread-safe.
func (d *CommandDispatcher) GetAndClearAcks() []CommandAck {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.pendingAcks) == 0 {
		return nil
	}
	acks := make([]CommandAck, len(d.pendingAcks))
	copy(acks, d.pendingAcks)
	d.pendingAcks = d.pendingAcks[:0]
	return acks
}

// addAck appends an ack to the pending list. Thread-safe.
func (d *CommandDispatcher) addAck(ack CommandAck) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pendingAcks = append(d.pendingAcks, ack)
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

// HandleCommand starts a goroutine that executes cmd and accumulates acks.
// Returns immediately (non-blocking).
func (d *CommandDispatcher) HandleCommand(cmd AgentCommand) {
	log.Printf("Command received: id=%s type=%s priority=%s", cmd.ID, cmd.Type, cmd.Priority)

	// Immediately acknowledge that we are starting the work.
	d.addAck(CommandAck{
		CommandID: cmd.ID,
		Status:    "ack_running",
	})

	go d.executeCommand(cmd)
}

func (d *CommandDispatcher) executeCommand(cmd AgentCommand) {
	var result interface{}
	var execErr error

	switch cmd.Type {
	case "scan_inventory":
		result, execErr = d.handleScanInventory(cmd)

	case "scan_updates":
		result, execErr = d.handleScanUpdates(cmd)

	case "run_script":
		result, execErr = d.handleRunScript(cmd)

	case "install_update":
		result, execErr = d.handleInstallUpdate(cmd)

	case "check_compliance":
		result, execErr = d.handleCheckCompliance(cmd)

	case "open_remote_tunnel":
		result, execErr = d.handleOpenRemoteTunnel(cmd)

	case "close_remote_tunnel":
		result, execErr = d.handleCloseRemoteTunnel(cmd)

	case "reboot":
		execErr = d.handleReboot(cmd)

	case "shutdown":
		execErr = d.handleShutdown(cmd)

	case "restart_agent":
		execErr = d.handleRestartAgent(cmd)

	case "list_services":
		result, execErr = d.handleListServices(cmd)

	case "restart_service":
		result, execErr = d.handleRestartService(cmd)

	default:
		execErr = fmt.Errorf("unknown command type: %s", cmd.Type)
	}

	ack := CommandAck{CommandID: cmd.ID}
	if execErr != nil {
		log.Printf("Command %s (%s) failed: %v", cmd.ID, cmd.Type, execErr)
		ack.Status = "failure"
		ack.Result = map[string]string{"error": execErr.Error()}
	} else {
		ack.Result = result
		// For run_script: compare actual exit code against expectedExitCode from payload.
		// A mismatch means the script did not exit as expected → mark as failure but
		// still include the full ScriptResult so stdout/stderr are accessible.
		if cmd.Type == "run_script" {
			if sr, ok := result.(*ScriptResult); ok {
				expectedCode := 0
				if cmd.Payload != nil {
					if v, ok2 := cmd.Payload["expectedExitCode"].(float64); ok2 {
						expectedCode = int(v)
					}
				}
				if sr.ExitCode != expectedCode {
					log.Printf("Command %s (run_script) exit code mismatch: got %d, expected %d", cmd.ID, sr.ExitCode, expectedCode)
					ack.Status = "failure"
				} else {
					log.Printf("Command %s (%s) completed successfully (exit code %d)", cmd.ID, cmd.Type, sr.ExitCode)
					ack.Status = "success"
				}
			} else {
				log.Printf("Command %s (%s) completed successfully", cmd.ID, cmd.Type)
				ack.Status = "success"
			}
		} else {
			log.Printf("Command %s (%s) completed successfully", cmd.ID, cmd.Type)
			ack.Status = "success"
		}
	}
	d.addAck(ack)
}

// ── Command handlers ──────────────────────────────────────────────────────────

func (d *CommandDispatcher) handleScanInventory(cmd AgentCommand) (interface{}, error) {
	cfg := d.makeConfig()
	inv, err := ScanInventory()
	if err != nil {
		// Non-fatal: post what we have.
		log.Printf("Command %s: inventory scan partial error: %v", cmd.ID, err)
	}
	if inv == nil {
		return nil, fmt.Errorf("inventory scan returned no data")
	}
	if postErr := PostInventory(inv, cfg); postErr != nil {
		return nil, fmt.Errorf("post inventory: %w", postErr)
	}
	return map[string]interface{}{
		"softwareCount": len(inv.Software),
		"diskCount":     len(inv.Disks),
	}, nil
}

func (d *CommandDispatcher) handleScanUpdates(cmd AgentCommand) (interface{}, error) {
	cfg := d.makeConfig()
	updates, err := ScanUpdates()
	if err != nil {
		return nil, fmt.Errorf("scan updates: %w", err)
	}
	if postErr := PostUpdates(updates, cfg); postErr != nil {
		return nil, fmt.Errorf("post updates: %w", postErr)
	}
	return map[string]interface{}{
		"updateCount": len(updates),
	}, nil
}

func (d *CommandDispatcher) handleRunScript(cmd AgentCommand) (interface{}, error) {
	// Extract script parameters from the command payload.
	payload := cmd.Payload
	if payload == nil {
		return nil, fmt.Errorf("run_script: missing payload")
	}

	sc := ScriptCommand{
		ID:         cmd.ID,
		Parameters: make(map[string]any),
	}

	if v, ok := payload["runtime"].(string); ok {
		sc.Runtime = v
	}
	if v, ok := payload["content"].(string); ok {
		sc.Content = v
	}
	if v, ok := payload["runAs"].(string); ok {
		sc.RunAs = v
	}
	if v, ok := payload["timeoutSeconds"].(float64); ok {
		sc.TimeoutSeconds = int(v)
	}
	if params, ok := payload["parameters"].(map[string]interface{}); ok {
		for k, val := range params {
			sc.Parameters[k] = val
		}
	}

	if sc.Runtime == "" {
		return nil, fmt.Errorf("run_script: runtime not specified")
	}
	if sc.Content == "" {
		return nil, fmt.Errorf("run_script: content not specified")
	}

	scriptResult, err := ExecuteScript(sc)
	if err != nil {
		return nil, fmt.Errorf("execute script: %w", err)
	}
	return scriptResult, nil
}

func (d *CommandDispatcher) handleInstallUpdate(cmd AgentCommand) (interface{}, error) {
	payload := cmd.Payload
	if payload == nil {
		return nil, fmt.Errorf("install_update: missing payload")
	}
	uid, ok := payload["updateUid"].(string)
	if !ok || uid == "" {
		return nil, fmt.Errorf("install_update: updateUid not specified")
	}
	if err := InstallUpdate(uid); err != nil {
		return nil, err
	}
	return map[string]string{"updateUid": uid, "message": "installed successfully"}, nil
}

func (d *CommandDispatcher) handleCheckCompliance(_ AgentCommand) (interface{}, error) {
	// Collect basic compliance indicators available without additional tooling.
	results := map[string]interface{}{
		"platform": runtime.GOOS,
	}

	// Firewall status (best-effort, platform-specific).
	results["firewall"] = checkFirewallStatus()

	return results, nil
}

// checkFirewallStatus returns a simple status string without failing.
func checkFirewallStatus() string {
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive",
			"-Command",
			`(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $true} | Measure-Object).Count`).Output()
		if err == nil && len(out) > 0 {
			return "profiles_enabled:" + strings.TrimSpace(string(out))
		}
		return "unknown"
	case "linux":
		if _, err := exec.LookPath("ufw"); err == nil {
			out, _ := exec.Command("ufw", "status").Output()
			if strings.Contains(string(out), "active") {
				return "ufw:active"
			}
			return "ufw:inactive"
		}
		if _, err := exec.LookPath("firewalld"); err == nil {
			out, _ := exec.Command("firewall-cmd", "--state").Output()
			return "firewalld:" + strings.TrimSpace(string(out))
		}
		return "unknown"
	case "darwin":
		out, err := exec.Command("/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate").Output()
		if err == nil {
			return strings.TrimSpace(string(out))
		}
		return "unknown"
	default:
		return "unknown"
	}
}

func (d *CommandDispatcher) handleReboot(cmd AgentCommand) error {
	log.Printf("Command %s: initiating system reboot...", cmd.ID)

	// Parse optional delay from payload (default 60 seconds).
	delaySecs := 60
	if cmd.Payload != nil {
		if v, ok := cmd.Payload["delaySeconds"].(float64); ok && v >= 0 {
			delaySecs = int(v)
		}
	}

	switch runtime.GOOS {
	case "windows":
		return exec.Command("shutdown", "/r", "/t", fmt.Sprintf("%d", delaySecs)).Start()
	case "linux", "darwin":
		// `shutdown -r +N` uses N minutes; convert seconds to minutes (minimum 1).
		delayMin := delaySecs / 60
		if delayMin < 1 {
			delayMin = 1
		}
		return exec.Command("shutdown", "-r", fmt.Sprintf("+%d", delayMin)).Start()
	default:
		return fmt.Errorf("reboot: unsupported platform %s", runtime.GOOS)
	}
}

func (d *CommandDispatcher) handleShutdown(cmd AgentCommand) error {
	log.Printf("Command %s: initiating system shutdown...", cmd.ID)

	delaySecs := 60
	if cmd.Payload != nil {
		if v, ok := cmd.Payload["delaySeconds"].(float64); ok && v >= 0 {
			delaySecs = int(v)
		}
	}

	switch runtime.GOOS {
	case "windows":
		return exec.Command("shutdown", "/s", "/t", fmt.Sprintf("%d", delaySecs)).Start()
	case "linux", "darwin":
		delayMin := delaySecs / 60
		if delayMin < 1 {
			delayMin = 1
		}
		return exec.Command("shutdown", "-h", fmt.Sprintf("+%d", delayMin)).Start()
	default:
		return fmt.Errorf("shutdown: unsupported platform %s", runtime.GOOS)
	}
}

// ServiceInfo describes a single OS service returned by list_services.
type ServiceInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName,omitempty"`
	Status      string `json:"status"` // running, stopped, unknown
	StartType   string `json:"startType,omitempty"` // auto, manual, disabled, unknown
}

func (d *CommandDispatcher) handleListServices(_ AgentCommand) (interface{}, error) {
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
			`Get-Service | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Compress`).Output()
		if err != nil {
			return nil, fmt.Errorf("list_services: powershell failed: %w", err)
		}
		// PowerShell returns either an array or a single object — normalise to array.
		trimmed := strings.TrimSpace(string(out))
		if len(trimmed) == 0 {
			return []ServiceInfo{}, nil
		}
		var raw []json.RawMessage
		if trimmed[0] == '[' {
			if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
				return nil, fmt.Errorf("list_services: parse error: %w", err)
			}
		} else {
			raw = []json.RawMessage{json.RawMessage(trimmed)}
		}
		type psService struct {
			Name        string      `json:"Name"`
			DisplayName string      `json:"DisplayName"`
			Status      interface{} `json:"Status"` // can be int or string
			StartType   interface{} `json:"StartType"`
		}
		psStatusMap := map[string]string{
			"1": "stopped", "4": "running", "2": "starting", "3": "stopping",
		}
		psStartMap := map[string]string{
			"0": "boot", "1": "system", "2": "auto", "3": "manual", "4": "disabled",
		}
		services := make([]ServiceInfo, 0, len(raw))
		for _, r := range raw {
			var ps psService
			if err := json.Unmarshal(r, &ps); err != nil {
				continue
			}
			statusStr := fmt.Sprintf("%v", ps.Status)
			if v, ok := psStatusMap[statusStr]; ok {
				statusStr = v
			} else {
				statusStr = strings.ToLower(statusStr)
			}
			startStr := fmt.Sprintf("%v", ps.StartType)
			if v, ok := psStartMap[startStr]; ok {
				startStr = v
			} else {
				startStr = strings.ToLower(startStr)
			}
			services = append(services, ServiceInfo{
				Name: ps.Name, DisplayName: ps.DisplayName,
				Status: statusStr, StartType: startStr,
			})
		}
		return map[string]interface{}{"services": services, "count": len(services)}, nil

	case "linux":
		out, err := exec.Command("systemctl", "list-units", "--type=service",
			"--all", "--no-pager", "--output=json").Output()
		if err != nil {
			// fallback: plain text
			out2, _ := exec.Command("systemctl", "list-units", "--type=service",
				"--all", "--no-pager").Output()
			return map[string]interface{}{
				"services": strings.TrimSpace(string(out2)),
				"format":   "text",
			}, nil
		}
		var units []map[string]interface{}
		if err := json.Unmarshal(out, &units); err != nil {
			return map[string]interface{}{"raw": strings.TrimSpace(string(out))}, nil
		}
		services := make([]ServiceInfo, 0, len(units))
		for _, u := range units {
			name, _ := u["unit"].(string)
			desc, _ := u["description"].(string)
			active, _ := u["active"].(string)
			status := "stopped"
			if active == "active" {
				status = "running"
			}
			services = append(services, ServiceInfo{Name: name, DisplayName: desc, Status: status})
		}
		return map[string]interface{}{"services": services, "count": len(services)}, nil

	case "darwin":
		out, err := exec.Command("launchctl", "list").Output()
		if err != nil {
			return nil, fmt.Errorf("list_services: launchctl failed: %w", err)
		}
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		services := make([]ServiceInfo, 0, len(lines))
		for _, line := range lines[1:] { // skip header
			fields := strings.Fields(line)
			if len(fields) < 3 {
				continue
			}
			status := "stopped"
			if fields[0] != "-" {
				status = "running"
			}
			services = append(services, ServiceInfo{Name: fields[2], Status: status})
		}
		return map[string]interface{}{"services": services, "count": len(services)}, nil

	default:
		return nil, fmt.Errorf("list_services: unsupported platform %s", runtime.GOOS)
	}
}

func (d *CommandDispatcher) handleRestartService(cmd AgentCommand) (interface{}, error) {
	name := payloadString(cmd.Payload, "name")
	if name == "" {
		return nil, fmt.Errorf("restart_service: name not specified")
	}

	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
			fmt.Sprintf(`Restart-Service -Name '%s' -Force -PassThru | Select-Object Name,Status | ConvertTo-Json -Compress`, name)).Output()
		if err != nil {
			return nil, fmt.Errorf("restart_service: %w", err)
		}
		return map[string]string{"name": name, "output": strings.TrimSpace(string(out))}, nil

	case "linux":
		out, err := exec.Command("systemctl", "restart", name).CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("restart_service: systemctl restart %s failed: %s", name, strings.TrimSpace(string(out)))
		}
		return map[string]string{"name": name, "status": "restarted"}, nil

	case "darwin":
		// Attempt launchctl kickstart then stop+start as fallback.
		out, err := exec.Command("launchctl", "kickstart", "-k", name).CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("restart_service: launchctl kickstart %s failed: %s", name, strings.TrimSpace(string(out)))
		}
		return map[string]string{"name": name, "status": "restarted"}, nil

	default:
		return nil, fmt.Errorf("restart_service: unsupported platform %s", runtime.GOOS)
	}
}

func (d *CommandDispatcher) handleRestartAgent(cmd AgentCommand) error {
	log.Printf("Command %s: restarting agent service...", cmd.ID)
	// Exit cleanly after a short delay so the ack can be sent first.
	// The service manager (Windows SCM / systemd / launchd) restarts the
	// process automatically, which triggers checkForUpdate() at startup.
	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

// ── ExecuteSync ───────────────────────────────────────────────────────────────

// ExecuteSync runs a command synchronously and returns (result, error).
// Used by the WS command channel so results can be sent back immediately
// without waiting for the next HTTP push cycle.
func (d *CommandDispatcher) ExecuteSync(cmd AgentCommand) (interface{}, error) {
	switch cmd.Type {
	case "scan_inventory":
		return d.handleScanInventory(cmd)
	case "scan_updates":
		return d.handleScanUpdates(cmd)
	case "run_script":
		return d.handleRunScript(cmd)
	case "install_update":
		return d.handleInstallUpdate(cmd)
	case "check_compliance":
		return d.handleCheckCompliance(cmd)
	case "list_services":
		return d.handleListServices(cmd)
	case "restart_service":
		return d.handleRestartService(cmd)
	case "reboot":
		return nil, d.handleReboot(cmd)
	case "shutdown":
		return nil, d.handleShutdown(cmd)
	case "restart_agent":
		return nil, d.handleRestartAgent(cmd)
	default:
		return nil, fmt.Errorf("unknown command type: %s", cmd.Type)
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// makeConfig returns a minimal Config suitable for making HTTP calls.
// The full Config is not stored in the dispatcher to avoid tight coupling —
// we only need the three connection fields.
func (d *CommandDispatcher) makeConfig() *Config {
	return &Config{
		DeviceUUID: d.deviceUUID,
		APIKey:     d.apiKey,
		ServerURL:  d.serverURL,
	}
}

// payloadString is a helper to extract a string value from a command payload.
func payloadString(payload map[string]interface{}, key string) string {
	if payload == nil {
		return ""
	}
	if v, ok := payload[key].(string); ok {
		return v
	}
	return ""
}

// payloadJSON is a helper to re-marshal a payload value to JSON bytes.
func payloadJSON(payload map[string]interface{}, key string) []byte {
	if payload == nil {
		return nil
	}
	if v, ok := payload[key]; ok {
		b, _ := json.Marshal(v)
		return b
	}
	return nil
}

