package main

import (
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// ProcessInfo describes a single OS process.
type ProcessInfo struct {
	PID        int     `json:"pid"`
	Name       string  `json:"name"`
	CPUPercent float64 `json:"cpuPercent"`
	MemBytes   int64   `json:"memBytes"`
	User       string  `json:"user"`
	Command    string  `json:"command,omitempty"`
}

func (d *CommandDispatcher) handleListProcesses(_ AgentCommand) (interface{}, error) {
	processes, err := collectProcesses()
	if err != nil {
		return nil, fmt.Errorf("list_processes: %w", err)
	}
	return map[string]interface{}{"processes": processes}, nil
}

func (d *CommandDispatcher) handleKillProcess(cmd AgentCommand) (interface{}, error) {
	pidVal, ok := cmd.Payload["pid"]
	if !ok {
		return nil, fmt.Errorf("kill_process: missing pid")
	}
	pid := 0
	switch v := pidVal.(type) {
	case float64:
		pid = int(v)
	case int:
		pid = v
	case string:
		var err error
		pid, err = strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("kill_process: invalid pid %q", v)
		}
	default:
		return nil, fmt.Errorf("kill_process: invalid pid type")
	}
	if pid <= 0 {
		return nil, fmt.Errorf("kill_process: invalid pid %d", pid)
	}

	err := killProcess(pid)
	if err != nil {
		return nil, fmt.Errorf("kill_process pid=%d: %w", pid, err)
	}
	log.Printf("Process %d killed successfully", pid)
	return map[string]interface{}{"killed": pid}, nil
}

func killProcess(pid int) error {
	if runtime.GOOS == "windows" {
		return exec.Command("taskkill", "/F", "/PID", strconv.Itoa(pid)).Run()
	}
	return exec.Command("kill", "-9", strconv.Itoa(pid)).Run()
}

// collectProcesses returns the list of running processes.
// Platform-specific implementations below.
func collectProcesses() ([]ProcessInfo, error) {
	switch runtime.GOOS {
	case "windows":
		return collectProcessesWindows()
	case "darwin":
		return collectProcessesDarwin()
	default:
		return collectProcessesLinux()
	}
}

// ── Windows ──────────────────────────────────────────────────────────────────

func collectProcessesWindows() ([]ProcessInfo, error) {
	// Use PowerShell to get PID, Name, CPU seconds, WorkingSet, UserName in one pass.
	// This is fast enough (~1-2s) and gives us all fields including the username.
	script := `Get-Process | ForEach-Object {
		$u = ''
		try { $u = $_.StartInfo.EnvironmentVariables['USERNAME'] } catch {}
		if (-not $u) { try { $o = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -Property GetOwnerSid -ErrorAction SilentlyContinue; $u = (Invoke-CimMethod -InputObject $o -MethodName GetOwner -ErrorAction SilentlyContinue).User } catch {} }
		"$($_.Id)|$($_.ProcessName)|$([math]::Round($_.CPU,1))|$($_.WorkingSet64)|$u"
	}`

	// Fallback to a simpler, faster approach: tasklist + wmic
	// Actually, let's use a single optimised PowerShell call
	psScript := `$procs = Get-CimInstance Win32_Process | Select-Object ProcessId,Name,WorkingSetSize,CommandLine,@{N='User';E={
		$o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
		if ($o -and $o.User) { $o.User } else { '' }
	}}
$perfs = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -ne 0 } | Select-Object IDProcess,PercentProcessorTime
$perfMap = @{}; foreach ($p in $perfs) { $perfMap[$p.IDProcess] = $p.PercentProcessorTime }
foreach ($p in $procs) {
	$cpu = 0; if ($perfMap.ContainsKey($p.ProcessId)) { $cpu = $perfMap[$p.ProcessId] }
	"$($p.ProcessId)|$($p.Name)|$cpu|$($p.WorkingSetSize)|$($p.User)|$($p.CommandLine -replace '\|','')"
}`
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psScript).Output()
	if err != nil {
		// Fallback: tasklist (no CPU% or user, but always works)
		return collectProcessesTasklist()
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	processes := make([]ProcessInfo, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 6)
		if len(parts) < 5 {
			continue
		}
		pid, _ := strconv.Atoi(strings.TrimSpace(parts[0]))
		if pid == 0 {
			continue
		}
		cpu, _ := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
		mem, _ := strconv.ParseInt(strings.TrimSpace(parts[3]), 10, 64)
		cmdLine := ""
		if len(parts) >= 6 {
			cmdLine = strings.TrimSpace(parts[5])
		}
		processes = append(processes, ProcessInfo{
			PID:        pid,
			Name:       strings.TrimSpace(parts[1]),
			CPUPercent: cpu,
			MemBytes:   mem,
			User:       strings.TrimSpace(parts[4]),
			Command:    cmdLine,
		})
	}
	return processes, nil
}

