package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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
	CommandID   string      `json:"commandId"`
	CommandType string      `json:"commandType,omitempty"`
	Status      string      `json:"status"` // ack_running, success, failure, timeout
	Result      interface{} `json:"result,omitempty"`
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
		CommandID:   cmd.ID,
		CommandType: cmd.Type,
		Status:      "ack_running",
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
		if execErr == nil { go d.collectAndPostServices() }

	case "start_service":
		result, execErr = d.handleStartService(cmd)
		if execErr == nil { go d.collectAndPostServices() }

	case "stop_service":
		result, execErr = d.handleStopService(cmd)
		if execErr == nil { go d.collectAndPostServices() }

	default:
		execErr = fmt.Errorf("unknown command type: %s", cmd.Type)
	}

	ack := CommandAck{CommandID: cmd.ID, CommandType: cmd.Type}
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
	RunAsUser  string `json:"runAsUser,omitempty"`  // account the service runs as
}

func (d *CommandDispatcher) handleListServices(_ AgentCommand) (interface{}, error) {
	switch runtime.GOOS {
	case "windows":
		ctx60, cancel60 := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel60()
		// Win32_Service via CIM: returns string State/StartMode + StartName (run-as account).
		out, err := exec.CommandContext(ctx60, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
			`Get-CimInstance -ClassName Win32_Service | Select-Object Name,DisplayName,State,StartMode,StartName | ConvertTo-Json -Compress`).Output()
		if err != nil {
			return nil, fmt.Errorf("list_services: powershell failed: %w", err)
		}
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
		type ciService struct {
			Name        string `json:"Name"`
			DisplayName string `json:"DisplayName"`
			State       string `json:"State"`     // "Running", "Stopped", "Paused", ...
			StartMode   string `json:"StartMode"` // "Auto", "Manual", "Disabled", ...
			StartName   string `json:"StartName"` // run-as account ("LocalSystem", etc.)
		}
		services := make([]ServiceInfo, 0, len(raw))
		for _, r := range raw {
			var ci ciService
			if err := json.Unmarshal(r, &ci); err != nil {
				continue
			}
			services = append(services, ServiceInfo{
				Name:        ci.Name,
				DisplayName: ci.DisplayName,
				Status:      strings.ToLower(ci.State),
				StartType:   strings.ToLower(ci.StartMode),
				RunAsUser:   ci.StartName,
			})
		}
		return map[string]interface{}{"services": services, "count": len(services)}, nil

	case "linux":
		out, err := exec.Command("systemctl", "list-units", "--type=service",
			"--all", "--no-pager", "--output=json").Output()
		if err != nil {
			// Fallback for older systemd without JSON support — return empty list.
			return map[string]interface{}{"services": []ServiceInfo{}, "count": 0}, nil
		}
		var units []map[string]interface{}
		if err := json.Unmarshal(out, &units); err != nil {
			return map[string]interface{}{"services": []ServiceInfo{}, "count": 0}, nil
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
		// Bulk-fetch User= property for all units in one systemctl show call.
		if len(services) > 0 {
			unitNames := make([]string, len(services))
			for i, s := range services {
				unitNames[i] = s.Name
			}
			args := append([]string{"show", "--property=Id,User"}, unitNames...)
			showOut, showErr := exec.Command("systemctl", args...).Output()
			if showErr == nil {
				// Output: "Id=unit.service\nUser=username\n\nId=...\nUser=...\n"
				userMap := make(map[string]string)
				for _, block := range strings.Split(strings.TrimSpace(string(showOut)), "\n\n") {
					var id, user string
					for _, line := range strings.Split(block, "\n") {
						if strings.HasPrefix(line, "Id=") {
							id = strings.TrimPrefix(line, "Id=")
						} else if strings.HasPrefix(line, "User=") {
							user = strings.TrimPrefix(line, "User=")
						}
					}
					if id != "" {
						if user == "" {
							user = "root"
						}
						userMap[id] = user
					}
				}
				for i := range services {
					if u, ok := userMap[services[i].Name]; ok {
						services[i].RunAsUser = u
					}
				}
			}
		}
		return map[string]interface{}{"services": services, "count": len(services)}, nil

	case "darwin":
		out, err := exec.Command("launchctl", "list").Output()
		if err != nil {
			return nil, fmt.Errorf("list_services: launchctl failed: %w", err)
		}
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		services := make([]ServiceInfo, 0, len(lines))
		for _, line := range lines[1:] { // skip header: PID Status Label
			fields := strings.Fields(line)
			if len(fields) < 3 {
				continue
			}
			pidStr := fields[0]
			status := "stopped"
			runAsUser := ""
			if pidStr != "-" {
				status = "running"
				// Resolve the user from the running PID.
				psOut, psErr := exec.Command("ps", "-p", pidStr, "-o", "user=").Output()
				if psErr == nil {
					runAsUser = strings.TrimSpace(string(psOut))
				}
			}
			services = append(services, ServiceInfo{Name: fields[2], Status: status, RunAsUser: runAsUser})
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


func (d *CommandDispatcher) handleStartService(cmd AgentCommand) (interface{}, error) {
	name := payloadString(cmd.Payload, "name")
	if name == "" {
		return nil, fmt.Errorf("start_service: name not specified")
	}

	switch runtime.GOOS {
	case "windows":
		ctxW, cancelW := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelW()
		out, err := exec.CommandContext(ctxW, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
			fmt.Sprintf(`Start-Service -Name '%s' -PassThru | Select-Object Name,Status | ConvertTo-Json -Compress`, name)).Output()
		if err != nil {
			return nil, fmt.Errorf("start_service: %w", err)
		}
		return map[string]string{"name": name, "output": strings.TrimSpace(string(out))}, nil

	case "linux":
		out, err := exec.Command("systemctl", "start", name).CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("start_service: systemctl start %s failed: %s", name, strings.TrimSpace(string(out)))
		}
		return map[string]string{"name": name, "status": "started"}, nil

	case "darwin":
		out, err := exec.Command("launchctl", "start", name).CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("start_service: launchctl start %s failed: %s", name, strings.TrimSpace(string(out)))
		}
		return map[string]string{"name": name, "status": "started"}, nil

	default:
		return nil, fmt.Errorf("start_service: unsupported platform %s", runtime.GOOS)
	}
}

func (d *CommandDispatcher) handleStopService(cmd AgentCommand) (interface{}, error) {
	name := payloadString(cmd.Payload, "name")
	if name == "" {
		return nil, fmt.Errorf("stop_service: name not specified")
	}

	switch runtime.GOOS {
	case "windows":
		ctxW, cancelW := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelW()
		out, err := exec.CommandContext(ctxW, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
			fmt.Sprintf(`Stop-Service -Name '%s' -Force -PassThru | Select-Object Name,Status | ConvertTo-Json -Compress`, name)).Output()
		if err != nil {
			return nil, fmt.Errorf("stop_service: %w", err)
		}
		return map[string]string{"name": name, "output": strings.TrimSpace(string(out))}, nil

	case "linux":
		out, err := exec.Command("systemctl", "stop", name).CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("stop_service: systemctl stop %s failed: %s", name, strings.TrimSpace(string(out)))
		}
		return map[string]string{"name": name, "status": "stopped"}, nil

	case "darwin":
		out, err := exec.Command("launchctl", "stop", name).CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("stop_service: launchctl stop %s failed: %s", name, strings.TrimSpace(string(out)))
		}
		return map[string]string{"name": name, "status": "stopped"}, nil

	default:
		return nil, fmt.Errorf("stop_service: unsupported platform %s", runtime.GOOS)
	}
}

