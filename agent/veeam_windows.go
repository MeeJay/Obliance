//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ── Detection (asymmetric timed cache) ───────────────────────────────────────

var (
	backupDetectMu sync.Mutex
	backupHostType string    // "" until first positive detection; then "veeam"
	backupProbedAt time.Time // last time the probe actually ran
	backupProbed   bool
)

// backupNegativeTTL bounds how stale a NEGATIVE detection can be. A host that
// installs Veeam AFTER the agent started is picked up within one window. A
// positive result is sticky for process life (a confirmed VBR host won't stop
// being one without a restart), so the probe never runs again once it succeeds.
const backupNegativeTTL = 10 * time.Minute

// detectBackupHost returns "veeam" when the Veeam B&R server role is present
// (the VeeamBackupSvc service exists), else "".
//
// IMPORTANT: do NOT cache a negative result for the whole process life (the old
// sync.Once behaviour). The agent is long-lived and a Veeam install does NOT
// restart it (unlike a Hyper-V role install, which reboots), so a once-only
// probe would leave a freshly-installed VBR host invisible forever. Instead we
// re-probe negatives every backupNegativeTTL while keeping the per-push cost at
// ~zero once detected.
func detectBackupHost() string {
	backupDetectMu.Lock()
	defer backupDetectMu.Unlock()

	if backupHostType == "veeam" {
		return backupHostType
	}
	if backupProbed && time.Since(backupProbedAt) < backupNegativeTTL {
		return backupHostType
	}
	backupProbed = true
	backupProbedAt = time.Now()

	// Multi-signal probe — the exact Windows service SHORT name has drifted
	// across Veeam B&R versions (it is NOT reliably "VeeamBackupSvc" on v12),
	// so a single Get-Service by name misses real VBR servers. We accept ANY
	// of three independent markers of a VBR server install:
	//   1. the registry key the VBR server install creates
	//      (HKLM:\SOFTWARE\Veeam\Veeam Backup and Replication);
	//   2. a service whose short name starts with "VeeamBackup";
	//   3. a service whose DISPLAY name is "Veeam Backup Service" (stable label).
	// Over-detecting a console-only box is harmless: the job enumerate would
	// just come back empty. Missing a real server is the failure we must avoid.
	const probe = `$ErrorActionPreference='SilentlyContinue'
$found=$false
if (Test-Path 'HKLM:\SOFTWARE\Veeam\Veeam Backup and Replication') { $found=$true }
if (-not $found) {
  $svc = Get-Service | Where-Object { $_.Name -like 'VeeamBackup*' -or $_.DisplayName -like 'Veeam Backup Service*' }
  if ($svc) { $found=$true }
}
if ($found) { 'yes' } else { 'no' }`
	out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command", probe).Output()
	res := strings.TrimSpace(string(out))
	if err == nil && res == "yes" {
		backupHostType = "veeam"
	}
	// One log line per actual probe (≤ once per TTL for non-Veeam hosts) so a
	// mis-detection is diagnosable from the agent log instead of invisible.
	if err != nil {
		log.Printf("Veeam detection probe error: %v", err)
	} else {
		log.Printf("Veeam detection probe: %q -> backupHost=%q", res, backupHostType)
	}
	return backupHostType
}

// loadModulePreamble loads the Veeam PowerShell module (VBR 11/12) or the
// legacy PSSnapIn (VBR 9/10) and connects to the local VBR server. Prepended
// to every Veeam script. Connect runs as the agent's SYSTEM context, which is
// a Veeam admin on the VBR box, so no credentials are needed.
const loadModulePreamble = `
$ErrorActionPreference='Stop'
if (Get-Module -ListAvailable -Name Veeam.Backup.PowerShell) {
  Import-Module Veeam.Backup.PowerShell -ErrorAction SilentlyContinue | Out-Null
} else {
  try { Add-PSSnapin -Name VeeamPSSnapIn -ErrorAction SilentlyContinue } catch {}
}
try { Connect-VBRServer -Server localhost -ErrorAction SilentlyContinue | Out-Null } catch {}
`

// ── Enumeration ──────────────────────────────────────────────────────────────

type psJob struct {
	JobID            string `json:"jobId"`
	Name             string `json:"name"`
	JobType          string `json:"jobType"`
	RawState         string `json:"rawState"`
	LastResult       string `json:"lastResult"`
	ScheduleEnabled  bool   `json:"scheduleEnabled"`
	LastRunStart     string `json:"lastRunStart"`
	LastRunEnd       string `json:"lastRunEnd"`
	NextRun          string `json:"nextRun"`
	ProgressPercent  int    `json:"progressPercent"`
	ProcessedBytes   int64  `json:"processedBytes"`
	TransferredBytes int64  `json:"transferredBytes"`
	DurationSeconds  int64  `json:"durationSeconds"`
	Repository       string `json:"repository"`
	Description      string `json:"description"`
}