func collectProcessesTasklist() ([]ProcessInfo, error) {
	out, err := exec.Command("tasklist", "/V", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	processes := make([]ProcessInfo, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "\"") {
			continue
		}
		fields := parseCSVLine(line)
		if len(fields) < 7 {
			continue
		}
		// Fields: Name, PID, SessionName, Session#, MemUsage, Status, UserName, CPUTime, WindowTitle
		pid, _ := strconv.Atoi(fields[1])
		if pid == 0 {
			continue
		}
		memStr := strings.ReplaceAll(strings.ReplaceAll(fields[4], ",", ""), " K", "")
		memStr = strings.ReplaceAll(memStr, "\u00a0", "")
		memStr = strings.TrimSpace(memStr)
		memKB, _ := strconv.ParseInt(memStr, 10, 64)
		user := ""
		if len(fields) >= 7 {
			user = fields[6]
		}
		processes = append(processes, ProcessInfo{
			PID:      pid,
			Name:     fields[0],
			MemBytes: memKB * 1024,
			User:     user,
		})
	}
	return processes, nil
}

// parseCSVLine splits a CSV line respecting double-quote escaping.
func parseCSVLine(line string) []string {
	var fields []string
	var field strings.Builder
	inQuote := false
	for i := 0; i < len(line); i++ {
		c := line[i]
		if c == '"' {
			if inQuote && i+1 < len(line) && line[i+1] == '"' {
				field.WriteByte('"')
				i++
			} else {
				inQuote = !inQuote
			}
		} else if c == ',' && !inQuote {
			fields = append(fields, field.String())
			field.Reset()
		} else {
			field.WriteByte(c)
		}
	}
	fields = append(fields, field.String())
	return fields
}

// ── Linux ────────────────────────────────────────────────────────────────────

func collectProcessesLinux() ([]ProcessInfo, error) {
	// ps -eo pid,comm,%cpu,rss,user,args --no-headers
	out, err := exec.Command("ps", "-eo", "pid,comm,%cpu,rss,user,args", "--no-headers").Output()
	if err != nil {
		return nil, err
	}
	return parsePsOutput(string(out)), nil
}

// ── macOS ────────────────────────────────────────────────────────────────────

func collectProcessesDarwin() ([]ProcessInfo, error) {
	// macOS ps doesn't support --no-headers but supports -o without headers using =
	out, err := exec.Command("ps", "-A", "-o", "pid=,comm=,%cpu=,rss=,user=,args=").Output()
	if err != nil {
		// Fallback: standard ps
		out, err = exec.Command("ps", "-A", "-o", "pid,comm,%cpu,rss,user,args").Output()
		if err != nil {
			return nil, err
		}
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) > 0 {
			// Skip header line
			return parsePsOutput(strings.Join(lines[1:], "\n")), nil
		}
		return []ProcessInfo{}, nil
	}
	return parsePsOutput(string(out)), nil
}

// parsePsOutput parses `ps -eo pid,comm,%cpu,rss,user,args` output.
func parsePsOutput(output string) []ProcessInfo {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	processes := make([]ProcessInfo, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		pid, _ := strconv.Atoi(fields[0])
		if pid == 0 {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[2], 64)
		rssKB, _ := strconv.ParseInt(fields[3], 10, 64)
		cmdLine := ""
		if len(fields) >= 6 {
			cmdLine = strings.Join(fields[5:], " ")
		}
		processes = append(processes, ProcessInfo{
			PID:        pid,
			Name:       fields[1],
			CPUPercent: cpu,
			MemBytes:   rssKB * 1024,
			User:       fields[4],
			Command:    cmdLine,
		})
	}
	return processes
}
