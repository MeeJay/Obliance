package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Veeam Backup & Replication support. Detection + job enumeration + control,
// via the Veeam PowerShell module on the VBR server. Platform-specific work
// lives in veeam_windows.go; non-Windows builds get stubs in veeam_other.go.
//
// The agent reports the backup-host type on every push (cheap, cached) and
// posts the full job list to /api/agent/veeam-jobs after an inventory scan or
// when the server sends a veeam_list_jobs command. Control actions arrive as
// veeam_control commands carrying { action, jobId }.

// VeeamJob is the per-job payload posted to the server. Field names match the
// server's ingest mapper (veeam.service.ts).
type VeeamJob struct {
	JobID            string `json:"jobId"`
	Name             string `json:"name"`
	JobType          string `json:"jobType"`
	State            string `json:"state"`    // normalised: running|idle|transitioning|disabled|unknown
	RawState         string `json:"rawState"` // Veeam-native string
	LastResult       string `json:"lastResult"` // success|warning|failed|none
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

type veeamJobsBody struct {
	DeviceUUID string     `json:"deviceUuid"`
	HostType   string     `json:"hostType"`
	Jobs       []VeeamJob `json:"jobs"`
}

// postVeeamJobs ships the current job inventory to the server. No-op when the
// host isn't a backup server.
func postVeeamJobs(cfg *Config) error {
	host := detectBackupHost()
	if host == "" {
		return nil
	}
	jobs, err := enumerateVeeamJobs()
	if err != nil {
		return fmt.Errorf("enumerate Veeam jobs: %w", err)
	}
	body := veeamJobsBody{DeviceUUID: cfg.DeviceUUID, HostType: host, Jobs: jobs}
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/veeam-jobs", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("veeam-jobs POST returned HTTP %d", resp.StatusCode)
	}
	return nil
}
