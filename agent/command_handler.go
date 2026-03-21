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
	"regexp"
	"runtime"
	"strconv"
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
	deviceUUID           string
	apiKey               string
	serverURL            string
	remediationEnabled   bool
	pendingAcks          []CommandAck
	mu                   sync.Mutex
}

// NewCommandDispatcher creates a CommandDispatcher bound to the given device.
func NewCommandDispatcher(deviceUUID, apiKey, serverURL string, remediationEnabled bool) *CommandDispatcher {
	return &CommandDispatcher{
		deviceUUID:         deviceUUID,
		apiKey:             apiKey,
		serverURL:          serverURL,
		remediationEnabled: remediationEnabled,
	}
}

// SetRemediationEnabled updates the remediation flag (called on each push response).
func (d *CommandDispatcher) SetRemediationEnabled(enabled bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.remediationEnabled = enabled
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

// isBlockedByPrivacy returns true for command types that must be refused when
// privacy mode is active.
func isBlockedByPrivacy(cmdType string) bool {
	switch cmdType {
	case "open_remote_tunnel", "run_script", "list_wts_sessions",
		"list_processes", "kill_process",
		"list_directory", "create_directory", "rename_file",
		"delete_file", "download_file", "upload_file":
		return true
	}
	return false
}

func (d *CommandDispatcher) executeCommand(cmd AgentCommand) {
	var result interface{}
	var execErr error

	// Privacy mode: reject remote-access commands.
	if IsPrivacyMode() && isBlockedByPrivacy(cmd.Type) {
		log.Printf("Command %s (%s) blocked by privacy mode", cmd.ID, cmd.Type)
		d.addAck(CommandAck{
			CommandID:   cmd.ID,
			CommandType: cmd.Type,
			Status:      "failure",
			Result:      map[string]string{"error": "privacy mode is enabled — remote access denied"},
		})
		return
	}

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

	case "uninstall_agent":
		execErr = d.handleUninstallAgent()

	case "install_oblireach":
		result, execErr = d.handleInstallOblireach(cmd)

	case "list_wts_sessions":
		result, execErr = d.handleListWtsSessions(cmd)

	case "list_processes":
		result, execErr = d.handleListProcesses(cmd)

	case "kill_process":
		result, execErr = d.handleKillProcess(cmd)

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

	case "list_directory":
		result, execErr = d.handleListDirectory(cmd)
	case "create_directory":
		result, execErr = d.handleCreateDirectory(cmd)
	case "rename_file":
		result, execErr = d.handleRenameFile(cmd)
	case "delete_file":
		result, execErr = d.handleDeleteFile(cmd)
	case "download_file":
		result, execErr = d.handleDownloadFile(cmd)
	case "upload_file":
		result, execErr = d.handleUploadFile(cmd)

	case "disable_privacy_mode":
		if err := SetPrivacyMode(false, "remote"); err != nil {
			execErr = err
		} else {
			result = map[string]string{"message": "privacy mode disabled"}
		}

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

// ── Compliance Rule Evaluation Engine ────────────────────────────────────────

// ComplianceRule mirrors the shared ComplianceRule TypeScript type.
type ComplianceRule struct {
	ID                    string      `json:"id"`
	Name                  string      `json:"name"`
	Category              string      `json:"category"`
	CheckType             string      `json:"checkType"` // registry|file|command|service|event_log|process|policy
	TargetPlatform        string      `json:"targetPlatform"` // windows|macos|linux|all
	Target                string      `json:"target"`
	Expected              interface{} `json:"expected"`
	Operator              string      `json:"operator"` // eq|neq|gt|lt|contains|not_contains|exists|not_exists|regex
	Severity              string      `json:"severity"`
	AutoRemediateScriptId interface{} `json:"autoRemediateScriptId"`
}

// ComplianceRuleResult mirrors the shared ComplianceRuleResult TypeScript type.
type ComplianceRuleResult struct {
	RuleID               string      `json:"ruleId"`
	Status               string      `json:"status"` // pass|fail|warning|error|skipped|unknown
	ActualValue          interface{} `json:"actualValue,omitempty"`
	CheckedAt            string      `json:"checkedAt"`
	RemediationTriggered bool        `json:"remediationTriggered"`
}

// handleCheckCompliance evaluates each rule in the policy payload and posts
// results to the server via POST /api/agent/compliance.
func (d *CommandDispatcher) handleCheckCompliance(cmd AgentCommand) (interface{}, error) {
	// Parse rules from payload
	var rules []ComplianceRule
	if cmd.Payload != nil {
		if rulesRaw, ok := cmd.Payload["rules"]; ok {
			rawBytes, err := json.Marshal(rulesRaw)
			if err == nil {
				_ = json.Unmarshal(rawBytes, &rules)
			}
		}
	}

	policyId := interface{}(nil)
	if cmd.Payload != nil {
		policyId = cmd.Payload["policyId"]
	}

	// Read remediation flag from dispatcher (set from last push response).
	d.mu.Lock()
	remediationEnabled := d.remediationEnabled
	d.mu.Unlock()

	// Evaluate each rule
	results := make([]ComplianceRuleResult, 0, len(rules))
	for _, rule := range rules {
		r := evaluateComplianceRule(rule)
		// Auto-remediate failing rules when enabled and a script is configured.
		if remediationEnabled && r.Status == "fail" && rule.AutoRemediateScriptId != nil {
			scriptId := fmt.Sprintf("%v", rule.AutoRemediateScriptId)
			if scriptId != "" && scriptId != "<nil>" && scriptId != "0" {
				log.Printf("Compliance: auto-remediating rule %s with script %s", rule.ID, scriptId)
				if err := d.runRemediationScript(scriptId); err != nil {
					log.Printf("Compliance: remediation script %s failed: %v", scriptId, err)
				} else {
					r.RemediationTriggered = true
				}
			}
		}
		results = append(results, r)
	}

	// If no rules, fall back to legacy firewall check
	if len(rules) == 0 {
		fw := checkFirewallStatus()
		fwStatus := "unknown"
		if strings.Contains(fw, "active") || strings.Contains(fw, "profiles_enabled:3") || strings.Contains(fw, "State is enabled") {
			fwStatus = "pass"
		} else if fw != "unknown" {
			fwStatus = "fail"
		}
		results = append(results, ComplianceRuleResult{
			RuleID:      "firewall",
			Status:      fwStatus,
			ActualValue: fw,
			CheckedAt:   time.Now().UTC().Format(time.RFC3339),
		})
	}

	// Compute score
	passed := 0
	evaluated := 0
	for _, r := range results {
		if r.Status == "skipped" || r.Status == "unknown" {
			continue
		}
		evaluated++
		if r.Status == "pass" {
			passed++
		}
	}
	score := 0.0
	if evaluated > 0 {
		score = float64(passed) / float64(evaluated) * 100.0
	}

	// Post results to server asynchronously
	go d.postComplianceResults(policyId, results, score)

	return map[string]interface{}{
		"policyId": policyId,
		"score":    score,
		"passed":   passed,
		"failed":   evaluated - passed,
		"total":    len(results),
		"platform": runtime.GOOS,
	}, nil
}

// evaluateComplianceRule evaluates a single rule and returns its result.
func evaluateComplianceRule(rule ComplianceRule) ComplianceRuleResult {
	now := time.Now().UTC().Format(time.RFC3339)
	r := ComplianceRuleResult{RuleID: rule.ID, CheckedAt: now}

	// Skip rules for other platforms
	if rule.TargetPlatform != "all" && rule.TargetPlatform != runtime.GOOS &&
		!(rule.TargetPlatform == "macos" && runtime.GOOS == "darwin") {
		r.Status = "skipped"
		return r
	}
	// darwin is reported as "macos" externally, normalise
	gos := runtime.GOOS
	if gos == "darwin" {
		gos = "macos"
	}
	if rule.TargetPlatform == "macos" && gos != "macos" {
		r.Status = "skipped"
		return r
	}

	switch rule.CheckType {
	case "registry":
		r = evalRegistry(rule, r)
	case "file":
		r = evalFile(rule, r)
	case "command":
		r = evalCommand(rule, r)
	case "service":
		r = evalService(rule, r)
	case "process":
		r = evalProcess(rule, r)
	case "event_log":
		r = evalEventLog(rule, r)
	default:
		r.Status = "unknown"
	}
	return r
}

// ── Registry (Windows only) ───────────────────────────────────────────────────

func evalRegistry(rule ComplianceRule, r ComplianceRuleResult) ComplianceRuleResult {
	if runtime.GOOS != "windows" {
		r.Status = "skipped"
		return r
	}
	// target format: "HKLM\KEY\PATH|ValueName"
	parts := strings.SplitN(rule.Target, "|", 2)
	if len(parts) != 2 {
		r.Status = "error"
		r.ActualValue = "invalid target format — expected HKLM\\KEY\\PATH|ValueName"
		return r
	}
	keyPath, valueName := parts[0], parts[1]

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "reg", "query", keyPath, "/v", valueName).Output()
	if err != nil {
		if rule.Operator == "not_exists" {
			r.Status = "pass"
			r.ActualValue = nil
		} else if rule.Operator == "exists" {
			r.Status = "fail"
			r.ActualValue = "(absent)"
		} else {
			r.Status = "fail"
			r.ActualValue = "(absent)"
		}
		return r
	}

	actual := parseRegValue(string(out))
	r.ActualValue = actual
	if rule.Operator == "exists" {
		r.Status = "pass"
		return r
	}
	if rule.Operator == "not_exists" {
		r.Status = "fail"
		return r
	}
	r.Status = evalOperator(actual, fmt.Sprintf("%v", rule.Expected), rule.Operator)
	return r
}

// parseRegValue extracts the data value from `reg query` output.
// Example line: "    SMB1    REG_DWORD    0x0"
func parseRegValue(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "HKEY") || strings.HasPrefix(line, "Error") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 3 {
			val := fields[len(fields)-1]
			// Convert hex (REG_DWORD) to decimal
			if strings.HasPrefix(strings.ToLower(val), "0x") {
				if n, err := strconv.ParseInt(val[2:], 16, 64); err == nil {
					return strconv.FormatInt(n, 10)
				}
			}
			return val
		}
	}
	return ""
}

