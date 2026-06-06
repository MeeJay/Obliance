//go:build windows

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
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
// to every Veeam script.
//
// $ErrorActionPreference is 'Continue', NOT 'Stop': a confirmed-working manual
// run (Connect-VBRServer OK as SYSTEM, Get-VBRJob returns the jobs) only differs
// from the agent in that the agent set 'Stop' — under which a benign
// non-terminating error (e.g. the v12 Get-VBRJob deprecation notice) aborts the
// whole script BEFORE ConvertTo-Json runs, yielding empty stdout that looks like
// "no jobs". We instead handle the ONE error that must surface — a failed
// Connect — explicitly: write it to stderr and exit non-zero so the Go caller
// reports the real reason. Everything else degrades gracefully via the per-field
// try/catch in the enum script.
const loadModulePreamble = `
$ErrorActionPreference='Continue'
$WarningPreference='SilentlyContinue'
if (Get-Module -ListAvailable -Name Veeam.Backup.PowerShell) {
  Import-Module Veeam.Backup.PowerShell -WarningAction SilentlyContinue -ErrorAction SilentlyContinue | Out-Null
} else {
  try { Add-PSSnapin -Name VeeamPSSnapIn -ErrorAction SilentlyContinue } catch {}
}
try { Connect-VBRServer -Server localhost -ErrorAction Stop | Out-Null } catch { [Console]::Error.WriteLine('VEEAM_CONNECT_FAILED: ' + $_.Exception.Message); exit 2 }
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
# Get-VBRJob (deprecated in v12 but still returns VM/replica/backup-copy jobs;
# suppress the deprecation warning) PLUS Get-VBRComputerBackupJob (agent /
# protection-group jobs that Get-VBRJob does NOT return). The per-field try/catch
# below tolerates the two job object models having different members.
$src = @()
try { $src += Get-VBRJob -WarningAction SilentlyContinue } catch {}
try { $src += Get-VBRComputerBackupJob -WarningAction SilentlyContinue } catch {}
$jobs = $src | ForEach-Object {
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

// runVeeamPS executes a Veeam PowerShell script via a temp .ps1 + `-File`,
// NOT `-Command`. A large multi-line script full of embedded quotes (the job
// enumerator) passed as a single `-Command` argument gets mangled by Go's
// Windows command-line arg escaping → PowerShell mis-parses it → empty/garbage
// stdout that looks like "no jobs". `-File` on a temp script is exactly what a
// working manual run uses, and sidesteps all quoting. ExecutionPolicy Bypass so
// a restricted machine policy can't block our own temp script.
func runVeeamPS(script string) ([]byte, error) {
	f, err := os.CreateTemp("", "obl-veeam-*.ps1")
	if err != nil {
		return nil, err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, werr := f.WriteString(script); werr != nil {
		f.Close()
		return nil, werr
	}
	f.Close()
	// Hard timeout + whole-process-tree kill: a hung Connect-VBRServer /
	// Get-VBRJob must NOT keep powershell (or the Veeam COM/shell children it
	// spawned, and the server-side session they hold) alive. The Job Object
	// kills the entire tree on timeout — a bare Process.Kill would orphan the
	// children and leak their Veeam session.
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := newCmdContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmp)
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	runErr := runCmdContextWithJobObject(ctx, cmd)
	if ctx.Err() == context.DeadlineExceeded {
		return outBuf.Bytes(), fmt.Errorf("veeam powershell timed out after 90s (process tree killed)")
	}
	if runErr != nil {
		reason := strings.TrimSpace(errBuf.String())
		if reason == "" {
			reason = runErr.Error()
		}
		return outBuf.Bytes(), fmt.Errorf("%s", reason)
	}
	return outBuf.Bytes(), nil
}

// wrapVeeamBody guarantees Disconnect-VBRServer runs after the body, even on
// error. loadModulePreamble does the Connect; a Connect with no matching
// Disconnect leaves a session the Veeam Backup Service holds until its own
// timeout, and repeated polling would otherwise accumulate them.
func wrapVeeamBody(body string) string {
	return "try {\n" + body + "\n} finally { try { Disconnect-VBRServer -ErrorAction SilentlyContinue | Out-Null } catch {} }\n"
}

func enumerateVeeamJobs() ([]VeeamJob, error) {
	out, err := runVeeamPS(loadModulePreamble + wrapVeeamBody(enumJobsScript))
	if err != nil {
		reason := ""
		if ee, ok := err.(*exec.ExitError); ok {
			reason = strings.TrimSpace(string(ee.Stderr))
		}
		if reason == "" {
			reason = err.Error()
		}
		// Surface the real cause (most commonly "access denied" because SYSTEM
		// has no Veeam role) instead of letting it look like an empty job list.
		log.Printf("Veeam enumerate failed: %s", reason)
		return nil, fmt.Errorf("%s", reason)
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		log.Printf("Veeam enumerate: connected, 0 jobs returned")
		return []VeeamJob{}, nil
	}
	var raw []psJob
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		// PowerShell's ConvertTo-Json unwraps a single-element array into a bare
		// object — retry as one object so a host with exactly one job still works.
		var single psJob
		if err2 := json.Unmarshal([]byte(trimmed), &single); err2 == nil {
			raw = []psJob{single}
		} else {
			return nil, fmt.Errorf("parse job json: %w", err)
		}
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
	log.Printf("Veeam enumerate: %d job(s)", len(jobs))
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

	out, err := runVeeamPS(loadModulePreamble + wrapVeeamBody(jobRef+cmd))
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
