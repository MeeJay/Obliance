//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

// ── Detection (cached) ───────────────────────────────────────────────────────

var (
	veeamDetectOnce sync.Once
	backupHostType  string
)

// detectBackupHost returns "veeam" when the Veeam B&R server role is present
// (the VeeamBackupSvc service exists), else "". Cached for process life — the
// role doesn't change without an install/uninstall + restart.
func detectBackupHost() string {
	veeamDetectOnce.Do(func() {
		// VeeamBackupSvc = the Veeam Backup Service, present only on a VBR
		// server. We don't require Running (a stopped service is still a VBR
		// host); presence is enough.
		out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command",
			"if (Get-Service VeeamBackupSvc -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }",
		).Output()
		if err == nil && strings.TrimSpace(string(out)) == "yes" {
			backupHostType = "veeam"
		}
	})
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
