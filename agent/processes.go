package main

import (
	"fmt"
	"log"
	"math"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/process"
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
		return newCmd("taskkill", "/F", "/PID", strconv.Itoa(pid)).Run()
	}
	return newCmd("kill", "-9", strconv.Itoa(pid)).Run()
}

// collectProcesses returns the list of running processes.
// Platform-specific implementations below.
func collectProcesses() ([]ProcessInfo, error) {
	if runtime.GOOS == "windows" {
		return collectProcessesWindows()
	}
	// Linux / macOS / *BSD: read /proc (etc.) via gopsutil — no `ps` fork.
	return collectProcessesGopsutil()
}

// processCollectMu serialises process collection so the live poll (5s while a
// viewer watches) and the rewind snapshot never run their CPU-sampling window
// concurrently on the same box.
var processCollectMu sync.Mutex

// collectProcessesGopsutil enumerates processes via gopsutil (reads /proc on
// Linux, sysctl on *BSD/macOS) — no `ps` fork, no output-format parsing. CPU is
// INSTANTANEOUS: each process's CPU counter is primed, we wait a short window,
// then measure the delta (like top/htop) instead of ps's lifetime average
// (which summed to absurd values like 8000%). gopsutil returns per-single-core
// percent, which we then divide by core count + clamp (see below) so a value is
// "% of the whole machine" and the set sums to <= 100%.
func collectProcessesGopsutil() ([]ProcessInfo, error) {
	processCollectMu.Lock()
	defer processCollectMu.Unlock()

	procs, err := process.Processes()
	if err != nil {
		return nil, err
	}

	// Pass 1 — prime each process's CPU counter (first Percent(0) returns 0).
	for _, p := range procs {
		_, _ = p.Percent(0)
	}
	time.Sleep(400 * time.Millisecond)

	ncpu := float64(runtime.NumCPU())
	if ncpu < 1 {
		ncpu = 1
	}
	userCache := map[int32]string{}

	// Pass 2 — read the delta over the sampling window + the rest of the fields.
	out := make([]ProcessInfo, 0, len(procs))
	for _, p := range procs {
		cpu, _ := p.Percent(0)
		// gopsutil returns top/htop-style "percent of a single core" (a process
		// spanning N cores reads N*100). Normalise to "% of the whole machine"
		// and clamp — matching the Windows path — so the set sums to <= 100%
		// (no more 8000%, and no impossible >100% per-process values).
		cpu = cpu / ncpu
		if cpu > 100 {
			cpu = 100
		} else if cpu < 0 {
			cpu = 0
		}

		name, _ := p.Name()
		if name == "" {
			continue
		}
		var rss int64
		if mi, mErr := p.MemoryInfo(); mErr == nil && mi != nil {
			rss = int64(mi.RSS)
		}
		user, _ := p.Username()
		if user == "" {
			user = resolveUsername(p, userCache)
		}
		cmd, _ := p.Cmdline()
		out = append(out, ProcessInfo{
			PID:        int(p.Pid),
			Name:       name,
			CPUPercent: math.Round(cpu*10) / 10,
			MemBytes:   rss,
			User:       user,
			Command:    cmd,
		})
	}
	return out, nil
}

// resolveUsername resolves a process owner via NSS (getent) when gopsutil's
// os/user lookup returns empty — which happens for domain users (SSSD/LDAP/AD)
// on CGO-disabled Linux/FreeBSD builds, where pure-Go os/user only reads
// /etc/passwd. Cached per collection so we fork getent at most once per distinct
// domain UID (local/root users are already resolved by gopsutil without a fork).
func resolveUsername(p *process.Process, cache map[int32]string) string {
	if runtime.GOOS == "windows" {
		return ""
	}
	uids, err := p.Uids()
	if err != nil || len(uids) == 0 {
		return ""
	}
	uid := uids[0]
	if v, ok := cache[uid]; ok {
		return v
	}
	name := ""
	if out, e := newCmd("getent", "passwd", strconv.Itoa(int(uid))).Output(); e == nil {
		// getent line: name:x:uid:gid:gecos:home:shell
		if i := strings.IndexByte(string(out), ':'); i > 0 {
			name = string(out)[:i]
		}
	}
	cache[uid] = name
	return name
}

func collectProcessesTasklist() ([]ProcessInfo, error) {
	out, err := newCmd("tasklist", "/V", "/FO", "CSV", "/NH").Output()
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