const enumJobsScript = `
$jobs = Get-VBRJob | ForEach-Object {
  $j = $_
  $lastResult=''; try { $lastResult = "$($j.GetLastResult())" } catch {}
  $state=''; try { $state = "$($j.GetLastState())" } catch {}
  $sched=$false; try { $sched = [bool]$j.IsScheduleEnabled } catch {}
  $nextRun=''; try { if ($j.ScheduleOptions -and $j.ScheduleOptions.NextRun) { $nextRun = ([datetime]$j.ScheduleOptions.NextRun).ToUniversalTime().ToString('o') } } catch {}
  $lastStart=''; $lastEnd=''; $progress=0; $processed=0; $transferred=0; $duration=0
  try {
    $s = $j.FindLastSession()
    if ($s) {
      if ($s.CreationTime) { $lastStart = ([datetime]$s.CreationTime).ToUniversalTime().ToString('o') }
      if ($s.EndTime)      { $lastEnd   = ([datetime]$s.EndTime).ToUniversalTime().ToString('o') }
      try { $progress    = [int]$s.Progress.Percents } catch {}
      try { $processed   = [int64]$s.Progress.ProcessedSize } catch {}
      try { $transferred = [int64]$s.Progress.TransferedSize } catch {}
      try { if ($s.CreationTime -and $s.EndTime) { $duration = [int64]((([datetime]$s.EndTime) - ([datetime]$s.CreationTime)).TotalSeconds) } } catch {}
    }
  } catch {}
  $repo=''; try { $repo = "$($j.GetTargetRepository().Name)" } catch {}
  [pscustomobject]@{
    jobId            = "$($j.Id)"
    name             = $j.Name
    jobType          = "$($j.JobType)"
    rawState         = $state
    lastResult       = $lastResult
    scheduleEnabled  = $sched
    lastRunStart     = $lastStart
    lastRunEnd       = $lastEnd
    nextRun          = $nextRun
    progressPercent  = $progress
    processedBytes   = $processed
    transferredBytes = $transferred
    durationSeconds  = $duration
    repository       = $repo
    description      = "$($j.Description)"
  }
}
ConvertTo-Json -InputObject @($jobs) -Compress -Depth 4
`

func normaliseJobState(rawState string, scheduleEnabled bool) string {
	switch strings.ToLower(strings.TrimSpace(rawState)) {
	case "working":
		return "running"
	case "starting", "stopping", "pausing", "resuming", "postprocessing", "waitingrepository", "waitingtape":
		return "transitioning"
	}
	if !scheduleEnabled {
		return "disabled"
	}
	switch strings.ToLower(strings.TrimSpace(rawState)) {
	case "stopped", "idle", "":
		return "idle"
	default:
		return "unknown"
	}
}

func normaliseJobResult(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "success":
		return "success"
	case "warning":
		return "warning"
	case "failed":
		return "failed"
	default:
		return "none"
	}
}

func enumerateVeeamJobs() ([]VeeamJob, error) {
	script := loadModulePreamble + enumJobsScript
	out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		reason := ""
		if ee, ok := err.(*exec.ExitError); ok {
			reason = strings.TrimSpace(string(ee.Stderr))
		}
		if reason == "" {
			reason = err.Error()
		}
		return nil, fmt.Errorf("%s", reason)
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return []VeeamJob{}, nil
	}
	var raw []psJob
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return nil, fmt.Errorf("parse job json: %w", err)
	}
	jobs := make([]VeeamJob, 0, len(raw))
	for _, r := range raw {
		jobs = append(jobs, VeeamJob{
			JobID:            r.JobID,
			Name:             r.Name,
			JobType:          r.JobType,
			State:            normaliseJobState(r.RawState, r.ScheduleEnabled),
			RawState:         r.RawState,
			LastResult:       normaliseJobResult(r.LastResult),
			ScheduleEnabled:  r.ScheduleEnabled,
			LastRunStart:     r.LastRunStart,
			LastRunEnd:       r.LastRunEnd,
			NextRun:          r.NextRun,
			ProgressPercent:  r.ProgressPercent,
			ProcessedBytes:   r.ProcessedBytes,
			TransferredBytes: r.TransferredBytes,
			DurationSeconds:  r.DurationSeconds,
			Repository:       r.Repository,
			Description:      r.Description,
		})
	}
	return jobs, nil
}

// ── Control ──────────────────────────────────────────────────────────────────

// runVeeamControl performs a control action on a job addressed by its VBR Id.
func runVeeamControl(action, jobID string) (string, error) {
	if jobID == "" {
		return "", fmt.Errorf("missing jobId")
	}
	jobRef := fmt.Sprintf("$job = Get-VBRJob | Where-Object { \"$($_.Id)\" -eq '%s' } | Select-Object -First 1; if (-not $job) { throw 'job not found' }; ", psEscape(jobID))

	var cmd string
	switch action {
	case "start":
		cmd = "Start-VBRJob -Job $job -RunAsync | Out-Null"
	case "stop":
		cmd = "Stop-VBRJob -Job $job | Out-Null"
	case "retry":
		cmd = "Start-VBRJob -Job $job -RetryBackup -RunAsync | Out-Null"
	case "enable":
		cmd = "Enable-VBRJobSchedule -Job $job | Out-Null"
	case "disable":
		cmd = "Disable-VBRJobSchedule -Job $job | Out-Null"
	default:
		return "", fmt.Errorf("unknown veeam action %q", action)
	}

	script := loadModulePreamble + jobRef + cmd
	out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		reason := ""
		if ee, ok := err.(*exec.ExitError); ok {
			reason = strings.TrimSpace(string(ee.Stderr))
		}
		if reason == "" {
			reason = strings.TrimSpace(string(out))
		}
		if reason == "" {
			reason = err.Error()
		}
		return "", fmt.Errorf("%s", reason)
	}
	return fmt.Sprintf("veeam %s ok", action), nil
}