func (d *CommandDispatcher) handleRestartAgent(cmd AgentCommand) error {
	log.Printf("Command %s: restarting agent service...", cmd.ID)
	// Restart after a short delay so the WS ack can be sent first.
	go func() {
		time.Sleep(500 * time.Millisecond)
		switch runtime.GOOS {
		case "windows":
			// On Windows, os.Exit(0) is treated as a clean/intentional service stop:
			// the SCM does NOT trigger recovery/restart actions.
			// Use PowerShell Restart-Service to properly stop then restart via SCM.
			log.Printf("Restarting OblianceAgent service via PowerShell...")
			_ = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
				"Restart-Service -Name OblianceAgent -Force").Start()
			// The SCM stop signal will eventually terminate this process.
			// Sleep as a safety fallback in case Restart-Service doesn't kill us.
			time.Sleep(10 * time.Second)
			os.Exit(0)
		default:
			// Linux/macOS: os.Exit(0) causes systemd/launchd to restart the process
			// when configured with Restart=always or KeepAlive=true.
			os.Exit(0)
		}
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
	case "start_service":
		return d.handleStartService(cmd)
	case "stop_service":
		return d.handleStopService(cmd)
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

// collectAndPostServices runs list_services and immediately POSTs the result.
// Called by the service watcher goroutine and after start/stop/restart actions.
func (d *CommandDispatcher) collectAndPostServices() {
	cfg := d.makeConfig()
	result, err := d.handleListServices(AgentCommand{ID: generateUUID(), Type: "list_services"})
	if err != nil {
		log.Printf("collectAndPostServices: %v", err)
		return
	}
	raw, ok := result.(map[string]interface{})
	if !ok {
		return
	}
	svcs, ok := raw["services"]
	if !ok {
		return
	}
	b, _ := json.Marshal(svcs)
	var services []ServiceInfo
	if err := json.Unmarshal(b, &services); err == nil {
		postServices(services, cfg)
	}
}


// postServices pushes the current service list to the server so it can be
// stored as latest_services and broadcast to connected clients via socket.
func postServices(services []ServiceInfo, cfg *Config) {
	if cfg == nil || len(services) == 0 {
		return
	}
	body := map[string]interface{}{"services": services}
	b, err := json.Marshal(body)
	if err != nil {
		log.Printf("postServices: marshal error: %v", err)
		return
	}
	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/services", bytes.NewReader(b))
	if err != nil {
		log.Printf("postServices: build request error: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("postServices: request error: %v", err)
		return
	}
	resp.Body.Close()
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