// ── File ─────────────────────────────────────────────────────────────────────

func evalFile(rule ComplianceRule, r ComplianceRuleResult) ComplianceRuleResult {
	_, statErr := os.Stat(rule.Target)
	exists := statErr == nil

	if rule.Operator == "exists" {
		r.Status = boolStatus(exists)
		return r
	}
	if rule.Operator == "not_exists" {
		r.Status = boolStatus(!exists)
		return r
	}

	if !exists {
		r.Status = "fail"
		r.ActualValue = "file not found"
		return r
	}

	content, err := os.ReadFile(rule.Target)
	if err != nil {
		r.Status = "error"
		r.ActualValue = err.Error()
		return r
	}

	actual := string(content)
	expected := fmt.Sprintf("%v", rule.Expected)
	r.Status = evalOperator(actual, expected, rule.Operator)
	// Don't expose full file content — just show relevant snippet
	if rule.Operator == "contains" || rule.Operator == "not_contains" {
		if r.Status == "fail" {
			r.ActualValue = "pattern not found"
		} else {
			r.ActualValue = "pattern found"
		}
	}
	return r
}

// ── Command ──────────────────────────────────────────────────────────────────

func evalCommand(rule ComplianceRule, r ComplianceRuleResult) ComplianceRuleResult {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", rule.Target)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", rule.Target)
	}
	out, err := cmd.Output()
	if err != nil {
		// Exit code != 0 is not necessarily an error for our purposes
		// If we still got output, try to evaluate it
		if len(out) == 0 {
			r.Status = "error"
			r.ActualValue = err.Error()
			return r
		}
	}

	actual := strings.TrimSpace(string(out))
	expected := fmt.Sprintf("%v", rule.Expected)
	r.ActualValue = actual
	r.Status = evalOperator(actual, expected, rule.Operator)
	return r
}

// ── Service ───────────────────────────────────────────────────────────────────

func evalService(rule ComplianceRule, r ComplianceRuleResult) ComplianceRuleResult {
	var actualStatus string

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	switch runtime.GOOS {
	case "windows":
		out, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive",
			"-Command",
			fmt.Sprintf(`$s=Get-Service -Name '%s' -ErrorAction SilentlyContinue; if($s){$s.StartType}else{'not_found'}`, rule.Target),
		).Output()
		if err != nil || strings.TrimSpace(string(out)) == "" {
			actualStatus = "not_found"
		} else {
			actualStatus = strings.TrimSpace(string(out))
		}
	case "linux":
		out, _ := exec.CommandContext(ctx, "systemctl", "is-active", rule.Target).Output()
		actualStatus = strings.TrimSpace(string(out))
	default: // macos / darwin
		out, err := exec.CommandContext(ctx, "launchctl", "print", rule.Target).Output()
		if err != nil {
			actualStatus = "not_found"
		} else if strings.Contains(string(out), "state = running") {
			actualStatus = "running"
		} else {
			actualStatus = "stopped"
		}
	}

	r.ActualValue = actualStatus
	expected := strings.ToLower(fmt.Sprintf("%v", rule.Expected))
	actual := strings.ToLower(actualStatus)
	// Normalise Windows StartType casing
	// "not_found" = service not installed → at least as secure as Disabled
	switch actual {
	case "not_found":
		actual = "disabled"
	case "disabled", "0":
		actual = "disabled"
	case "manual", "1":
		actual = "manual"
	case "automatic", "2":
		actual = "automatic"
	case "automaticdelayedstart", "boot", "system":
		actual = actual
	}
	r.Status = evalOperator(actual, expected, rule.Operator)
	return r
}

// ── Process ───────────────────────────────────────────────────────────────────

func evalProcess(rule ComplianceRule, r ComplianceRuleResult) ComplianceRuleResult {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var running bool
	switch runtime.GOOS {
	case "windows":
		out, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive",
			"-Command",
			fmt.Sprintf(`(Get-Process -Name '%s' -ErrorAction SilentlyContinue | Measure-Object).Count`, rule.Target),
		).Output()
		if err == nil {
			count := strings.TrimSpace(string(out))
			n, _ := strconv.Atoi(count)
			running = n > 0
		}
	default:
		out, err := exec.CommandContext(ctx, "pgrep", "-x", rule.Target).Output()
		running = err == nil && len(strings.TrimSpace(string(out))) > 0
	}

	r.ActualValue = running
	expected := strings.ToLower(fmt.Sprintf("%v", rule.Expected))
	// expected can be "true"/"running" for expecting the process to be running
	expectRunning := expected == "true" || expected == "running"
	if (running && expectRunning) || (!running && !expectRunning) {
		r.Status = "pass"
	} else {
		r.Status = "fail"
	}
	return r
}

// ── Event Log (Windows only) ──────────────────────────────────────────────────

func evalEventLog(rule ComplianceRule, r ComplianceRuleResult) ComplianceRuleResult {
	if runtime.GOOS != "windows" {
		r.Status = "skipped"
		return r
	}
	// target format: "LogName|EventID" or "LogName|EventID|hours"
	parts := strings.SplitN(rule.Target, "|", 3)
	if len(parts) < 2 {
		r.Status = "error"
		r.ActualValue = "invalid target — expected LogName|EventID[|hours]"
		return r
	}
	logName, eventID := parts[0], parts[1]
	hours := "24"
	if len(parts) == 3 {
		hours = parts[2]
	}

	ps := fmt.Sprintf(
		`(Get-WinEvent -FilterHashtable @{LogName='%s'; Id=%s; StartTime=(Get-Date).AddHours(-%s)} -ErrorAction SilentlyContinue | Measure-Object).Count`,
		logName, eventID, hours,
	)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps).Output()
	if err != nil {
		r.Status = "error"
		r.ActualValue = err.Error()
		return r
	}
	actual := strings.TrimSpace(string(out))
	r.ActualValue = actual
	r.Status = evalOperator(actual, fmt.Sprintf("%v", rule.Expected), rule.Operator)
	return r
}

// ── Operator evaluation ───────────────────────────────────────────────────────

func evalOperator(actual, expected, operator string) string {
	switch operator {
	case "eq":
		if strings.EqualFold(strings.TrimSpace(actual), strings.TrimSpace(expected)) {
			return "pass"
		}
		return "fail"
	case "neq":
		if !strings.EqualFold(strings.TrimSpace(actual), strings.TrimSpace(expected)) {
			return "pass"
		}
		return "fail"
	case "contains":
		if strings.Contains(strings.ToLower(actual), strings.ToLower(expected)) {
			return "pass"
		}
		return "fail"
	case "not_contains":
		if !strings.Contains(strings.ToLower(actual), strings.ToLower(expected)) {
			return "pass"
		}
		return "fail"
	case "exists":
		return "pass"
	case "not_exists":
		return "fail"
	case "gt":
		a, err1 := strconv.ParseFloat(strings.TrimSpace(actual), 64)
		e, err2 := strconv.ParseFloat(strings.TrimSpace(expected), 64)
		if err1 != nil || err2 != nil {
			return "error"
		}
		if a > e {
			return "pass"
		}
		return "fail"
	case "lt":
		a, err1 := strconv.ParseFloat(strings.TrimSpace(actual), 64)
		e, err2 := strconv.ParseFloat(strings.TrimSpace(expected), 64)
		if err1 != nil || err2 != nil {
			return "error"
		}
		if a < e {
			return "pass"
		}
		return "fail"
	case "regex":
		re, err := regexp.Compile(expected)
		if err != nil {
			return "error"
		}
		if re.MatchString(actual) {
			return "pass"
		}
		return "fail"
	}
	return "unknown"
}

func boolStatus(b bool) string {
	if b {
		return "pass"
	}
	return "fail"
}

// ── checkFirewallStatus ───────────────────────────────────────────────────────

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

// postComplianceResults sends evaluated rule results to the server.
func (d *CommandDispatcher) postComplianceResults(policyId interface{}, results []ComplianceRuleResult, score float64) {
	payload := map[string]interface{}{
		"policyId": policyId,
		"results":  results,
		"score":    score,
		"platform": runtime.GOOS,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("postComplianceResults: marshal error: %v", err)
		return
	}
	req, err := http.NewRequest("POST", d.serverURL+"/api/agent/compliance", bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", d.apiKey)
	req.Header.Set("X-Device-UUID", d.deviceUUID)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("postComplianceResults: HTTP error: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("postComplianceResults: server returned %d", resp.StatusCode)
	}
}

// runRemediationScript fetches the script by ID from the server and executes it.
func (d *CommandDispatcher) runRemediationScript(scriptId string) error {
	url := fmt.Sprintf("%s/api/scripts/%s", d.serverURL, scriptId)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("X-API-Key", d.apiKey)
	req.Header.Set("X-Device-UUID", d.deviceUUID)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch script: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("fetch script: server returned %d", resp.StatusCode)
	}

	var scriptData struct {
		Runtime        string `json:"runtime"`
		Content        string `json:"content"`
		TimeoutSeconds int    `json:"timeoutSeconds"`
		RunAs          string `json:"runAs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&scriptData); err != nil {
		return fmt.Errorf("decode script: %w", err)
	}

	_, err = ExecuteScript(ScriptCommand{
		ID:             "remediation-" + scriptId,
		Runtime:        scriptData.Runtime,
		Content:        scriptData.Content,
		TimeoutSeconds: scriptData.TimeoutSeconds,
		RunAs:          scriptData.RunAs,
	})
	return err
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
	if IsPrivacyMode() && isBlockedByPrivacy(cmd.Type) {
		return nil, fmt.Errorf("privacy mode is enabled — remote access denied")
	}
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
	case "list_wts_sessions":
		return d.handleListWtsSessions(cmd)
	case "list_processes":
		return d.handleListProcesses(cmd)
	case "kill_process":
		return d.handleKillProcess(cmd)
	case "list_directory":
		return d.handleListDirectory(cmd)
	case "create_directory":
		return d.handleCreateDirectory(cmd)
	case "rename_file":
		return d.handleRenameFile(cmd)
	case "delete_file":
		return d.handleDeleteFile(cmd)
	case "download_file":
		return d.handleDownloadFile(cmd)
	case "upload_file":
		return d.handleUploadFile(cmd)
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
	case "uninstall_agent":
		return nil, d.handleUninstallAgent()
	case "install_oblireach":
		return d.handleInstallOblireach(cmd)
	case "disable_privacy_mode":
		if err := SetPrivacyMode(false, "remote"); err != nil {
			return nil, err
		}
		return map[string]string{"message": "privacy mode disabled"}, nil
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

